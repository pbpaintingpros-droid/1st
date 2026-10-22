import Link from "next/link";
import { CrewStatusBadge } from "@/components/crew-status";
import { Empty, Money } from "@/components/ui";
import { requireSubPage } from "@/lib/auth/session";
import { formatDate, serviceLabel } from "@/lib/domain";
import { listMyOffers } from "@/lib/services/crew";

export const metadata = { title: "My offers" };

export default async function CrewHome() {
  const actor = await requireSubPage();
  const offers = await listMyOffers(actor);
  const active = offers.filter((o) => ["new", "accepted", "counter_pending", "walkthrough_requested", "awarded"].includes(o.status));
  const past = offers.filter((o) => !active.includes(o));
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Hi {actor.name.split(" ")[0]}</h1>
      <p className="mb-5 text-sm text-slate-500">Jobs PB Painting has offered to you.</p>
      <ul className="space-y-3">
        {active.map((o) => (
          <li key={o.id}>
            <Link href={`/crew/offers/${o.id}`} className="card block p-4 active:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{o.title}</div>
                  <div className="text-sm text-slate-500">{o.city} · {o.services.map(serviceLabel).join(", ")}</div>
                </div>
                <Money cents={o.payoutCents} className="text-lg font-bold text-slate-900" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <CrewStatusBadge status={o.status} />
                <span className="text-slate-500">Start {formatDate(o.proposedStart)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {!active.length && <div className="card"><Empty>No open offers right now.</Empty></div>}
      {past.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-semibold text-slate-500">Past</h2>
          <ul className="space-y-2">
            {past.map((o) => (
              <li key={o.id}>
                <Link href={`/crew/offers/${o.id}`} className="card flex items-center justify-between gap-2 p-3 text-sm">
                  <span>{o.title} · {o.city}</span>
                  <CrewStatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
