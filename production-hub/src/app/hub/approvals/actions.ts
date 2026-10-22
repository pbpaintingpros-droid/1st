"use server";

import { revalidatePath } from "next/cache";
import { optStr, runAction, str } from "@/lib/actions";
import { getActor } from "@/lib/auth/session";
import { recommendCounter, reviewCounter } from "@/lib/services/offers";

export async function reviewAction(f: FormData) {
  await runAction("/hub/approvals", async () => {
    const decision = str(f, "decision") === "approve" ? "approve" : "reject";
    await reviewCounter(await getActor(), str(f, "responseId"), decision, optStr(f, "note") ?? undefined);
    revalidatePath("/hub");
    return decision === "approve" ? "Counteroffer approved — award the job from the job page" : "Counteroffer rejected — the original offer is open again";
  });
}

export async function recommendAction(f: FormData) {
  await runAction("/hub/approvals", async () => {
    await recommendCounter(await getActor(), str(f, "responseId"), str(f, "note"));
    return "Recommendation sent to the owner";
  });
}
