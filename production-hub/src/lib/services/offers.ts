/**
 * Private offers — STAFF side.
 *
 * Flow:  draft → sent → (sub responds) → accepted → awarded
 *                         ↘ countered → owner approves → accepted
 *                                     ↘ owner rejects  → sent again
 * Every price or assignment change writes an audit_log row in the same transaction.
 */
import type { Actor } from "@/lib/auth/core";
import { getDb, type Queryable } from "@/lib/db";
import { formatMoney } from "@/lib/domain";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { audit, isUuid, notifyStaff, notifySub, queueOutbound, requirePermission } from "./common";
import { loadJobRow, type JobRow } from "./jobs";
import { jobReadiness, matchSubs, type MatchSubInput } from "./rules";
import { getMatchingRules } from "./settings";
import { loadSubDocs, type SubRow } from "./subs";

export interface OfferRow {
  id: string;
  job_id: string;
  subcontractor_id: string;
  payout_cents: number;
  proposed_start: string | null;
  proposed_end: string | null;
  note_to_sub: string | null;
  status: string;
  created_by: string;
  sent_by: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResponseRow {
  id: string;
  offer_id: string;
  kind: "accept" | "decline" | "walkthrough_request" | "start_date" | "counteroffer";
  amount_cents: number | null;
  suggested_start: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  review_status: "none" | "pending" | "approved" | "rejected";
  coordinator_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadOffer(q: Queryable, id: string): Promise<OfferRow> {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await q.query<OfferRow>("select * from offers where id = $1 for update", [id]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

async function crewPhotoCount(q: Queryable, jobId: string) {
  const { rows } = await q.query<{ n: number }>(
    "select count(*)::int as n from job_photos where job_id = $1 and share_with_crew",
    [jobId],
  );
  return rows[0].n;
}

async function assertJobReady(q: Queryable, job: JobRow) {
  const r = jobReadiness({ ...job, crew_photo_count: await crewPhotoCount(q, job.id) });
  if (!r.ready) {
    const failing = r.checks.filter((c) => c.blocking && !c.ok).map((c) => c.label);
    throw new ValidationError(`Job isn't ready for offers: ${failing.join("; ")}`);
  }
}

async function loadMatchInputs(q: Queryable, subIds?: string[]): Promise<MatchSubInput[]> {
  const { rows } = await q.query<SubRow & { active_job_count: number }>(
    `select s.*, (select count(*)::int from jobs j where j.assigned_sub_id = s.id and j.status in ('assigned','in_progress')) as active_job_count
       from subcontractors s ${subIds ? "where s.id = any($1)" : "where s.status <> 'inactive'"}`,
    subIds ? [subIds] : [],
  );
  const docs = await loadSubDocs(q, rows.map((r) => r.id));
  return rows.map((s) => ({ ...s, documents: docs.filter((d) => d.subcontractor_id === s.id) }));
}

/** Ranked list of subs for a job, with the reason for each yes/no. */
export async function suggestSubs(actor: Actor | null, jobId: string) {
  requirePermission(actor, "offers.create");
  const db = await getDb();
  const job = await loadJobRow(db, jobId);
  const rules = await getMatchingRules();
  return matchSubs(job, await loadMatchInputs(db), rules);
}

export async function listOffersForJob(actor: Actor | null, jobId: string) {
  requirePermission(actor, "jobs.view");
  const db = await getDb();
  const offers = await db.query<OfferRow & { company_name: string }>(
    `select o.*, s.company_name from offers o join subcontractors s on s.id = o.subcontractor_id
      where o.job_id = $1 order by o.created_at`,
    [jobId],
  );
  const responses = await db.query<ResponseRow & { author_name: string; reviewer_name: string | null }>(
    `select r.*, u.name as author_name, rv.name as reviewer_name from offer_responses r
       join offers o on o.id = r.offer_id join users u on u.id = r.created_by left join users rv on rv.id = r.reviewed_by
      where o.job_id = $1 order by r.created_at`,
    [jobId],
  );
  return offers.rows.map((o) => ({ ...o, responses: responses.rows.filter((r) => r.offer_id === o.id) }));
}

export interface CreateOfferInput {
  jobId: string;
  subcontractorId: string;
  payoutCents: number;
  proposedStart?: string | null;
  proposedEnd?: string | null;
  noteToSub?: string | null;
  expiresAt?: string | null;
  /** Owner only: offer to a sub that fails a soft matching rule (never compliance). */
  overrideReason?: string | null;
}

export async function createOffer(actor: Actor | null, input: CreateOfferInput) {
  requirePermission(actor, "offers.create");
  if (!Number.isInteger(input.payoutCents) || input.payoutCents <= 0) throw new ValidationError("Enter a payout amount");
  for (const d of [input.proposedStart, input.proposedEnd]) if (d && !DATE_RE.test(d)) throw new ValidationError("Invalid date");
  if (!isUuid(input.subcontractorId)) throw new NotFoundError();
  const db = await getDb();
  const rules = await getMatchingRules();
  return db.transaction(async (tx) => {
    const job = await loadJobRow(tx, input.jobId);
    await assertJobReady(tx, job);

    const [sub] = await loadMatchInputs(tx, [input.subcontractorId]);
    if (!sub) throw new NotFoundError();
    const [match] = matchSubs(job, [sub], rules);
    if (!match.complianceOk) {
      throw new ValidationError(`${sub.company_name} isn't compliant: ${match.reasons.filter((r) => !r.ok).map((r) => r.text).join("; ")}`);
    }
    if (!match.eligible) {
      if (!input.overrideReason?.trim())
        throw new ValidationError(`${sub.company_name} doesn't meet the matching rules: ${match.reasons.filter((r) => !r.ok).map((r) => r.text).join("; ")}`);
      if (!can(actor.role, "settings.edit")) throw new ForbiddenError("Only the owner can override matching rules");
    }

    const existing = await tx.query("select 1 from offers where job_id = $1 and subcontractor_id = $2", [job.id, sub.id]);
    if (existing.rows.length) throw new ValidationError(`${sub.company_name} already has an offer on this job`);

    const { rows } = await tx.query<OfferRow>(
      `insert into offers (job_id, subcontractor_id, payout_cents, proposed_start, proposed_end, note_to_sub, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        job.id,
        sub.id,
        input.payoutCents,
        input.proposedStart || job.proposed_start,
        input.proposedEnd || job.proposed_end,
        input.noteToSub?.trim() || null,
        input.expiresAt || null,
        actor.userId,
      ],
    );
    const offer = rows[0];
    await audit(tx, actor, {
      action: "offer.created",
      entityType: "offer",
      entityId: offer.id,
      jobId: job.id,
      after: {
        subcontractor_id: sub.id,
        payout_cents: offer.payout_cents,
        proposed_start: offer.proposed_start,
        override_reason: match.eligible ? null : input.overrideReason,
      },
    });
    return offer;
  });
}

/** Change the payout or dates on a DRAFT offer (before the sub can see it). */
export async function updateDraftOffer(
  actor: Actor | null,
  offerId: string,
  patch: { payoutCents?: number; proposedStart?: string | null; proposedEnd?: string | null; noteToSub?: string | null },
) {
  requirePermission(actor, "offers.create");
  if (patch.payoutCents !== undefined && (!Number.isInteger(patch.payoutCents) || patch.payoutCents <= 0))
    throw new ValidationError("Enter a payout amount");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const o = await loadOffer(tx, offerId);
    if (o.status !== "draft") throw new ValidationError("Only draft offers can be edited. Withdraw and re-offer instead.");
    const next = {
      payout_cents: patch.payoutCents ?? o.payout_cents,
      proposed_start: patch.proposedStart === undefined ? o.proposed_start : patch.proposedStart,
      proposed_end: patch.proposedEnd === undefined ? o.proposed_end : patch.proposedEnd,
      note_to_sub: patch.noteToSub === undefined ? o.note_to_sub : patch.noteToSub,
    };
    await tx.query(
      "update offers set payout_cents=$2, proposed_start=$3, proposed_end=$4, note_to_sub=$5, updated_at=now() where id=$1",
      [o.id, next.payout_cents, next.proposed_start, next.proposed_end, next.note_to_sub],
    );
    if (next.payout_cents !== o.payout_cents)
      await audit(tx, actor, {
        action: "offer.payout_changed",
        entityType: "offer",
        entityId: o.id,
        jobId: o.job_id,
        before: { payout_cents: o.payout_cents },
        after: { payout_cents: next.payout_cents },
      });
    if (next.proposed_start !== o.proposed_start || next.proposed_end !== o.proposed_end)
      await audit(tx, actor, {
        action: "offer.dates_changed",
        entityType: "offer",
        entityId: o.id,
        jobId: o.job_id,
        before: { proposed_start: o.proposed_start, proposed_end: o.proposed_end },
        after: { proposed_start: next.proposed_start, proposed_end: next.proposed_end },
      });
  });
}

/**
 * Send = the sub can now see the offer in their portal. This commits PB to the payout,
 * so payouts above the job's target need the owner. Only an in-app notification is created;
 * any text message is queued for owner approval and NOT sent.
 */
export async function sendOffer(actor: Actor | null, offerId: string) {
  requirePermission(actor, "offers.send");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const o = await loadOffer(tx, offerId);
    if (o.status !== "draft") throw new ValidationError("This offer was already sent");
    const job = await loadJobRow(tx, o.job_id);
    await assertJobReady(tx, job);
    if (job.target_payout_cents != null && o.payout_cents > job.target_payout_cents && !can(actor.role, "offers.send_above_target"))
      throw new ForbiddenError(`Payout is above the ${formatMoney(job.target_payout_cents)} target — the owner needs to send this one`);

    // compliance can lapse between drafting and sending
    const [sub] = await loadMatchInputs(tx, [o.subcontractor_id]);
    const [match] = matchSubs(job, [sub], await getMatchingRules(tx));
    if (!match.complianceOk) throw new ValidationError(`${sub.company_name} is no longer compliant — check insurance`);

    await tx.query("update offers set status = 'sent', sent_by = $2, sent_at = now(), updated_at = now() where id = $1", [o.id, actor.userId]);
    if (job.status === "ready" || job.status === "draft") await tx.query("update jobs set status = 'offering', updated_at = now() where id = $1", [job.id]);
    await audit(tx, actor, {
      action: "offer.sent",
      entityType: "offer",
      entityId: o.id,
      jobId: job.id,
      after: { subcontractor_id: o.subcontractor_id, payout_cents: o.payout_cents, proposed_start: o.proposed_start },
    });
    await notifySub(tx, o.subcontractor_id, `New job offer: ${job.title}`, `${job.city} · ${formatMoney(o.payout_cents)}`, `/crew/offers/${o.id}`);
    await queueOutbound(tx, actor, "sms", sub.phone, {
      template: "new_offer",
      text: `PB Painting: you have a new job offer in your Crew Portal (${job.city}). Log in to review.`,
      offer_id: o.id,
    });
  });
}

export async function withdrawOffer(actor: Actor | null, offerId: string, reason?: string) {
  requirePermission(actor, "offers.withdraw");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const o = await loadOffer(tx, offerId);
    if (["awarded", "withdrawn", "not_selected", "declined"].includes(o.status)) throw new ValidationError("Offer is already closed");
    await tx.query("update offers set status = 'withdrawn', updated_at = now() where id = $1", [o.id]);
    await tx.query("update offer_responses set review_status = 'rejected', review_note = 'Offer withdrawn', reviewed_by = $2, reviewed_at = now() where offer_id = $1 and review_status = 'pending'", [o.id, actor.userId]);
    await audit(tx, actor, { action: "offer.withdrawn", entityType: "offer", entityId: o.id, jobId: o.job_id, before: { status: o.status }, after: { status: "withdrawn", reason: reason ?? null } });
    if (o.status !== "draft") await notifySub(tx, o.subcontractor_id, "An offer is no longer available", "PB Painting closed one of your job offers.", `/crew/offers/${o.id}`);
    await refreshJobOfferingStatus(tx, o.job_id);
  });
}

/** If a job in "offering" has no open offers left, move it back to "ready". */
async function refreshJobOfferingStatus(tx: Queryable, jobId: string) {
  const { rows } = await tx.query<{ n: number }>(
    "select count(*)::int as n from offers where job_id = $1 and status in ('sent','countered','walkthrough_requested','accepted')",
    [jobId],
  );
  if (rows[0].n === 0) await tx.query("update jobs set status = 'ready', updated_at = now() where id = $1 and status = 'offering'", [jobId]);
}

/** Coordinator adds a recommendation to a pending counteroffer. Does not approve it. */
export async function recommendCounter(actor: Actor | null, responseId: string, note: string) {
  requirePermission(actor, "counteroffers.recommend");
  if (!isUuid(responseId)) throw new NotFoundError();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<ResponseRow & { job_id: string }>(
      "update offer_responses r set coordinator_note = $2 from offers o where r.id = $1 and o.id = r.offer_id and r.review_status = 'pending' returning r.*, o.job_id",
      [responseId, note.trim()],
    );
    if (!rows[0]) throw new NotFoundError();
    await audit(tx, actor, { action: "counteroffer.recommended", entityType: "offer", entityId: rows[0].offer_id, jobId: rows[0].job_id, after: { response_id: responseId, note } });
    await notifyStaff(tx, "Counteroffer recommendation added", note.slice(0, 140), `/hub/approvals`, true);
  });
}

/** Owner decision on a counteroffer. Approving changes the offer's payout. */
export async function reviewCounter(actor: Actor | null, responseId: string, decision: "approve" | "reject", note?: string) {
  requirePermission(actor, "counteroffers.approve");
  if (!isUuid(responseId)) throw new NotFoundError();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<ResponseRow>("select * from offer_responses where id = $1 for update", [responseId]);
    const r = rows[0];
    if (!r || r.kind !== "counteroffer") throw new NotFoundError();
    if (r.review_status !== "pending") throw new ValidationError("This counteroffer was already reviewed");
    const o = await loadOffer(tx, r.offer_id);
    if (o.status !== "countered") throw new ValidationError("Offer is no longer open");
    const job = await loadJobRow(tx, o.job_id);

    await tx.query(
      "update offer_responses set review_status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 where id = $1",
      [r.id, decision === "approve" ? "approved" : "rejected", actor.userId, note?.trim() || null],
    );
    if (decision === "approve") {
      await tx.query("update offers set payout_cents = $2, status = 'accepted', updated_at = now() where id = $1", [o.id, r.amount_cents]);
      await audit(tx, actor, {
        action: "offer.payout_changed",
        entityType: "offer",
        entityId: o.id,
        jobId: o.job_id,
        before: { payout_cents: o.payout_cents, status: o.status },
        after: { payout_cents: r.amount_cents, status: "accepted", reason: "counteroffer approved", response_id: r.id },
      });
      await notifySub(tx, o.subcontractor_id, `Counteroffer approved: ${job.title}`, `PB approved ${formatMoney(r.amount_cents)}. We'll confirm the schedule with you.`, `/crew/offers/${o.id}`);
    } else {
      await tx.query("update offers set status = 'sent', updated_at = now() where id = $1", [o.id]);
      await audit(tx, actor, {
        action: "counteroffer.rejected",
        entityType: "offer",
        entityId: o.id,
        jobId: o.job_id,
        before: { status: o.status },
        after: { status: "sent", response_id: r.id, requested_cents: r.amount_cents, payout_cents: o.payout_cents },
      });
      await notifySub(tx, o.subcontractor_id, `Counteroffer not approved: ${job.title}`, `The original offer of ${formatMoney(o.payout_cents)} is still open.`, `/crew/offers/${o.id}`);
    }
  });
}

/** Accept a start date the sub suggested — updates the offer's proposed start. */
export async function acceptSuggestedStart(actor: Actor | null, responseId: string) {
  requirePermission(actor, "schedule.edit");
  if (!isUuid(responseId)) throw new NotFoundError();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<ResponseRow>("select * from offer_responses where id = $1", [responseId]);
    const r = rows[0];
    if (!r || r.kind !== "start_date" || !r.suggested_start) throw new NotFoundError();
    const o = await loadOffer(tx, r.offer_id);
    if (["awarded", "withdrawn", "not_selected", "declined"].includes(o.status)) throw new ValidationError("Offer is closed");
    await tx.query("update offers set proposed_start = $2, updated_at = now() where id = $1", [o.id, r.suggested_start]);
    await tx.query("update offer_responses set review_status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1", [r.id, actor.userId]);
    await audit(tx, actor, { action: "offer.dates_changed", entityType: "offer", entityId: o.id, jobId: o.job_id, before: { proposed_start: o.proposed_start }, after: { proposed_start: r.suggested_start, reason: "sub suggestion accepted" } });
    await notifySub(tx, o.subcontractor_id, "Start date updated", `PB accepted your suggested start date.`, `/crew/offers/${o.id}`);
  });
}

/**
 * Award the job to a sub whose offer is accepted. Every other open offer on the job
 * closes as "not selected" — those subs are told only that the job is no longer available.
 */
export async function awardOffer(actor: Actor | null, offerId: string, schedule: { start?: string | null; end?: string | null } = {}) {
  requirePermission(actor, "offers.award");
  for (const d of [schedule.start, schedule.end]) if (d && !DATE_RE.test(d)) throw new ValidationError("Invalid date");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const o = await loadOffer(tx, offerId);
    if (o.status !== "accepted") throw new ValidationError("Only an accepted offer can be awarded");
    const job = await loadJobRow(tx, o.job_id);
    if (job.assigned_sub_id) throw new ValidationError("Job is already assigned");
    if (!["ready", "offering"].includes(job.status)) throw new ValidationError(`Job is ${job.status}`);
    const start = schedule.start || o.proposed_start;
    const end = schedule.end || o.proposed_end;

    await tx.query("update offers set status = 'awarded', updated_at = now() where id = $1", [o.id]);
    await tx.query(
      `update jobs set status = 'assigned', assigned_sub_id = $2, assigned_payout_cents = $3,
              scheduled_start = $4, scheduled_end = $5, updated_at = now() where id = $1`,
      [job.id, o.subcontractor_id, o.payout_cents, start, end],
    );
    await audit(tx, actor, {
      action: "job.assigned",
      entityType: "job",
      entityId: job.id,
      jobId: job.id,
      before: { assigned_sub_id: job.assigned_sub_id, assigned_payout_cents: job.assigned_payout_cents, status: job.status },
      after: { assigned_sub_id: o.subcontractor_id, assigned_payout_cents: o.payout_cents, status: "assigned", offer_id: o.id, scheduled_start: start, scheduled_end: end },
    });
    await notifySub(tx, o.subcontractor_id, `Job awarded: ${job.title}`, `You're on the schedule${start ? ` starting ${start}` : ""}.`, `/crew/offers/${o.id}`);

    const others = await tx.query<{ id: string; subcontractor_id: string; status: string }>(
      `update offers set status = case when status = 'draft' then 'withdrawn' else 'not_selected' end, updated_at = now()
        where job_id = $1 and id <> $2 and status in ('draft','sent','countered','walkthrough_requested','accepted')
        returning id, subcontractor_id, status`,
      [job.id, o.id],
    );
    for (const x of others.rows) {
      await tx.query("update offer_responses set review_status = 'rejected', review_note = 'Job awarded', reviewed_by = $2, reviewed_at = now() where offer_id = $1 and review_status = 'pending'", [x.id, actor.userId]);
      await audit(tx, actor, { action: "offer.closed", entityType: "offer", entityId: x.id, jobId: job.id, after: { status: x.status, reason: "job awarded" } });
      if (x.status === "not_selected") await notifySub(tx, x.subcontractor_id, "An offer is no longer available", "PB Painting closed one of your job offers.", `/crew/offers/${x.id}`);
    }
  });
}

export async function pendingApprovals(actor: Actor | null) {
  requirePermission(actor, "counteroffers.recommend");
  const db = await getDb();
  const { rows } = await db.query<
    ResponseRow & { job_id: string; job_number: string; title: string; company_name: string; payout_cents: number; target_payout_cents: number | null; contract_amount_cents: number | null }
  >(
    `select r.*, o.job_id, j.job_number, j.title, s.company_name, o.payout_cents, j.target_payout_cents, j.contract_amount_cents
       from offer_responses r join offers o on o.id = r.offer_id join jobs j on j.id = o.job_id join subcontractors s on s.id = o.subcontractor_id
      where r.kind = 'counteroffer' and r.review_status = 'pending' order by r.created_at`,
  );
  const fin = can(actor.role, "jobs.view_financials");
  return rows.map((r) => ({ ...r, contract_amount_cents: fin ? r.contract_amount_cents : null }));
}
