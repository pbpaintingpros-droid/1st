import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/activity-list";
import { SubFields } from "@/components/sub-form";
import { Badge, Card, CheckList, Empty, Flash, Money, OfferStatusBadge, PageHeader, SubStatusBadge } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { DOC_TYPES, docLabel, formatDate } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { listAudit } from "@/lib/services/activity";
import { getSub } from "@/lib/services/subs";
import { addDocumentAction, createLoginAction, onboardingAction, updateSubAction, verifyDocumentAction } from "../actions";

export default async function SubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  const { id } = await params;
  const data = await getSub(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { sub, documents, compliance, onboarding, offers, logins } = data;
  const activity = await listAudit(actor, { entityId: id, limit: 30 });
  const hidden = <input type="hidden" name="subId" value={sub.id} />;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        back={{ href: "/hub/subs", label: "Subcontractors" }}
        title={sub.company_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {sub.contact_name}
            {sub.phone && <a href={`tel:${sub.phone}`} className="text-brand-600">{sub.phone}</a>}
            <SubStatusBadge status={sub.status} />
            {compliance.compliant ? <Badge tone="green">Can receive offers</Badge> : <Badge tone="red">Blocked from offers</Badge>}
          </span>
        }
      />
      <Flash searchParams={await searchParams} />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card title="Insurance & paperwork">
            <ul className="divide-y divide-slate-100">
              {documents.map((d) => {
                const expired = d.expires_on && d.expires_on < today;
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">{docLabel(d.doc_type)}</div>
                      <div className="text-xs text-slate-500">
                        {d.expires_on ? <span className={expired ? "font-semibold text-red-600" : ""}>Expires {formatDate(d.expires_on)}</span> : "No expiration"}
                        {d.file_id ? (
                          <> · <a href={`/api/files/doc/${d.id}`} className="text-brand-600 hover:underline" target="_blank">{d.file_name ?? "View file"}</a></>
                        ) : (
                          <> · no file</>
                        )}
                        {d.notes && <> · {d.notes}</>}
                      </div>
                    </div>
                    {d.verified_at ? (
                      <Badge tone="green">Verified by {d.verified_by_name ?? "staff"}</Badge>
                    ) : (
                      <form action={verifyDocumentAction}>
                        {hidden}<input type="hidden" name="documentId" value={d.id} />
                        <button className="btn-secondary text-xs">Mark verified</button>
                      </form>
                    )}
                  </li>
                );
              })}
              {!documents.length && <Empty>No documents yet.</Empty>}
            </ul>
            {can(actor.role, "subs.documents") && (
              <form action={addDocumentAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                {hidden}
                <div>
                  <label className="label" htmlFor="doc_type">Document</label>
                  <select id="doc_type" name="doc_type" className="input">
                    {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="expires_on">Expires</label>
                  <input id="expires_on" type="date" name="expires_on" className="input" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="file">File (PDF or photo, 10 MB max)</label>
                  <input id="file" type="file" name="file" accept="application/pdf,image/*" className="block w-full text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <button className="btn-primary">Upload document</button>
                </div>
              </form>
            )}
          </Card>

          <Card title="Profile">
            <form action={updateSubAction} className="space-y-4">
              {hidden}
              <SubFields sub={sub} />
              <button className="btn-primary">Save profile</button>
            </form>
          </Card>

          <Card title="Activity">
            <ActivityList rows={activity} />
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Offer eligibility">
            <CheckList checks={compliance.checks} />
          </Card>

          <Card title="Onboarding">
            <ul className="space-y-2">
              {onboarding.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={s.completed_at ? "text-slate-500 line-through" : ""}>{s.label}</span>
                  <form action={onboardingAction}>
                    {hidden}<input type="hidden" name="step" value={s.key} /><input type="hidden" name="done" value={s.completed_at ? "0" : "1"} />
                    <button className={`rounded-md px-2 py-1 text-xs font-semibold ${s.completed_at ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                      {s.completed_at ? "✓ Done" : "Mark done"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Crew Portal login">
            {logins.length ? (
              <ul className="text-sm">
                {logins.map((l) => <li key={l.id}>{l.email} {l.active ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No login yet.</p>
            )}
            {can(actor.role, "users.manage") && (
              <form action={createLoginAction} className="mt-3 space-y-2">
                {hidden}
                <input name="email" type="email" required placeholder="crew email" defaultValue={logins.length ? "" : sub.email ?? ""} className="input" />
                <input name="password" type="text" required minLength={10} placeholder="temporary password (10+ chars)" className="input" autoComplete="off" />
                <button className="btn-secondary w-full">Create login</button>
                <p className="text-xs text-slate-500">Nothing is emailed or texted — you share the login yourself.</p>
              </form>
            )}
          </Card>

          <Card title={`Offers (${offers.length})`}>
            {!offers.length && <Empty>No offers yet.</Empty>}
            <ul className="space-y-2">
              {offers.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/hub/jobs/${o.job_id}`} className="text-brand-700 hover:underline">{o.job_number} · {o.title}</Link>
                  <span className="flex items-center gap-2"><Money cents={o.payout_cents} /><OfferStatusBadge status={o.status} /></span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
