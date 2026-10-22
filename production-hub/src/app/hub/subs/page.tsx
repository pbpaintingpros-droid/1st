import Link from "next/link";
import { Badge, Card, Flash, PageHeader, SubStatusBadge } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { serviceLabel } from "@/lib/domain";
import { can } from "@/lib/permissions";
import { listSubs } from "@/lib/services/subs";

export const metadata = { title: "Subcontractors" };

export default async function SubsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  const subs = await listSubs(actor);
  return (
    <>
      <PageHeader
        title="Subcontractors"
        subtitle={`${subs.filter((s) => s.status === "active").length} active · ${subs.filter((s) => ["prospect", "onboarding"].includes(s.status)).length} in pipeline`}
        actions={can(actor.role, "subs.edit") && <Link href="/hub/subs/new" className="btn-primary">Add subcontractor</Link>}
      />
      <Flash searchParams={await searchParams} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {subs.map((s) => {
          const problems = s.compliance.checks.filter((c) => !c.ok);
          const expiring = s.compliance.checks.filter((c) => c.ok && c.detail?.startsWith("Expires"));
          return (
            <Link key={s.id} href={`/hub/subs/${s.id}`} className="card block p-4 hover:border-brand-500">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{s.company_name}</div>
                  <div className="text-sm text-slate-500">{s.contact_name}</div>
                </div>
                <SubStatusBadge status={s.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.skills.slice(0, 5).map((k) => <Badge key={k}>{serviceLabel(k)}</Badge>)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {s.compliance.compliant ? <Badge tone="green">Insurance OK</Badge> : <Badge tone="red">{problems.length} compliance issue(s)</Badge>}
                {expiring.map((c) => <Badge key={c.key} tone="amber">{c.label}: {c.detail}</Badge>)}
                <span className="text-slate-500">{s.active_job_count}/{s.max_active_jobs} jobs</span>
                {s.quality_rating && <span className="text-slate-500">★ {s.quality_rating}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
