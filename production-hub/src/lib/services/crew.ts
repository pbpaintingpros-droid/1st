/**
 * PB Crew Portal — SUBCONTRACTOR side.
 *
 * CONFIDENTIALITY RULES (covered by tests/bid-confidentiality.test.ts):
 *  - A sub only ever sees offers addressed to their own company, and never drafts.
 *  - Anything else returns "Not found" (not "Forbidden"), so a sub can't probe for other offers.
 *  - Crew views are built field-by-field below. Never spread a database row into them.
 *  - Never included: other subs' names or bids, how many subs were offered the job,
 *    customer contract amount, PB's target payout, margins, internal notes, customer phone.
 *  - No competition or urgency indicators of any kind ("3 crews interested", etc.).
 */
import type { Actor } from "@/lib/auth/core";
import { getDb, type Queryable } from "@/lib/db";
import { formatMoney } from "@/lib/domain";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit, isUuid, notifyStaff, requireSub } from "./common";
import type { OfferRow, ResponseRow } from "./offers";

/** What the sub sees as the status. "not_selected" and "withdrawn" both read as "closed". */
export type CrewOfferStatus =
  | "new"
  | "accepted"
  | "counter_pending"
  | "walkthrough_requested"
  | "declined"
  | "awarded"
  | "closed";

export interface CrewOfferSummary {
  id: string;
  status: CrewOfferStatus;
  title: string;
  city: string;
  services: string[];
  payoutCents: number;
  proposedStart: string | null;
  proposedEnd: string | null;
  sentAt: string | null;
}

export interface CrewOfferDetail extends CrewOfferSummary {
  jobNumber: string;
  address: string | null; // hidden once the offer is closed
  workOrder: string | null;
  estimatedDays: number | null;
  noteFromPB: string | null;
  expiresAt: string | null;
  photos: { id: string; caption: string | null }[];
  /** only after the job is awarded to this sub */
  customerName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  myResponses: {
    kind: ResponseRow["kind"];
    amountCents: number | null;
    suggestedStart: string | null;
    note: string | null;
    createdAt: string;
    outcome: "pending" | "approved" | "not_approved" | null;
  }[];
  allowedActions: CrewAction[];
}

export type CrewAction = "accept" | "decline" | "walkthrough_request" | "start_date" | "counteroffer";

function crewStatus(status: string): CrewOfferStatus {
  switch (status) {
    case "sent":
      return "new";
    case "accepted":
      return "accepted";
    case "countered":
      return "counter_pending";
    case "walkthrough_requested":
      return "walkthrough_requested";
    case "declined":
      return "declined";
    case "awarded":
      return "awarded";
    default:
      return "closed";
  }
}

export function allowedActions(status: string): CrewAction[] {
  switch (status) {
    case "sent":
    case "walkthrough_requested":
      return ["accept", "decline", "walkthrough_request", "start_date", "counteroffer"];
    case "countered":
      return ["decline", "start_date"];
    case "accepted":
      return ["decline", "start_date"];
    default:
      return [];
  }
}

function firstNameLastInitial(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

type CrewJoinRow = OfferRow & {
  j_job_number: string;
  j_title: string;
  j_city: string;
  j_address: string;
  j_services: string[];
  j_work_order: string | null;
  j_estimated_days: number | null;
  j_customer_name: string;
  j_scheduled_start: string | null;
  j_scheduled_end: string | null;
};

const CREW_SELECT = `
  select o.*, j.job_number as j_job_number, j.title as j_title, j.city as j_city, j.address as j_address,
         j.services as j_services, j.work_order as j_work_order, j.estimated_days as j_estimated_days,
         j.customer_name as j_customer_name, j.scheduled_start as j_scheduled_start, j.scheduled_end as j_scheduled_end
    from offers o join jobs j on j.id = o.job_id`;

function toSummary(r: CrewJoinRow): CrewOfferSummary {
  return {
    id: r.id,
    status: crewStatus(r.status),
    title: r.j_title,
    city: r.j_city,
    services: [...r.j_services],
    payoutCents: r.payout_cents,
    proposedStart: r.proposed_start,
    proposedEnd: r.proposed_end,
    sentAt: r.sent_at,
  };
}

/** Loads one offer for this sub. Anything not theirs, or still a draft, is "Not found". */
async function loadOwnOffer(q: Queryable, actor: { subcontractorId: string }, offerId: string, lock = false) {
  if (!isUuid(offerId)) throw new NotFoundError();
  const { rows } = await q.query<CrewJoinRow>(
    `${CREW_SELECT} where o.id = $1 and o.subcontractor_id = $2 and o.status <> 'draft' ${lock ? "for update of o" : ""}`,
    [offerId, actor.subcontractorId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function listMyOffers(actor: Actor | null): Promise<CrewOfferSummary[]> {
  requireSub(actor);
  const db = await getDb();
  const { rows } = await db.query<CrewJoinRow>(
    `${CREW_SELECT} where o.subcontractor_id = $1 and o.status <> 'draft' order by o.sent_at desc nulls last`,
    [actor.subcontractorId],
  );
  return rows.map(toSummary);
}

export async function getMyOffer(actor: Actor | null, offerId: string): Promise<CrewOfferDetail> {
  requireSub(actor);
  const db = await getDb();
  const r = await loadOwnOffer(db, actor, offerId);
  if (!r.first_viewed_at) await db.query("update offers set first_viewed_at = now() where id = $1", [r.id]);

  const closed = ["not_selected", "withdrawn"].includes(r.status);
  const awarded = r.status === "awarded";
  const photos = closed
    ? []
    : (
        await db.query<{ id: string; caption: string | null }>(
          "select id, caption from job_photos where job_id = $1 and share_with_crew order by created_at",
          [r.job_id],
        )
      ).rows.map((p) => ({ id: p.id, caption: p.caption }));
  const responses = await db.query<ResponseRow>(
    "select * from offer_responses where offer_id = $1 and created_by in (select id from users where subcontractor_id = $2) order by created_at",
    [r.id, actor.subcontractorId],
  );

  return {
    ...toSummary(r),
    jobNumber: r.j_job_number,
    address: closed ? null : r.j_address,
    workOrder: closed ? null : r.j_work_order,
    estimatedDays: r.j_estimated_days,
    noteFromPB: r.note_to_sub,
    expiresAt: r.expires_at,
    photos,
    customerName: awarded ? firstNameLastInitial(r.j_customer_name) : null,
    scheduledStart: awarded ? r.j_scheduled_start : null,
    scheduledEnd: awarded ? r.j_scheduled_end : null,
    myResponses: responses.rows.map((x) => ({
      kind: x.kind,
      amountCents: x.amount_cents,
      suggestedStart: x.suggested_start,
      note: x.note,
      createdAt: x.created_at,
      outcome:
        x.review_status === "pending"
          ? "pending"
          : x.review_status === "approved"
            ? "approved"
            : x.review_status === "rejected"
              ? "not_approved"
              : null,
    })),
    allowedActions: allowedActions(r.status),
  };
}

export interface CrewResponseInput {
  kind: CrewAction;
  amountCents?: number | null;
  suggestedStart?: string | null;
  note?: string | null;
}

export async function respondToOffer(actor: Actor | null, offerId: string, input: CrewResponseInput) {
  requireSub(actor);
  const note = input.note?.trim().slice(0, 2000) || null;
  if (input.kind === "counteroffer") {
    if (!Number.isInteger(input.amountCents) || (input.amountCents ?? 0) <= 0) throw new ValidationError("Enter your price");
  }
  if (input.kind === "start_date") {
    if (!input.suggestedStart || !/^\d{4}-\d{2}-\d{2}$/.test(input.suggestedStart)) throw new ValidationError("Pick a start date");
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadOwnOffer(tx, actor, offerId, true);
    if (r.expires_at && new Date(r.expires_at) < new Date() && r.status === "sent")
      throw new ValidationError("This offer has expired");
    if (!allowedActions(r.status).includes(input.kind)) throw new ValidationError("That option isn't available for this offer");

    const isCounter = input.kind === "counteroffer";
    await tx.query(
      `insert into offer_responses (offer_id, kind, amount_cents, suggested_start, note, created_by, review_status)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        r.id,
        input.kind,
        isCounter ? input.amountCents : null,
        input.kind === "start_date" ? input.suggestedStart : null,
        note,
        actor.userId,
        isCounter ? "pending" : "none",
      ],
    );

    const nextStatus: Record<CrewAction, string | null> = {
      accept: "accepted",
      decline: "declined",
      walkthrough_request: "walkthrough_requested",
      counteroffer: "countered",
      start_date: null,
    };
    const next = nextStatus[input.kind];
    if (next) {
      await tx.query("update offers set status = $2, updated_at = now() where id = $1", [r.id, next]);
      if (input.kind === "decline")
        // a decline cancels any counteroffer still waiting for review
        await tx.query("update offer_responses set review_status = 'rejected', review_note = 'Sub declined' where offer_id = $1 and review_status = 'pending'", [r.id]);
    }

    await audit(tx, actor, {
      action: `offer.sub_${input.kind}`,
      entityType: "offer",
      entityId: r.id,
      jobId: r.job_id,
      before: { status: r.status, payout_cents: r.payout_cents },
      after: {
        status: next ?? r.status,
        ...(isCounter ? { requested_cents: input.amountCents } : {}),
        ...(input.kind === "start_date" ? { suggested_start: input.suggestedStart } : {}),
      },
    });

    const company = (await tx.query<{ company_name: string }>("select company_name from subcontractors where id = $1", [actor.subcontractorId])).rows[0].company_name;
    const label: Record<CrewAction, string> = {
      accept: "accepted",
      decline: "declined",
      walkthrough_request: "requested a walkthrough for",
      start_date: `suggested ${input.suggestedStart} as the start for`,
      counteroffer: `countered at ${formatMoney(input.amountCents)} on`,
    };
    await notifyStaff(tx, `${company} ${label[input.kind]} ${r.j_job_number}`, note ?? "", isCounter ? "/hub/approvals" : `/hub/jobs/${r.job_id}`);
  });
}

/** Photos a sub may download: shared with crew, on a job they hold an open/awarded offer for. */
export async function canSubSeePhoto(q: Queryable, subcontractorId: string, photoId: string): Promise<boolean> {
  if (!isUuid(photoId)) return false;
  const { rows } = await q.query(
    `select 1 from job_photos p join offers o on o.job_id = p.job_id
      where p.id = $1 and p.share_with_crew and o.subcontractor_id = $2
        and o.status in ('sent','accepted','countered','walkthrough_requested','awarded','declined')`,
    [photoId, subcontractorId],
  );
  return rows.length > 0;
}
