import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CheckList, Empty, Flash, JobStatusBadge, Money, OfferStatusBadge, PageHeader } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney, SERVICES, serviceLabel } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { listAudit } from "@/lib/services/activity";
import { getJob, listJobPhotos } from "@/lib/services/jobs";
import { listOffersForJob, suggestSubs } from "@/lib/services/offers";
import { ActivityList } from "@/components/activity-list";
import {
  acceptStartAction,
  awardOfferAction,
  createOfferAction,
  scheduleAction,
  sendOfferAction,
  statusAction,
  updateDraftOfferAction,
  updateJobAction,
  withdrawOfferAction,
} from "./actions";

const RESPONSE_LABEL: Record<string, string> = {
  accept: "Accepted",
  decline: "Declined",
  walkthrough_request: "Requested a walkthrough",
  start_date: "Suggested a start date",
  counteroffer: "Counteroffer",
};

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireStaffPage();
  const { id } = await params;
  const sp = await searchParams;
  const job = await getJob(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [offers, photos, activity, suggestions] = await Promise.all([
    listOffersForJob(actor, id),
    listJobPhotos(actor, id),
    listAudit(actor, { jobId: id, limit: 50 }),
    can(actor.role, "offers.create") ? suggestSubs(actor, id) : Promise.resolve([]),
  ]);
  const offered = new Set(offers.map((o) => o.subcontractor_id));
  const canFin = job.can_view_financials;
  const isOwner = can(actor.role, "settings.edit");
  const openForOffers = ["draft", "ready", "offering"].includes(job.status);
  const hidden = <input type="hidden" name="jobId" value={job.id} />;

  return (
    <>
      <PageHeader
        back={{ href: "/hub", label: "Jobs" }}
        title={job.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{job.job_number}</span>·<span>{job.customer_name}</span>·<span>{job.address}, {job.city}</span>
            <JobStatusBadge status={job.status} />
            {job.source === "sample" && <Badge tone="amber">sample</Badge>}
          </span>
        }
      />
      <Flash searchParams={sp} />

      <div className="grid gap-5 lg:grid-cols-5">
        {/* LEFT: offers & assignment */}
        <div className="space-y-5 lg:col-span-3">
          {job.assigned_sub_id && (
            <Card title="Assignment">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-500">Crew</div>
                  <Link href={`/hub/subs/${job.assigned_sub_id}`} className="font-semibold text-brand-700 hover:underline">{job.assigned_sub_name}</Link>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Agreed payout</div>
                  <Money cents={job.assigned_payout_cents} className="font-semibold" />
                </div>
                {canFin && (
                  <div>
                    <div className="text-xs text-slate-500">Margin</div>
                    <span className="font-semibold">{formatMoney(job.margin_cents)} ({job.margin_pct ?? "—"}%)</span>
                  </div>
                )}
              </div>
              {can(actor.role, "schedule.edit") && (
                <form action={scheduleAction} className="mt-4 flex flex-wrap items-end gap-3">
                  {hidden}
                  <div>
                    <label className="label" htmlFor="sch-start">Scheduled start</label>
                    <input id="sch-start" type="date" name="start" defaultValue={job.scheduled_start ?? ""} className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="sch-end">Scheduled end</label>
                    <input id="sch-end" type="date" name="end" defaultValue={job.scheduled_end ?? ""} className="input" />
                  </div>
                  <button className="btn-secondary">Save schedule</button>
                </form>
              )}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {job.status === "assigned" && (
                  <form action={statusAction}>{hidden}<input type="hidden" name="status" value="in_progress" /><button className="btn-secondary">Mark in progress</button></form>
                )}
                {["assigned", "in_progress"].includes(job.status) && (
                  <form action={statusAction}>{hidden}<input type="hidden" name="status" value="complete" /><button className="btn-secondary">Mark complete</button></form>
                )}
              </div>
            </Card>
          )}

          <Card title={`Private offers (${offers.length})`} actions={<span className="text-xs text-slate-500">Each sub sees only their own offer</span>}>
            {!offers.length && <Empty>No offers yet.</Empty>}
            <ul className="divide-y divide-slate-100">
              {offers.map((o) => {
                const pendingCounter = o.responses.find((r) => r.review_status === "pending");
                return (
                  <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link href={`/hub/subs/${o.subcontractor_id}`} className="font-semibold text-brand-700 hover:underline">{o.company_name}</Link>
                        <div className="text-sm text-slate-600">
                          <Money cents={o.payout_cents} className="font-medium text-slate-900" />
                          {job.target_payout_cents != null && o.payout_cents > job.target_payout_cents && <Badge tone="amber">above target</Badge>}
                          {" · "}start {formatDate(o.proposed_start)}
                          {o.sent_at && <> · sent {formatDate(o.sent_at)}</>}
                          {o.first_viewed_at && <> · viewed</>}
                        </div>
                      </div>
                      <OfferStatusBadge status={o.status} />
                    </div>

                    {o.responses.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
                        {o.responses.map((r) => (
                          <li key={r.id} className="text-sm">
                            <span className="font-medium">{RESPONSE_LABEL[r.kind]}</span>
                            {r.amount_cents != null && <> — <Money cents={r.amount_cents} className="font-semibold" /></>}
                            {r.suggested_start && <> — {formatDate(r.suggested_start)}</>}
                            <span className="text-xs text-slate-500"> · {formatDate(r.created_at)}</span>
                            {r.review_status === "pending" && <> <Badge tone="amber">waiting on owner</Badge></>}
                            {r.review_status === "approved" && <> <Badge tone="green">approved</Badge></>}
                            {r.review_status === "rejected" && <> <Badge tone="gray">not approved</Badge></>}
                            {r.note && <div className="text-slate-600">“{r.note}”</div>}
                            {r.kind === "start_date" && r.review_status === "none" && !["awarded", "withdrawn", "not_selected", "declined"].includes(o.status) && can(actor.role, "schedule.edit") && (
                              <form action={acceptStartAction} className="mt-1">
                                {hidden}<input type="hidden" name="responseId" value={r.id} />
                                <button className="text-xs font-semibold text-brand-600 hover:underline">Use this start date</button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {o.status === "draft" && (
                        <>
                          <form action={updateDraftOfferAction} className="flex flex-wrap items-end gap-2">
                            {hidden}<input type="hidden" name="offerId" value={o.id} />
                            <input name="payout" defaultValue={(o.payout_cents / 100).toFixed(0)} className="input w-28" aria-label="Payout" inputMode="decimal" />
                            <input type="date" name="proposed_start" defaultValue={o.proposed_start ?? ""} className="input w-40" aria-label="Proposed start" />
                            <input type="date" name="proposed_end" defaultValue={o.proposed_end ?? ""} className="input w-40" aria-label="Proposed end" />
                            <button className="btn-secondary">Update draft</button>
                          </form>
                          {can(actor.role, "offers.send") && (
                            <form action={sendOfferAction}>
                              {hidden}<input type="hidden" name="offerId" value={o.id} />
                              <button className="btn-primary">Send to sub</button>
                            </form>
                          )}
                        </>
                      )}
                      {o.status === "accepted" && !job.assigned_sub_id && can(actor.role, "offers.award") && (
                        <form action={awardOfferAction} className="flex flex-wrap items-end gap-2">
                          {hidden}<input type="hidden" name="offerId" value={o.id} />
                          <div>
                            <label className="label text-xs">Start</label>
                            <input type="date" name="start" defaultValue={o.proposed_start ?? ""} className="input w-40" />
                          </div>
                          <div>
                            <label className="label text-xs">End</label>
                            <input type="date" name="end" defaultValue={o.proposed_end ?? ""} className="input w-40" />
                          </div>
                          <button className="btn-success">Award job at {formatMoney(o.payout_cents)}</button>
                        </form>
                      )}
                      {pendingCounter && (
                        <Link href="/hub/approvals" className="btn-secondary">Review counteroffer →</Link>
                      )}
                      {["draft", "sent", "countered", "walkthrough_requested", "accepted"].includes(o.status) && can(actor.role, "offers.withdraw") && (
                        <form action={withdrawOfferAction}>
                          {hidden}<input type="hidden" name="offerId" value={o.id} />
                          <button className="text-sm text-red-600 hover:underline">Withdraw</button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {openForOffers && can(actor.role, "offers.create") && (
            <Card title="Offer this job to a sub">
              {!job.readiness.ready ? (
                <p className="text-sm text-red-700">Finish the readiness checklist before sending offers.</p>
              ) : (
                <form action={createOfferAction} className="space-y-4">
                  {hidden}
                  <fieldset>
                    <legend className="label">Matching subs (best first)</legend>
                    <ul className="space-y-2">
                      {suggestions
                        .filter((m) => !offered.has(m.subcontractorId))
                        .map((m) => (
                          <li key={m.subcontractorId}>
                            <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${m.eligible ? "border-slate-200 hover:border-brand-500" : "border-dashed border-slate-200 bg-slate-50"} ${!m.complianceOk ? "cursor-not-allowed opacity-60" : ""}`}>
                              <input type="radio" name="subcontractorId" value={m.subcontractorId} required disabled={!m.complianceOk || (!m.eligible && !isOwner)} className="mt-1" />
                              <span className="flex-1">
                                <span className="flex flex-wrap items-center gap-2 font-medium">
                                  {m.companyName}
                                  {m.eligible ? <Badge tone="green">Match · {m.score}</Badge> : m.complianceOk ? <Badge tone="amber">Outside rules</Badge> : <Badge tone="red">Not compliant</Badge>}
                                </span>
                                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                  {m.reasons.map((r, i) => (
                                    <span key={i} className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? "✓" : "✕"} {r.text}</span>
                                  ))}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                    </ul>
                  </fieldset>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label" htmlFor="payout">Payout to sub ($)</label>
                      <input id="payout" name="payout" required inputMode="decimal" className="input" defaultValue={job.target_payout_cents != null ? (job.target_payout_cents / 100).toFixed(0) : ""} />
                      <p className="mt-1 text-xs text-slate-500">Target: {formatMoney(job.target_payout_cents)}</p>
                    </div>
                    <div>
                      <label className="label" htmlFor="ps">Proposed start</label>
                      <input id="ps" type="date" name="proposed_start" defaultValue={job.proposed_start ?? ""} className="input" />
                    </div>
                    <div>
                      <label className="label" htmlFor="pe">Proposed end</label>
                      <input id="pe" type="date" name="proposed_end" defaultValue={job.proposed_end ?? ""} className="input" />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="note">Note to sub (they will see this)</label>
                    <textarea id="note" name="note_to_sub" rows={2} className="input" placeholder="e.g. Customer is home after 3pm" />
                  </div>
                  {isOwner && (
                    <div>
                      <label className="label" htmlFor="ovr">Override reason (owner only — needed for subs “outside rules”)</label>
                      <input id="ovr" name="override_reason" className="input" placeholder="Why this sub anyway?" />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-4">
                    {can(actor.role, "offers.send") && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="send_now" /> Send immediately (sub sees it in their portal)
                      </label>
                    )}
                    <button className="btn-primary">Create offer</button>
                  </div>
                  {!isOwner && <p className="text-xs text-slate-500">Offers above the target payout need the owner to send.</p>}
                </form>
              )}
            </Card>
          )}

          <Card title="Activity on this job">
            <ActivityList rows={activity} />
          </Card>
        </div>

        {/* RIGHT: readiness & details */}
        <div className="space-y-5 lg:col-span-2">
          <Card title="Ready to offer?" actions={job.readiness.ready ? <Badge tone="green">Ready</Badge> : <Badge tone="red">Not ready</Badge>}>
            <CheckList checks={job.readiness.checks} />
          </Card>

          {canFin && (
            <Card title="Financials (owner only)">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Contract</dt><dd className="text-right"><Money cents={job.contract_amount_cents} /></dd>
                <dt className="text-slate-500">Target payout</dt><dd className="text-right"><Money cents={job.target_payout_cents} /></dd>
                <dt className="text-slate-500">Margin</dt><dd className="text-right">{formatMoney(job.margin_cents)} {job.margin_pct != null && `(${job.margin_pct}%)`}</dd>
              </dl>
            </Card>
          )}

          <Card title="Job details">
            <form action={updateJobAction} className="space-y-3">
              {hidden}
              <div>
                <label className="label" htmlFor="title">Title</label>
                <input id="title" name="title" defaultValue={job.title} className="input" />
              </div>
              <fieldset>
                <legend className="label">Services</legend>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {SERVICES.map((s) => (
                    <label key={s.key} className="flex items-center gap-2">
                      <input type="checkbox" name="services" value={s.key} defaultChecked={job.services.includes(s.key)} /> {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label className="label" htmlFor="wo">Work order (crew sees this)</label>
                <textarea id="wo" name="work_order" rows={7} defaultValue={job.work_order ?? ""} className="input font-mono text-xs" />
              </div>
              <div>
                <label className="label" htmlFor="in">Internal notes (never shown to crews)</label>
                <textarea id="in" name="internal_notes" rows={2} defaultValue={job.internal_notes ?? ""} className="input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="jps">Proposed start</label>
                  <input id="jps" type="date" name="proposed_start" defaultValue={job.proposed_start ?? ""} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="jpe">Proposed end</label>
                  <input id="jpe" type="date" name="proposed_end" defaultValue={job.proposed_end ?? ""} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="days">Est. days</label>
                  <input id="days" name="estimated_days" inputMode="decimal" defaultValue={job.estimated_days ?? ""} className="input" />
                </div>
              </div>
              {canFin && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="ca">Contract ($)</label>
                    <input id="ca" name="contract_amount" inputMode="decimal" defaultValue={job.contract_amount_cents != null ? job.contract_amount_cents / 100 : ""} className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="tp">Target payout ($)</label>
                    <input id="tp" name="target_payout" inputMode="decimal" defaultValue={job.target_payout_cents != null ? job.target_payout_cents / 100 : ""} className="input" />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="deposit_received" defaultChecked={job.deposit_received} /> Deposit received</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="colors_confirmed" defaultChecked={job.colors_confirmed} /> Colors / products confirmed</label>
              <button className="btn-primary w-full sm:w-auto">Save job</button>
              <p className="text-xs text-slate-500">Saves to the Production Hub only — DripJobs is not changed.</p>
            </form>
          </Card>

          <Card title={`Photos (${photos.length})`}>
            {!photos.length && <Empty>No photos. CompanyCam sync isn’t connected yet.</Empty>}
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <figure key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/photo/${p.id}`} alt={p.caption ?? "Job photo"} className="aspect-square w-full rounded-md object-cover" />
                  <figcaption className="mt-0.5 truncate text-xs text-slate-500">
                    {p.share_with_crew ? "Crew can see" : <span className="text-red-600">Internal only</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Card>

          <Card title="Job status">
            <div className="flex flex-wrap items-center gap-2"><JobStatusBadge status={job.status} />{job.services.map((s) => <Badge key={s}>{serviceLabel(s)}</Badge>)}</div>
            {can(actor.role, "jobs.edit") && !["complete", "cancelled"].includes(job.status) && (
              <form action={statusAction} className="mt-4">
                {hidden}<input type="hidden" name="status" value="cancelled" />
                <button className="text-sm text-red-600 hover:underline">Cancel job (withdraws all offers)</button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
