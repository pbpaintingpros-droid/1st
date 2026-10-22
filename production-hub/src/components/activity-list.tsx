import Link from "next/link";
import { formatMoney } from "@/lib/domain";
import type { AuditRow } from "@/lib/services/activity";
import { Empty } from "./ui";

const LABELS: Record<string, string> = {
  "job.pricing_changed": "Changed job pricing",
  "job.updated": "Edited job",
  "job.status_changed": "Changed job status",
  "job.schedule_changed": "Changed schedule",
  "job.assigned": "Assigned job",
  "job.imported": "Imported job",
  "offer.created": "Created draft offer",
  "offer.sent": "Sent offer",
  "offer.payout_changed": "Changed offer payout",
  "offer.dates_changed": "Changed offer dates",
  "offer.withdrawn": "Withdrew offer",
  "offer.closed": "Closed offer (job awarded)",
  "offer.sub_accept": "Sub accepted",
  "offer.sub_decline": "Sub declined",
  "offer.sub_walkthrough_request": "Sub requested walkthrough",
  "offer.sub_start_date": "Sub suggested start date",
  "offer.sub_counteroffer": "Sub counteroffered",
  "counteroffer.recommended": "Added counteroffer recommendation",
  "counteroffer.rejected": "Rejected counteroffer",
  "sub.created": "Added subcontractor",
  "sub.updated": "Edited subcontractor",
  "sub.document_added": "Added document",
  "sub.document_verified": "Verified document",
  "sub.onboarding_step": "Updated onboarding",
  "settings.matching_rules_changed": "Changed matching rules",
  "user.created": "Created login",
};

function describe(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  return Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => x !== null && x !== undefined && typeof x !== "object" && !k.endsWith("_id"))
    .map(([k, x]) => `${k.replace(/_cents$/, "").replace(/_/g, " ")}: ${k.endsWith("_cents") ? formatMoney(Number(x)) : String(x)}`)
    .join(", ");
}

export function ActivityList({ rows, showJob = false }: { rows: AuditRow[]; showJob?: boolean }) {
  if (!rows.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="space-y-2.5">
      {rows.map((r) => {
        const pricing = /pricing|payout|assigned|counter/.test(r.action);
        return (
          <li key={r.id} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-medium ${pricing ? "text-amber-800" : ""}`}>{LABELS[r.action] ?? r.action}</span>
              {showJob && r.job_id && (
                <Link href={`/hub/jobs/${r.job_id}`} className="text-brand-600 hover:underline">{r.job_number}</Link>
              )}
              <span className="text-xs text-slate-500">
                {r.actor_name ?? "System"} ({r.actor_role}) · {new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
            {(r.before != null || r.after != null) && (
              <div className="text-xs text-slate-600">
                {r.before != null && describe(r.before) && <span className="line-through decoration-slate-400">{describe(r.before)}</span>}
                {r.before != null && describe(r.before) && " → "}
                {describe(r.after)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
