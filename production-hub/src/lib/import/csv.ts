/**
 * CSV import for existing jobs and subcontractor records.
 * Two steps: preview (validates, writes nothing) then commit.
 * Imports only write to the Production Hub database — never back to DripJobs or any live system.
 */
import type { Actor } from "@/lib/auth/core";
import { getDb } from "@/lib/db";
import { parseMoneyToCents, SERVICE_KEYS } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { audit, requirePermission } from "@/lib/services/common";
import { createSub, normalizeSubInput, type SubInput } from "@/lib/services/subs";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
const bool = (v: string | undefined) => /^(y|yes|true|1|x)$/i.test(v ?? "");
const date = (v: string | undefined, field: string, errors: string[]) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  errors.push(`${field}: "${v}" isn't a date (use YYYY-MM-DD or MM/DD/YYYY)`);
  return null;
};
const money = (v: string | undefined, field: string, errors: string[]) => {
  if (!v) return null;
  const c = parseMoneyToCents(v);
  if (c == null || Number.isNaN(c)) {
    errors.push(`${field}: "${v}" isn't a dollar amount`);
    return null;
  }
  return c;
};

export interface JobImportRow {
  job_number: string;
  customer_name: string;
  customer_phone: string | null;
  address: string;
  city: string;
  zip: string | null;
  services: string[];
  title: string;
  work_order: string | null;
  contract_amount_cents: number | null;
  target_payout_cents: number | null;
  proposed_start: string | null;
  proposed_end: string | null;
  estimated_days: number | null;
  deposit_received: boolean;
  colors_confirmed: boolean;
  external_ref: string | null;
}

export interface PreviewRow<T> {
  line: number;
  data: T | null;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

export async function previewJobs(actor: Actor | null, csv: string): Promise<PreviewRow<JobImportRow>[]> {
  requirePermission(actor, "import.run");
  const fin = can(actor.role, "jobs.view_financials");
  const db = await getDb();
  const existing = new Set((await db.query<{ job_number: string }>("select job_number from jobs")).rows.map((r) => r.job_number));
  const seen = new Set<string>();
  return parseCsv(csv).map((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const f of ["job_number", "customer_name", "address", "city", "title"])
      if (!r[f]) errors.push(`${f} is required`);
    const services = list(r.services).map((s) => s.toLowerCase());
    const bad = services.filter((s) => !SERVICE_KEYS.includes(s));
    if (bad.length) errors.push(`Unknown services: ${bad.join(", ")} (use: ${SERVICE_KEYS.join(", ")})`);
    let contract = money(r.contract_amount, "contract_amount", errors);
    let target = money(r.target_payout, "target_payout", errors);
    if (!fin && (contract != null || target != null)) {
      warnings.push("Pricing columns skipped — only the owner can import prices");
      contract = null;
      target = null;
    }
    const days = r.estimated_days ? Number(r.estimated_days) : null;
    if (days != null && Number.isNaN(days)) errors.push("estimated_days must be a number");
    const duplicate = existing.has(r.job_number) || seen.has(r.job_number);
    if (duplicate) warnings.push("Job number already exists — row will be skipped");
    seen.add(r.job_number);
    const data: JobImportRow = {
      job_number: r.job_number,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone || null,
      address: r.address,
      city: r.city,
      zip: r.zip || null,
      services,
      title: r.title,
      work_order: r.work_order || null,
      contract_amount_cents: contract,
      target_payout_cents: target,
      proposed_start: date(r.proposed_start, "proposed_start", errors),
      proposed_end: date(r.proposed_end, "proposed_end", errors),
      estimated_days: days,
      deposit_received: bool(r.deposit_received),
      colors_confirmed: bool(r.colors_confirmed),
      external_ref: r.external_ref || null,
    };
    return { line: i + 2, data: errors.length ? null : data, errors, warnings, duplicate };
  });
}

export async function commitJobs(actor: Actor | null, csv: string, fileName: string) {
  const preview = await previewJobs(actor, csv);
  requirePermission(actor, "import.run");
  if (preview.some((p) => p.errors.length)) throw new ValidationError("Fix the errors in the file before importing");
  const rows = preview.filter((p) => p.data && !p.duplicate).map((p) => p.data!);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const batch = await tx.query<{ id: string }>(
      "insert into import_batches (kind, file_name, row_count, created_by) values ('jobs',$1,$2,$3) returning id",
      [fileName, rows.length, actor.userId],
    );
    for (const j of rows) {
      const { rows: ins } = await tx.query<{ id: string }>(
        `insert into jobs (job_number, customer_name, customer_phone, address, city, zip, services, title, work_order,
           contract_amount_cents, target_payout_cents, proposed_start, proposed_end, estimated_days, deposit_received,
           colors_confirmed, external_ref, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'import') returning id`,
        [j.job_number, j.customer_name, j.customer_phone, j.address, j.city, j.zip, j.services, j.title, j.work_order,
          j.contract_amount_cents, j.target_payout_cents, j.proposed_start, j.proposed_end, j.estimated_days,
          j.deposit_received, j.colors_confirmed, j.external_ref],
      );
      await audit(tx, actor, { action: "job.imported", entityType: "job", entityId: ins[0].id, jobId: ins[0].id, after: { ...j, import_batch: batch.rows[0].id } });
    }
    return { imported: rows.length, skipped: preview.length - rows.length };
  });
}

export async function previewSubs(actor: Actor | null, csv: string): Promise<PreviewRow<SubInput>[]> {
  requirePermission(actor, "import.run");
  const db = await getDb();
  const existing = new Set(
    (await db.query<{ k: string }>("select lower(company_name) as k from subcontractors")).rows.map((r) => r.k),
  );
  return parseCsv(csv).map((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    let data: SubInput | null = null;
    try {
      data = normalizeSubInput({
        company_name: r.company_name ?? "",
        contact_name: r.contact_name ?? "",
        phone: r.phone || null,
        email: r.email || null,
        status: (r.status || "prospect").toLowerCase(),
        skills: list(r.skills).map((s) => s.toLowerCase()),
        service_areas: list(r.service_areas),
        crew_size: r.crew_size ? Number(r.crew_size) : null,
        max_active_jobs: r.max_active_jobs ? Number(r.max_active_jobs) : 2,
        quality_rating: r.quality_rating ? Number(r.quality_rating) : null,
      }) as SubInput;
    } catch (e) {
      errors.push((e as Error).message);
    }
    const duplicate = existing.has((r.company_name ?? "").toLowerCase());
    if (duplicate) warnings.push("Company already exists — row will be skipped");
    if (data?.status === "active") warnings.push("Imported as active — insurance documents still need to be uploaded and verified before offers");
    return { line: i + 2, data: errors.length ? null : data, errors, warnings, duplicate };
  });
}

export async function commitSubs(actor: Actor | null, csv: string, fileName: string) {
  const preview = await previewSubs(actor, csv);
  requirePermission(actor, "import.run");
  requirePermission(actor, "subs.edit");
  if (preview.some((p) => p.errors.length)) throw new ValidationError("Fix the errors in the file before importing");
  const rows = preview.filter((p) => p.data && !p.duplicate).map((p) => p.data!);
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query("insert into import_batches (kind, file_name, row_count, created_by) values ('subcontractors',$1,$2,$3)", [fileName, rows.length, actor.userId]);
    for (const s of rows) await createSub(actor, s, "import", tx);
    return { imported: rows.length, skipped: preview.length - rows.length };
  });
}
