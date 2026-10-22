import Link from "next/link";
import { notFound } from "next/navigation";
import { CrewStatusBadge } from "@/components/crew-status";
import { Badge, Flash, Money } from "@/components/ui";
import { requireSubPage } from "@/lib/auth/session";
import { formatDate, formatMoney, serviceLabel } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { getMyOffer } from "@/lib/services/crew";
import { respondAction } from "./actions";

export const metadata = { title: "Offer" };

const RESPONSE_LABEL = {
  accept: "You accepted",
  decline: "You declined",
  walkthrough_request: "You requested a walkthrough",
  start_date: "You suggested a start date",
  counteroffer: "You countered",
} as const;
const OUTCOME = { pending: ["Under review", "amber"], approved: ["Approved", "green"], not_approved: ["Not approved", "gray"] } as const;

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireSubPage();
  const { id } = await params;
  const o = await getMyOffer(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const can = (a: (typeof o.allowedActions)[number]) => o.allowedActions.includes(a);
  const hidden = <input type="hidden" name="offerId" value={o.id} />;

  return (
    <>
      <Link href="/crew" className="mb-2 inline-block text-sm text-brand-600">← My offers</Link>
      <Flash searchParams={await searchParams} />

      <div className="card p-4">
        <div className="text-xs text-slate-500">{o.jobNumber}</div>
        <h1 className="text-lg font-bold">{o.title}</h1>
        <div className="mt-1 flex flex-wrap gap-1">{o.services.map((s) => <Badge key={s}>{serviceLabel(s)}</Badge>)}</div>
        <div className="mt-3"><CrewStatusBadge status={o.status} /></div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
          <div className="col-span-2">
            <dt className="text-xs text-slate-500">Your payout</dt>
            <dd><Money cents={o.payoutCents} className="text-2xl font-bold text-slate-900" /></dd>
            <dd className="text-xs text-slate-500">Labor + materials, per the work order below</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{o.status === "awarded" ? "Scheduled start" : "Proposed start"}</dt>
            <dd className="font-medium">{formatDate(o.scheduledStart ?? o.proposedStart)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{o.status === "awarded" ? "Scheduled finish" : "Proposed finish"}</dt>
            <dd className="font-medium">{formatDate(o.scheduledEnd ?? o.proposedEnd)}</dd>
          </div>
          {o.estimatedDays != null && (
            <div>
              <dt className="text-xs text-slate-500">Estimated days</dt>
              <dd className="font-medium">{o.estimatedDays}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-slate-500">Location</dt>
            <dd className="font-medium">
              {o.address ? (
                <a className="text-brand-600 underline" href={`https://maps.google.com/?q=${encodeURIComponent(`${o.address}, ${o.city}, CA`)}`} target="_blank" rel="noreferrer">
                  {o.address}, {o.city}
                </a>
              ) : (
                o.city
              )}
            </dd>
          </div>
          {o.customerName && (
            <div>
              <dt className="text-xs text-slate-500">Customer</dt>
              <dd className="font-medium">{o.customerName}</dd>
            </div>
          )}
          {o.expiresAt && (
            <div>
              <dt className="text-xs text-slate-500">Respond by</dt>
              <dd className="font-medium">{formatDate(o.expiresAt)}</dd>
            </div>
          )}
        </dl>
        {o.noteFromPB && <p className="mt-4 rounded-lg bg-brand-50 p-3 text-sm"><span className="font-semibold">Note from PB:</span> {o.noteFromPB}</p>}
      </div>

      {o.workOrder && (
        <section className="card mt-4 p-4">
          <h2 className="mb-2 font-semibold">Work order</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">{o.workOrder}</pre>
        </section>
      )}

      {o.photos.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="mb-2 font-semibold">Photos</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {o.photos.map((p) => (
              <a key={p.id} href={`/api/files/photo/${p.id}`} target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/photo/${p.id}`} alt={p.caption ?? "Job photo"} className="aspect-[4/3] w-full rounded-md object-cover" />
                {p.caption && <div className="mt-0.5 truncate text-xs text-slate-500">{p.caption}</div>}
              </a>
            ))}
          </div>
        </section>
      )}

      {o.allowedActions.length > 0 && (
        <section className="mt-4 space-y-3">
          {can("accept") && (
            <form action={respondAction} className="card space-y-3 p-4">
              {hidden}<input type="hidden" name="kind" value="accept" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" required className="mt-1" />
                <span>I’ll complete this work order for <b>{formatMoney(o.payoutCents)}</b>, starting around {formatDate(o.proposedStart)}.</span>
              </label>
              <textarea name="note" rows={2} className="input" placeholder="Anything PB should know? (optional)" />
              <button className="btn-success w-full py-3 text-base">Accept offer</button>
            </form>
          )}

          <div className="grid gap-3">
            {can("counteroffer") && (
              <details className="card p-4">
                <summary className="cursor-pointer font-semibold">Suggest a different price</summary>
                <form action={respondAction} className="mt-3 space-y-3">
                  {hidden}<input type="hidden" name="kind" value="counteroffer" />
                  <div>
                    <label className="label" htmlFor="amount">Your price ($)</label>
                    <input id="amount" name="amount" required inputMode="decimal" className="input" placeholder="e.g. 5200" />
                  </div>
                  <textarea name="note" rows={2} className="input" placeholder="Why? (helps PB review it)" />
                  <button className="btn-primary w-full">Send counteroffer</button>
                </form>
              </details>
            )}
            {can("start_date") && (
              <details className="card p-4">
                <summary className="cursor-pointer font-semibold">Suggest a start date</summary>
                <form action={respondAction} className="mt-3 space-y-3">
                  {hidden}<input type="hidden" name="kind" value="start_date" />
                  <input type="date" name="suggested_start" required className="input" aria-label="Suggested start date" />
                  <textarea name="note" rows={2} className="input" placeholder="Note (optional)" />
                  <button className="btn-primary w-full">Send date</button>
                </form>
              </details>
            )}
            {can("walkthrough_request") && (
              <details className="card p-4">
                <summary className="cursor-pointer font-semibold">Request a walkthrough first</summary>
                <form action={respondAction} className="mt-3 space-y-3">
                  {hidden}<input type="hidden" name="kind" value="walkthrough_request" />
                  <textarea name="note" rows={2} className="input" placeholder="What do you want to check? Best days/times?" />
                  <button className="btn-primary w-full">Request walkthrough</button>
                </form>
              </details>
            )}
            {can("decline") && (
              <details className="card p-4">
                <summary className="cursor-pointer font-semibold text-red-700">Decline</summary>
                <form action={respondAction} className="mt-3 space-y-3">
                  {hidden}<input type="hidden" name="kind" value="decline" />
                  <textarea name="note" rows={2} className="input" placeholder="Reason (optional — helps us send better-fit jobs)" />
                  <button className="btn-danger w-full">Decline offer</button>
                </form>
              </details>
            )}
          </div>
        </section>
      )}

      {o.myResponses.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="mb-2 font-semibold">Your history on this offer</h2>
          <ul className="space-y-2 text-sm">
            {o.myResponses.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{RESPONSE_LABEL[r.kind]}</span>
                {r.amountCents != null && <> at <Money cents={r.amountCents} /></>}
                {r.suggestedStart && <> — {formatDate(r.suggestedStart)}</>}
                {r.outcome && <> <Badge tone={OUTCOME[r.outcome][1]}>{OUTCOME[r.outcome][0]}</Badge></>}
                <span className="text-xs text-slate-500"> · {formatDate(r.createdAt)}</span>
                {r.note && <div className="text-slate-600">“{r.note}”</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
