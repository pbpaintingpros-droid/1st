"use server";

import { revalidatePath } from "next/cache";
import { optDate, optStr, runAction, str } from "@/lib/actions";
import { getActor } from "@/lib/auth/session";
import { parseMoneyToCents, SERVICE_KEYS } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { setJobStatus, updateJob, updateSchedule, type JobUpdate } from "@/lib/services/jobs";
import { acceptSuggestedStart, awardOffer, createOffer, sendOffer, updateDraftOffer, withdrawOffer } from "@/lib/services/offers";

const back = (f: FormData) => `/hub/jobs/${str(f, "jobId")}`;

function money(f: FormData, k: string, required = false) {
  const c = parseMoneyToCents(str(f, k));
  if (c === null) {
    if (required) throw new ValidationError("Enter an amount");
    return null;
  }
  if (Number.isNaN(c)) throw new ValidationError(`"${str(f, k)}" isn't a dollar amount`);
  return c;
}

export async function updateJobAction(f: FormData) {
  await runAction(back(f), async () => {
    const actor = await getActor();
    const patch: JobUpdate = {
      title: str(f, "title") || undefined,
      work_order: optStr(f, "work_order"),
      internal_notes: optStr(f, "internal_notes"),
      services: f.getAll("services").map(String).filter((s) => SERVICE_KEYS.includes(s)),
      proposed_start: optDate(f, "proposed_start"),
      proposed_end: optDate(f, "proposed_end"),
      estimated_days: str(f, "estimated_days") ? Number(str(f, "estimated_days")) : null,
      deposit_received: f.get("deposit_received") === "on",
      colors_confirmed: f.get("colors_confirmed") === "on",
    };
    if (actor && can(actor.role, "jobs.view_financials")) {
      patch.contract_amount_cents = money(f, "contract_amount");
      patch.target_payout_cents = money(f, "target_payout");
    }
    await updateJob(actor, str(f, "jobId"), patch);
    revalidatePath("/hub");
    return "Job saved";
  });
}

export async function createOfferAction(f: FormData) {
  await runAction(back(f), async () => {
    const offer = await createOffer(await getActor(), {
      jobId: str(f, "jobId"),
      subcontractorId: str(f, "subcontractorId"),
      payoutCents: money(f, "payout", true)!,
      proposedStart: optDate(f, "proposed_start"),
      proposedEnd: optDate(f, "proposed_end"),
      noteToSub: optStr(f, "note_to_sub"),
      overrideReason: optStr(f, "override_reason"),
    });
    if (f.get("send_now") === "on") {
      await sendOffer(await getActor(), offer.id);
      return "Offer sent — it's now visible in that sub's Crew Portal";
    }
    return "Draft offer saved (not visible to the sub until you send it)";
  });
}

export async function updateDraftOfferAction(f: FormData) {
  await runAction(back(f), async () => {
    await updateDraftOffer(await getActor(), str(f, "offerId"), {
      payoutCents: money(f, "payout", true)!,
      proposedStart: optDate(f, "proposed_start"),
      proposedEnd: optDate(f, "proposed_end"),
    });
    return "Draft updated";
  });
}

export async function sendOfferAction(f: FormData) {
  await runAction(back(f), async () => {
    await sendOffer(await getActor(), str(f, "offerId"));
    return "Offer sent — it's now visible in that sub's Crew Portal";
  });
}

export async function withdrawOfferAction(f: FormData) {
  await runAction(back(f), async () => {
    await withdrawOffer(await getActor(), str(f, "offerId"), optStr(f, "reason") ?? undefined);
    return "Offer withdrawn";
  });
}

export async function awardOfferAction(f: FormData) {
  await runAction(back(f), async () => {
    await awardOffer(await getActor(), str(f, "offerId"), { start: optDate(f, "start"), end: optDate(f, "end") });
    revalidatePath("/hub");
    return "Job assigned. Other open offers were closed.";
  });
}

export async function acceptStartAction(f: FormData) {
  await runAction(back(f), async () => {
    await acceptSuggestedStart(await getActor(), str(f, "responseId"));
    return "Proposed start updated";
  });
}

export async function scheduleAction(f: FormData) {
  await runAction(back(f), async () => {
    await updateSchedule(await getActor(), str(f, "jobId"), optDate(f, "start"), optDate(f, "end"));
    return "Schedule saved";
  });
}

export async function statusAction(f: FormData) {
  await runAction(back(f), async () => {
    const s = str(f, "status");
    if (s !== "in_progress" && s !== "complete" && s !== "cancelled") throw new ValidationError("Unknown status");
    await setJobStatus(await getActor(), str(f, "jobId"), s);
    return "Status updated";
  });
}
