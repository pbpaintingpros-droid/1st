import type { Actor } from "@/lib/auth/core";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { getDb, type Queryable } from "@/lib/db";
import { DOC_TYPES, ONBOARDING_STEPS, SERVICE_KEYS } from "@/lib/domain";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit, isUuid, requirePermission } from "./common";
import { getMatchingRules } from "./settings";
import { subCompliance } from "./rules";

export interface SubRow {
  id: string;
  company_name: string;
  contact_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  skills: string[];
  service_areas: string[];
  crew_size: number | null;
  max_active_jobs: number;
  quality_rating: number | null;
  internal_notes: string | null;
  source: string;
  external_ref: string | null;
  created_at: string;
}

export interface SubDocument {
  id: string;
  doc_type: string;
  file_id: string | null;
  file_name: string | null;
  expires_on: string | null;
  verified_at: string | null;
  verified_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export async function loadSubDocs(q: Queryable, subIds: string[]) {
  const { rows } = await q.query<SubDocument & { subcontractor_id: string }>(
    `select d.id, d.subcontractor_id, d.doc_type, d.file_id, f.file_name, d.expires_on, d.verified_at,
            u.name as verified_by_name, d.notes, d.created_at
       from sub_documents d left join files f on f.id = d.file_id left join users u on u.id = d.verified_by
      where d.subcontractor_id = any($1) order by d.created_at desc`,
    [subIds],
  );
  return rows;
}

export async function listSubs(actor: Actor | null) {
  requirePermission(actor, "subs.view");
  const db = await getDb();
  const rules = await getMatchingRules();
  const { rows } = await db.query<SubRow & { active_job_count: number }>(
    `select s.*, (select count(*)::int from jobs j where j.assigned_sub_id = s.id and j.status in ('assigned','in_progress')) as active_job_count
       from subcontractors s order by s.status = 'active' desc, s.company_name`,
  );
  const docs = await loadSubDocs(db, rows.map((r) => r.id));
  return rows.map((s) => ({
    ...s,
    compliance: subCompliance(
      { status: s.status, documents: docs.filter((d) => d.subcontractor_id === s.id) },
      { expiryWarningDays: rules.insuranceExpiryWarningDays },
    ),
  }));
}

export async function getSub(actor: Actor | null, id: string) {
  requirePermission(actor, "subs.view");
  if (!isUuid(id)) throw new NotFoundError();
  const db = await getDb();
  const { rows } = await db.query<SubRow>("select * from subcontractors where id = $1", [id]);
  if (!rows[0]) throw new NotFoundError();
  const rules = await getMatchingRules();
  const documents = await loadSubDocs(db, [id]);
  const steps = await db.query<{ step: string; completed_at: string | null; completed_by_name: string | null }>(
    `select o.step, o.completed_at, u.name as completed_by_name
       from onboarding_steps o left join users u on u.id = o.completed_by where o.subcontractor_id = $1`,
    [id],
  );
  const offers = await db.query<{
    id: string;
    job_id: string;
    job_number: string;
    title: string;
    status: string;
    payout_cents: number;
    sent_at: string | null;
  }>(
    `select o.id, o.job_id, j.job_number, j.title, o.status, o.payout_cents, o.sent_at
       from offers o join jobs j on j.id = o.job_id where o.subcontractor_id = $1 order by o.created_at desc`,
    [id],
  );
  const logins = await db.query<{ id: string; email: string; active: boolean }>(
    "select id, email, active from users where subcontractor_id = $1",
    [id],
  );
  return {
    sub: rows[0],
    documents,
    compliance: subCompliance(
      { status: rows[0].status, documents },
      { expiryWarningDays: rules.insuranceExpiryWarningDays },
    ),
    onboarding: ONBOARDING_STEPS.map((s) => {
      const done = steps.rows.find((r) => r.step === s.key);
      return { ...s, completed_at: done?.completed_at ?? null, completed_by_name: done?.completed_by_name ?? null };
    }),
    offers: offers.rows,
    logins: logins.rows,
  };
}

export interface SubInput {
  company_name: string;
  contact_name: string;
  phone?: string | null;
  email?: string | null;
  status?: string;
  skills?: string[];
  service_areas?: string[];
  crew_size?: number | null;
  max_active_jobs?: number;
  quality_rating?: number | null;
  internal_notes?: string | null;
}

const SUB_FIELDS: (keyof SubInput)[] = [
  "company_name",
  "contact_name",
  "phone",
  "email",
  "status",
  "skills",
  "service_areas",
  "crew_size",
  "max_active_jobs",
  "quality_rating",
  "internal_notes",
];

export function normalizeSubInput(input: Partial<SubInput>): Partial<SubInput> {
  const out: Partial<SubInput> = {};
  for (const k of SUB_FIELDS) if (input[k] !== undefined) (out as Record<string, unknown>)[k] = input[k];
  if (out.company_name !== undefined && !out.company_name.trim()) throw new ValidationError("Company name is required");
  if (out.contact_name !== undefined && !out.contact_name.trim()) throw new ValidationError("Contact name is required");
  if (out.status && !["prospect", "onboarding", "active", "paused", "inactive"].includes(out.status))
    throw new ValidationError("Invalid status");
  if (out.skills) {
    const bad = out.skills.filter((s) => !SERVICE_KEYS.includes(s));
    if (bad.length) throw new ValidationError(`Unknown services: ${bad.join(", ")}`);
  }
  if (out.service_areas) out.service_areas = out.service_areas.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (out.quality_rating != null && (out.quality_rating < 1 || out.quality_rating > 5))
    throw new ValidationError("Rating must be 1–5");
  if (out.email) out.email = out.email.trim().toLowerCase();
  return out;
}

export async function createSub(actor: Actor | null, input: SubInput, source = "manual", tx?: Queryable) {
  requirePermission(actor, "subs.edit");
  const data = normalizeSubInput(input);
  const run = async (q: Queryable) => {
    const keys = Object.keys(data) as (keyof SubInput)[];
    const { rows } = await q.query<SubRow>(
      `insert into subcontractors (${keys.join(", ")}, source) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1}) returning *`,
      [...keys.map((k) => data[k]), source],
    );
    await audit(q, actor, { action: "sub.created", entityType: "subcontractor", entityId: rows[0].id, after: data });
    return rows[0];
  };
  return tx ? run(tx) : (await getDb()).transaction(run);
}

export async function updateSub(actor: Actor | null, id: string, input: Partial<SubInput>) {
  requirePermission(actor, "subs.edit");
  if (!isUuid(id)) throw new NotFoundError();
  const data = normalizeSubInput(input);
  const keys = Object.keys(data) as (keyof SubInput)[];
  if (!keys.length) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = (await tx.query<SubRow>("select * from subcontractors where id = $1", [id])).rows[0];
    if (!before) throw new NotFoundError();
    await tx.query(
      `update subcontractors set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`,
      [id, ...keys.map((k) => data[k])],
    );
    const changed = keys.filter((k) => JSON.stringify(before[k as keyof SubRow]) !== JSON.stringify(data[k]));
    if (changed.length)
      await audit(tx, actor, {
        action: "sub.updated",
        entityType: "subcontractor",
        entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, before[k as keyof SubRow]])),
        after: Object.fromEntries(changed.map((k) => [k, data[k]])),
      });
  });
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];

export async function addSubDocument(
  actor: Actor | null,
  subId: string,
  input: {
    doc_type: string;
    expires_on: string | null;
    notes?: string | null;
    file?: { name: string; type: string; bytes: Uint8Array } | null;
  },
) {
  requirePermission(actor, "subs.documents");
  if (!isUuid(subId)) throw new NotFoundError();
  if (!DOC_TYPES.some((d) => d.key === input.doc_type)) throw new ValidationError("Unknown document type");
  if (input.expires_on && !/^\d{4}-\d{2}-\d{2}$/.test(input.expires_on)) throw new ValidationError("Invalid date");
  if (input.file) {
    if (input.file.bytes.byteLength > MAX_FILE_BYTES) throw new ValidationError("File is larger than 10 MB");
    if (!ALLOWED_TYPES.includes(input.file.type)) throw new ValidationError("Upload a PDF or photo (JPG, PNG, HEIC)");
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    const exists = await tx.query("select 1 from subcontractors where id = $1", [subId]);
    if (!exists.rows.length) throw new NotFoundError();
    let fileId: string | null = null;
    if (input.file) {
      const f = await tx.query<{ id: string }>(
        "insert into files (file_name, content_type, size_bytes, data, uploaded_by) values ($1,$2,$3,$4,$5) returning id",
        [input.file.name.slice(0, 200), input.file.type, input.file.bytes.byteLength, input.file.bytes, actor.userId],
      );
      fileId = f.rows[0].id;
    }
    const { rows } = await tx.query<{ id: string }>(
      "insert into sub_documents (subcontractor_id, doc_type, file_id, expires_on, notes) values ($1,$2,$3,$4,$5) returning id",
      [subId, input.doc_type, fileId, input.expires_on || null, input.notes ?? null],
    );
    await audit(tx, actor, {
      action: "sub.document_added",
      entityType: "subcontractor",
      entityId: subId,
      after: { document_id: rows[0].id, doc_type: input.doc_type, expires_on: input.expires_on, has_file: !!fileId },
    });
    return rows[0].id;
  });
}

export async function verifySubDocument(actor: Actor | null, documentId: string) {
  requirePermission(actor, "subs.documents");
  if (!isUuid(documentId)) throw new NotFoundError();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ subcontractor_id: string; doc_type: string }>(
      "update sub_documents set verified_by = $2, verified_at = now() where id = $1 and verified_at is null returning subcontractor_id, doc_type",
      [documentId, actor.userId],
    );
    if (!rows[0]) throw new NotFoundError();
    await audit(tx, actor, {
      action: "sub.document_verified",
      entityType: "subcontractor",
      entityId: rows[0].subcontractor_id,
      after: { document_id: documentId, doc_type: rows[0].doc_type },
    });
  });
}

export async function setOnboardingStep(actor: Actor | null, subId: string, step: string, done: boolean) {
  requirePermission(actor, "subs.edit");
  if (!ONBOARDING_STEPS.some((s) => s.key === step)) throw new ValidationError("Unknown step");
  if (!isUuid(subId)) throw new NotFoundError();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into onboarding_steps (subcontractor_id, step, completed_at, completed_by) values ($1,$2,$3,$4)
       on conflict (subcontractor_id, step) do update set completed_at = excluded.completed_at, completed_by = excluded.completed_by`,
      [subId, step, done ? new Date().toISOString() : null, done ? actor.userId : null],
    );
    await audit(tx, actor, { action: "sub.onboarding_step", entityType: "subcontractor", entityId: subId, after: { step, done } });
  });
}

/** Create a crew-portal login for a sub. Owner only. Does NOT email the password — share it yourself. */
export async function createSubLogin(actor: Actor | null, subId: string, email: string, password: string) {
  requirePermission(actor, "users.manage");
  const weak = validatePasswordStrength(password);
  if (weak) throw new ValidationError(weak);
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new ValidationError("Invalid email");
  const db = await getDb();
  const sub = (await db.query<SubRow>("select * from subcontractors where id = $1", [subId])).rows[0];
  if (!sub) throw new NotFoundError();
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const dup = await tx.query("select 1 from users where email = $1", [normalized]);
    if (dup.rows.length) throw new ValidationError("That email already has a login");
    const { rows } = await tx.query<{ id: string }>(
      "insert into users (email, name, role, subcontractor_id, password_hash) values ($1,$2,'sub',$3,$4) returning id",
      [normalized, sub.contact_name, subId, hash],
    );
    await audit(tx, actor, { action: "user.created", entityType: "user", entityId: rows[0].id, after: { email: normalized, role: "sub", subcontractor_id: subId } });
  });
}
