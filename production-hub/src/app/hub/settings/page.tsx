import { redirect } from "next/navigation";
import { Card, Flash, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getMatchingRules } from "@/lib/services/settings";
import { saveRulesAction } from "./actions";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  if (!can(actor.role, "settings.edit")) redirect("/hub");
  const rules = await getMatchingRules();
  return (
    <>
      <PageHeader title="Settings" subtitle="Owner only" />
      <Flash searchParams={await searchParams} />
      <Card title="Subcontractor matching rules">
        <form action={saveRulesAction} className="space-y-4">
          <p className="text-sm text-slate-600">
            These decide which subs show as a “Match” when you offer a job. Insurance, W-9 and a signed agreement are <b>always</b> required — those can’t be turned off or overridden.
          </p>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="requireAllSkills" defaultChecked={rules.requireAllSkills} className="mt-1" />
            <span><span className="font-medium">Must do every service on the job</span><span className="block text-sm text-slate-500">e.g. an exterior + wrought-iron job needs a sub who lists both</span></span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="requireServiceArea" defaultChecked={rules.requireServiceArea} className="mt-1" />
            <span><span className="font-medium">Job city must be in their service area</span></span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="respectCapacity" defaultChecked={rules.respectCapacity} className="mt-1" />
            <span><span className="font-medium">Don’t exceed their max active jobs</span></span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="mqr">Minimum quality rating</label>
              <select id="mqr" name="minQualityRating" defaultValue={rules.minQualityRating ?? ""} className="input">
                <option value="">No minimum</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} stars or better</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ied">Warn when insurance expires within (days)</label>
              <input id="ied" name="insuranceExpiryWarningDays" inputMode="numeric" defaultValue={rules.insuranceExpiryWarningDays} className="input" />
            </div>
          </div>
          <button className="btn-primary">Save rules</button>
        </form>
      </Card>
    </>
  );
}
