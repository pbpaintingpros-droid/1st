import type { Actor } from "@/lib/auth/core";
import { getDb, type Queryable } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { audit, isUuid, requirePermission } from "./common";
import { jobReadiness } from "./rules";

export interface JobRow {
  id: string;
  job_number: string;
  customer_name: string;
  customer_phone: string | null;
  address: string;
  city: string;
  zip: string | null;
  services: string[];
  title: string;
  work_order: string | null;
  internal_notes: string | null;
  contract_amount_cents: number | null;
  target_payout_cents: number | null;
  proposed_start: string | null;
  proposed_end: string | null;
  estimated_days: number | null;
  deposit_received: boolean;
  colors_confirmed: boolean;
  status: string;
  assigned_sub_id: string | null;
  assigned_payout_cents: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  source: string;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

/** Internal (staff) view of a job. Financial fields are null unless the viewer may see them. */
export interface StaffJobView extends Omit<JobRow, "contract_amount_cents"> {
  contract_amount_cents: number | null;
  margin_cents: number | null;
  margin_pct: number | null;
  assigned_sub_name: string | null;
  crew_photo_count: number;
  open_offer_count: number;
  pending_counter_count: number;
  readiness: ReturnType<typeof jobReadiness>;
  can_view_financials: boolean;
}

export async function loadJobRow(q: Queryable, id: string): Promise<JobRow> {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await q.query<JobRow>("select * from jobs where id = $1", [id]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

function toStaffView(
  actor: Actor,
  row: JobRow & { assigned_sub_name: string | null; crew_photo_count: number; open_offer_count: number; pending_counter_count: number },
): StaffJobView {
  const fin = can(actor.role, "jobs.view_financials");
  const payout = row.assigned_payout_cents ?? row.target_payout_cents;
  const margin = fin && row.contract_amount_cents != null && payout != null ? row.contract_amount_cents - payout : null;
  return {
    ...row,
    contract_amount_cents: fin ? row.contract_amount_cents : null,
    target_payout_cents: row.target_payout_cents, // coordinators need the payout guideline to coordinate
    margin_cents: margin,
    margin_pct: margin != null && row.contract_amount_cents ? Math.round((margin / row.contract_amount_cents) * 100) : null,
    crew_photo_count: Number(row.crew_photo_count),
    open_offer_count: Number(row.open_offer_count),
    pending_counter_count: Number(row.pending_counter_count),
    readiness: jobReadiness({ ...row, crew_photo_count: Number(row.crew_photo_count) }),
    can_view_financials: fin,
  };
}

const JOB_VIEW_SQL = `
  select j.*, s.company_name as assigned_sub_name,
    (select count(*) from job_photos p where p.job_id = j.id and p.share_with_crew) as crew_photo_count,
    (select count(*) from offers o where o.job_id = j.id and o.status in ('sent','countered','walkthrough_requested','accepted')) as open_offer_count,
    (select count(*) from offer_responses r join offers o on o.id = r.offer_id
       where o.job_id = j.id and r.review_status = 'pending') as pending_counter_count
  from jobs j left join subcontractors s on s.id = j.assigned_sub_id`;

export async function listJobs(actor: Actor | null, filter?: { status?: string }): Promise<StaffJobView[]> {
  requirePermission(actor, "jobs.view");
  const db = await getDb();
  const params: unknown[] = [];
  let where = "";
  if (filter?.status) {
    params.push(filter.status);
    where = "where j.status = $1";
  }
  const { rows } = await db.query<Parameters<typeof toStaffView>[1]>(
    `${JOB_VIEW_SQL} ${where} order by coalesce(j.scheduled_start, j.proposed_start) nulls last, j.job_number`,
    params,
  );
  return rows.map((r) => toStaffView(actor, r));
}

export async function getJob(actor: Actor | null, id: string): Promise<StaffJobView> {
  requirePermission(actor, "jobs.view");
  if (!isUuid(id)) throw new NotFoundError();
  const db = await getDb();
  const { rows } = await db.query<Parameters<typeof toStaffView>[1]>(`${JOB_VIEW_SQL} where j.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError();
  return toStaffView(actor, rows[0]);
}

export async function listJobPhotos(actor: Actor | null, jobId: string) {
  requirePermission(actor, "jobs.view");
  const db = await getDb();
  const { rows } = await db.query<{ id: string; caption: string | null; share_with_crew: boolean; file_id: string | null; external_url: string | null }>(
    "select id, caption, share_with_crew, file_id, external_url from job_photos where job_id = $1 order by created_at",
    [jobId],
  );
  return rows;
}

export interface JobUpdate {
  title?: string;
  work_order?: string | null;
  internal_notes?: string | null;
  services?: string[];
  proposed_start?: string | null;
  proposed_end?: string | null;
  estimated_days?: number | null;
  deposit_received?: boolean;
  colors_confirmed?: boolean;
  contract_amount_cents?: number | null;
  target_payout_cents?: number | null;
}

const EDITABLE_FIELDS: (keyof JobUpdate)[] = [
  "title",
  "work_order",
  "internal_notes",
  "services",
  "proposed_start",
  "proposed_end",
  "estimated_days",
  "deposit_received",
  "colors_confirmed",
  "contract_amount_cents",
  "target_payout_cents",
];
const PRICING_FIELDS = ["contract_amount_cents", "target_payout_cents"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function updateJob(actor: Actor | null, id: string, patch: JobUpdate) {
  requirePermission(actor, "jobs.edit");
  if ("contract_amount_cents" in patch) requirePermission(actor, "jobs.view_financials");
  if ("target_payout_cents" in patch) requirePermission(actor, "jobs.view_financials");
  for (const f of ["proposed_start", "proposed_end"] as const) {
    const v = patch[f];
    if (v && !DATE_RE.test(v)) throw new ValidationError(`Invalid date for ${f}`);
  }
  if (patch.proposed_start && patch.proposed_end && patch.proposed_end < patch.proposed_start)
    throw new ValidationError("End date can't be before start date");

  const db = await getDb();
  return db.transaction(async (tx) => {
    const before = await loadJobRow(tx, id);
    // only whitelisted column names ever reach the SQL string
    const keys = EDITABLE_FIELDS.filter((k) => patch[k] !== undefined);
    if (!keys.length) return before;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const { rows } = await tx.query<JobRow>(
      `update jobs set ${sets}, updated_at = now() where id = $1 returning *`,
      [id, ...keys.map((k) => patch[k])],
    );
    const after = rows[0];
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      const pricing = changed.filter((k) => (PRICING_FIELDS as readonly string[]).includes(k));
      const pick = (r: JobRow, ks: string[]) => Object.fromEntries(ks.map((k) => [k, r[k as keyof JobRow]]));
      if (pricing.length)
        await audit(tx, actor, {
          action: "job.pricing_changed",
          entityType: "job",
          entityId: id,
          jobId: id,
          before: pick(before, pricing),
          after: pick(after, pricing),
        });
      const other = changed.filter((k) => !pricing.includes(k as never));
      if (other.length)
        await audit(tx, actor, {
          action: "job.updated",
          entityType: "job",
          entityId: id,
          jobId: id,
          before: pick(before, other),
          after: pick(after, other),
        });
    }
    // Promote draft -> ready automatically when every blocking check passes
    const photos = await tx.query<{ n: number }>(
      "select count(*)::int as n from job_photos where job_id = $1 and share_with_crew",
      [id],
    );
    const r = jobReadiness({ ...after, crew_photo_count: photos.rows[0].n });
    if (after.status === "draft" && r.ready) {
      await tx.query("update jobs set status = 'ready' where id = $1", [id]);
      await audit(tx, actor, { action: "job.status_changed", entityType: "job", entityId: id, jobId: id, before: { status: "draft" }, after: { status: "ready" } });
    } else if (after.status === "ready" && !r.ready) {
      await tx.query("update jobs set status = 'draft' where id = $1", [id]);
      await audit(tx, actor, { action: "job.status_changed", entityType: "job", entityId: id, jobId: id, before: { status: "ready" }, after: { status: "draft" } });
    }
    return after;
  });
}

export async function updateSchedule(actor: Actor | null, id: string, start: string | null, end: string | null) {
  requirePermission(actor, "schedule.edit");
  if ((start && !DATE_RE.test(start)) || (end && !DATE_RE.test(end))) throw new ValidationError("Invalid date");
  if (start && end && end < start) throw new ValidationError("End date can't be before start date");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = await loadJobRow(tx, id);
    if (!before.assigned_sub_id) throw new ValidationError("Assign a crew before scheduling");
    await tx.query("update jobs set scheduled_start = $2, scheduled_end = $3, updated_at = now() where id = $1", [id, start, end]);
    await audit(tx, actor, {
      action: "job.schedule_changed",
      entityType: "job",
      entityId: id,
      jobId: id,
      before: { scheduled_start: before.scheduled_start, scheduled_end: before.scheduled_end },
      after: { scheduled_start: start, scheduled_end: end },
    });
  });
}

export async function setJobStatus(actor: Actor | null, id: string, status: "in_progress" | "complete" | "cancelled") {
  requirePermission(actor, "jobs.edit");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const before = await loadJobRow(tx, id);
    const allowed: Record<string, string[]> = {
      in_progress: ["assigned"],
      complete: ["assigned", "in_progress"],
      cancelled: ["draft", "ready", "offering", "assigned", "in_progress"],
    };
    if (!allowed[status].includes(before.status)) throw new ValidationError(`Can't move a ${before.status} job to ${status}`);
    await tx.query("update jobs set status = $2, updated_at = now() where id = $1", [id, status]);
    await audit(tx, actor, { action: "job.status_changed", entityType: "job", entityId: id, jobId: id, before: { status: before.status }, after: { status } });
    if (status === "cancelled") {
      const { rows } = await tx.query<{ id: string; subcontractor_id: string }>(
        `update offers set status = 'withdrawn', updated_at = now()
          where job_id = $1 and status in ('draft','sent','countered','walkthrough_requested','accepted')
          returning id, subcontractor_id`,
        [id],
      );
      for (const o of rows)
        await audit(tx, actor, { action: "offer.withdrawn", entityType: "offer", entityId: o.id, jobId: id, after: { reason: "job cancelled" } });
    }
  });
}

export async function calendarEntries(actor: Actor | null, fromISO: string, toISO: string) {
  requirePermission(actor, "jobs.view");
  const db = await getDb();
  const { rows } = await db.query<{
    id: string;
    job_number: string;
    title: string;
    city: string;
    status: string;
    start: string;
    end: string | null;
    tentative: boolean;
    crew: string | null;
  }>(
    `select j.id, j.job_number, j.title, j.city, j.status,
            coalesce(j.scheduled_start, j.proposed_start) as start,
            coalesce(j.scheduled_end, j.proposed_end) as "end",
            (j.scheduled_start is null) as tentative,
            s.company_name as crew
       from jobs j left join subcontractors s on s.id = j.assigned_sub_id
      where j.status <> 'cancelled'
        and coalesce(j.scheduled_start, j.proposed_start) is not null
        and coalesce(j.scheduled_start, j.proposed_start) <= $2
        and coalesce(j.scheduled_end, j.proposed_end, j.scheduled_start, j.proposed_start) >= $1
      order by start`,
    [fromISO, toISO],
  );
  return rows;
}
