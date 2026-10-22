import Link from "next/link";
import { Badge, Card, Empty, Flash, JobStatusBadge, Money, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, serviceLabel } from "@/lib/domain";
import { listJobs } from "@/lib/services/jobs";
import { listSubs } from "@/lib/services/subs";

export const metadata = { title: "Jobs" };

const FILTERS = [
  { key: "", label: "All open" },
  { key: "draft", label: "Needs info" },
  { key: "ready", label: "Ready to offer" },
  { key: "offering", label: "Offers out" },
  { key: "assigned", label: "Assigned" },
];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const all = await listJobs(actor);
  const open = all.filter((j) => !["complete", "cancelled"].includes(j.status));
  const jobs = sp.status ? all.filter((j) => j.status === sp.status) : open;
  const subs = await listSubs(actor);
  const insuranceIssues = subs.filter((s) => s.status === "active" && s.compliance.checks.some((c) => !c.ok || c.detail?.startsWith("Expires")));

  const stats = [
    { label: "Needs a crew", value: all.filter((j) => ["draft", "ready", "offering"].includes(j.status)).length, href: "/hub" },
    { label: "Offers out", value: all.reduce((n, j) => n + j.open_offer_count, 0), href: "/hub?status=offering" },
    { label: "Counteroffers waiting", value: all.reduce((n, j) => n + j.pending_counter_count, 0), href: "/hub/approvals" },
    { label: "Insurance to check", value: insuranceIssues.length, href: "/hub/subs" },
  ];

  return (
    <>
      <PageHeader title="Job assignment" subtitle={`${open.length} open jobs`} />
      <Flash searchParams={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 hover:border-brand-500">
            <div className="text-2xl font-bold tabular-nums text-slate-900">{s.value}</div>
            <div className="text-sm text-slate-500">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/hub?status=${f.key}` : "/hub"}
            className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${(sp.status ?? "") === f.key ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Phone: cards */}
      <div className="space-y-3 md:hidden">
        {jobs.map((j) => (
          <Link key={j.id} href={`/hub/jobs/${j.id}`} className="card block p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">{j.job_number} · {j.city}</div>
                <div className="font-semibold">{j.title}</div>
              </div>
              <JobStatusBadge status={j.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>Start: {formatDate(j.scheduled_start ?? j.proposed_start)}</span>
              <span>Crew: {j.assigned_sub_name ?? "—"}</span>
              {j.pending_counter_count > 0 && <Badge tone="amber">Counteroffer</Badge>}
              {["draft", "ready", "offering"].includes(j.status) && !j.readiness.ready && <Badge tone="red">Not ready</Badge>}
            </div>
          </Link>
        ))}
        {!jobs.length && <Empty>No jobs here.</Empty>}
      </div>

      {/* Desktop: table */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-slate-100">
            <tr>
              <th className="th">Job</th>
              <th className="th">Services</th>
              <th className="th">Start</th>
              <th className="th">Status</th>
              <th className="th">Crew</th>
              <th className="th text-right">Payout</th>
              {actor.role === "owner" && <th className="th text-right">Margin</th>}
              <th className="th">Readiness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <tr key={j.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link href={`/hub/jobs/${j.id}`} className="font-medium text-brand-700 hover:underline">{j.title}</Link>
                  <div className="text-xs text-slate-500">{j.job_number} · {j.customer_name} · {j.city}</div>
                </td>
                <td className="td text-slate-600">{j.services.map(serviceLabel).join(", ")}</td>
                <td className="td whitespace-nowrap">
                  {formatDate(j.scheduled_start ?? j.proposed_start)}
                  {!j.scheduled_start && j.proposed_start && <div className="text-xs text-slate-400">proposed</div>}
                </td>
                <td className="td">
                  <JobStatusBadge status={j.status} />
                  {j.open_offer_count > 0 && <div className="mt-1 text-xs text-slate-500">{j.open_offer_count} open offer(s)</div>}
                  {j.pending_counter_count > 0 && <div className="mt-1"><Badge tone="amber">Counteroffer</Badge></div>}
                </td>
                <td className="td">{j.assigned_sub_name ?? <span className="text-slate-400">—</span>}</td>
                <td className="td text-right">
                  <Money cents={j.assigned_payout_cents ?? j.target_payout_cents} />
                  {!j.assigned_payout_cents && j.target_payout_cents != null && <div className="text-xs text-slate-400">target</div>}
                </td>
                {actor.role === "owner" && (
                  <td className="td text-right">
                    {j.margin_pct != null ? <span className={j.margin_pct < 40 ? "text-red-600" : ""}>{j.margin_pct}%</span> : "—"}
                  </td>
                )}
                <td className="td">
                  {!["draft", "ready", "offering"].includes(j.status) ? (
                    <span className="text-slate-400">—</span>
                  ) : j.readiness.ready ? (
                    <Badge tone="green">Ready</Badge>
                  ) : (
                    <Badge tone="red">{j.readiness.checks.filter((c) => c.blocking && !c.ok).length} missing</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <Empty>No jobs here.</Empty>}
      </Card>
    </>
  );
}
