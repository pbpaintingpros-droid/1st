"use server";

import { optDate, optStr, runAction, str } from "@/lib/actions";
import { getActor } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import { respondToOffer, type CrewAction } from "@/lib/services/crew";

const KINDS: CrewAction[] = ["accept", "decline", "walkthrough_request", "start_date", "counteroffer"];
const DONE: Record<CrewAction, string> = {
  accept: "Accepted. PB will confirm the schedule with you.",
  decline: "Declined. Thanks for letting us know.",
  walkthrough_request: "Walkthrough requested. PB will reach out to set a time.",
  start_date: "Start date suggestion sent.",
  counteroffer: "Counteroffer sent. PB will review it.",
};

export async function respondAction(f: FormData) {
  const offerId = str(f, "offerId");
  await runAction(`/crew/offers/${offerId}`, async () => {
    const kind = str(f, "kind") as CrewAction;
    if (!KINDS.includes(kind)) throw new ValidationError("Unknown action");
    let amountCents: number | null = null;
    if (kind === "counteroffer") {
      amountCents = parseMoneyToCents(str(f, "amount"));
      if (amountCents == null || Number.isNaN(amountCents)) throw new ValidationError("Enter your price in dollars");
    }
    await respondToOffer(await getActor(), offerId, {
      kind,
      amountCents,
      suggestedStart: optDate(f, "suggested_start"),
      note: optStr(f, "note"),
    });
    return DONE[kind];
  });
}
