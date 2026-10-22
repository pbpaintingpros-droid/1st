"use server";

import { runAction, str } from "@/lib/actions";
import { getActor } from "@/lib/auth/session";
import { saveMatchingRules } from "@/lib/services/settings";

export async function saveRulesAction(f: FormData) {
  await runAction("/hub/settings", async () => {
    await saveMatchingRules(await getActor(), {
      requireAllSkills: f.get("requireAllSkills") === "on",
      requireServiceArea: f.get("requireServiceArea") === "on",
      respectCapacity: f.get("respectCapacity") === "on",
      minQualityRating: str(f, "minQualityRating") ? Number(str(f, "minQualityRating")) : null,
      insuranceExpiryWarningDays: Number(str(f, "insuranceExpiryWarningDays") || 30),
    });
    return "Matching rules saved";
  });
}
