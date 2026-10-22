import Link from "next/link";
import { Badge, Card, Empty, Flash, Money, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/domain";
import { can } from "@/lib/permissions";
import { pendingApprovals } from "@/lib/services/offers";
import { recommendAction, reviewAction } from "./actions";

export const metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  const items = await pendingApprovals(actor);
  const isOwner = can(actor.role, "counteroffers.approve");
  return (
    <>
      <PageHeader title="Counteroffers" subtitle={isOwner ? "You approve or reject. Approving changes the payout." : "Add a recommendation — the owner decides."} />
      <Flash searchParams={await searchParams} />
      {!items.length && <Card><Empty>Nothing waiting. 🎉</Empty></Card>}
      <div className="space-y-4">
        {items.map((r) => {
          const diff = (r.amount_cents ?? 0) - r.payout_cents;
          const overTarget = r.target_payout_cents != null && (r.amount_cents ?? 0) > r.target_payout_cents;
          const marginAtCounter = r.contract_amount_cents != null && r.amount_cents != null ? r.contract_amount_cents - r.amount_cents : null;
          return (
            <Card key={r.id} title={<Link href={`/hub/jobs/${r.job_id}`} className="hover:underline">{r.job_number} · {r.title}</Link>} actions={<span className="text-xs text-slate-500">{formatDate(r.created_at)}</span>}>
              <div className="mb-3 font-medium">{r.company_name}</div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-slate-500">Our offer</div><Money cents={r.payout_cents} className="font-semibold" /></div>
                <div><div className="text-xs text-slate-500">They want</div><Money cents={r.amount_cents} className="font-semibold text-amber-800" /></div>
                <div><div className="text-xs text-slate-500">Difference</div><span className="font-semibold">+{formatMoney(diff)}</span></div>
                <div>
                  <div className="text-xs text-slate-500">Target payout</div>
                  <Money cents={r.target_payout_cents} /> {overTarget && <Badge tone="red">over target</Badge>}
                </div>
                {marginAtCounter != null && (
                  <div className="col-span-2">
                    <div className="text-xs text-slate-500">Margin if approved</div>
                    <span className="font-semibold">{formatMoney(marginAtCounter)} ({Math.round((marginAtCounter / r.contract_amount_cents!) * 100)}%)</span>
                  </div>
                )}
              </div>
              {r.note && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">“{r.note}”</p>}
              {r.coordinator_note && <p className="mt-2 text-sm"><span className="font-medium">Coordinator:</span> {r.coordinator_note}</p>}

              {isOwner ? (
                <form action={reviewAction} className="mt-4 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="responseId" value={r.id} />
                  <input name="note" className="input flex-1 min-w-48" placeholder="Note (optional, shown to the sub if rejected)" />
                  <button name="decision" value="approve" className="btn-success">Approve {formatMoney(r.amount_cents)}</button>
                  <button name="decision" value="reject" className="btn-secondary">Reject</button>
                </form>
              ) : (
                <form action={recommendAction} className="mt-4 flex flex-wrap gap-2">
                  <input type="hidden" name="responseId" value={r.id} />
                  <input name="note" required defaultValue={r.coordinator_note ?? ""} className="input flex-1 min-w-48" placeholder="Your recommendation for the owner" />
                  <button className="btn-secondary">Send recommendation</button>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
