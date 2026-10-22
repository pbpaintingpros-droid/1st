import { beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { commitJobs, commitSubs, parseCsv, previewJobs } from "@/lib/import/csv";
import { listAudit, listOutbox } from "@/lib/services/activity";
import { getMyOffer, respondToOffer } from "@/lib/services/crew";
import { getJob, updateJob } from "@/lib/services/jobs";
import { awardOffer, createOffer, pendingApprovals, reviewCounter, sendOffer, suggestSubs } from "@/lib/services/offers";
import { subCompliance } from "@/lib/services/rules";
import { saveMatchingRules } from "@/lib/services/settings";
import { freshDb, offerId, type Seeded } from "./helpers";

let s: Seeded;
beforeAll(async () => {
  s = await freshDb();
});

describe("job readiness gates offers", () => {
  it("blocks offers on a job missing a work order, start date and deposit", async () => {
    const job = await getJob(s.owner, s.jobs.j4);
    expect(job.readiness.ready).toBe(false);
    await expect(createOffer(s.owner, { jobId: s.jobs.j4, subcontractorId: s.subs.coastline, payoutCents: 200000 })).rejects.toThrow(
      /work order.*start date.*deposit/i,
    );
  });

  it("becomes ready once the blocking checks pass", async () => {
    await updateJob(s.owner, s.jobs.j4, {
      work_order: "Patch & texture 3 drywall repairs, then repaint walls in 2 bedrooms. Emerald Matte.",
      proposed_start: "2030-02-01",
      proposed_end: "2030-02-02",
      deposit_received: true,
    });
    const job = await getJob(s.owner, s.jobs.j4);
    expect(job.readiness.ready).toBe(true);
    expect(job.status).toBe("ready");
  });
});

describe("insurance & compliance", () => {
  it("never allows an offer to a sub with expired insurance, even with an owner override", async () => {
    // Summit's GL expired 10 days ago
    await expect(
      createOffer(s.owner, { jobId: s.jobs.j4, subcontractorId: s.subs.summit, payoutCents: 200000, overrideReason: "please" }),
    ).rejects.toThrow(/isn't compliant/);
  });

  it("flags insurance that expires soon without blocking", () => {
    const r = subCompliance(
      { status: "active", documents: [
        { doc_type: "general_liability", expires_on: "2030-01-10", verified_at: "x" },
        { doc_type: "workers_comp_exemption", expires_on: null, verified_at: "x" },
        { doc_type: "w9", expires_on: null, verified_at: "x" },
        { doc_type: "sub_agreement", expires_on: null, verified_at: "x" },
      ] },
      { expiryWarningDays: 30, today: "2030-01-01" },
    );
    expect(r.compliant).toBe(true);
    expect(r.checks.find((c) => c.key === "gl")?.detail).toMatch(/Expires in 9 days/);
  });

  it("unverified documents don't count", () => {
    const r = subCompliance(
      { status: "active", documents: [{ doc_type: "general_liability", expires_on: "2099-01-01", verified_at: null }] },
      { expiryWarningDays: 30 },
    );
    expect(r.checks.find((c) => c.key === "gl")?.ok).toBe(false);
  });
});

describe("matching rules are configurable", () => {
  it("ranks eligible subs first with reasons", async () => {
    const ranked = await suggestSubs(s.owner, s.jobs.j4); // El Cajon, interior + drywall
    expect(ranked[0].companyName).toMatch(/Coastline/);
    expect(ranked[0].eligible).toBe(true);
    const summit = ranked.find((r) => r.companyName.startsWith("Summit"))!;
    expect(summit.eligible).toBe(false);
    expect(summit.reasons.some((r) => /Expired/.test(r.text))).toBe(true);
  });

  it("turning off the service-area rule makes out-of-area subs eligible", async () => {
    const before = (await suggestSubs(s.owner, s.jobs.j4)).find((r) => r.companyName.startsWith("Harbor"))!;
    expect(before.eligible).toBe(false); // El Cajon not in Harbor's area; also no drywall
    await saveMatchingRules(s.owner, { requireServiceArea: false, requireAllSkills: false, respectCapacity: true, minQualityRating: 3, insuranceExpiryWarningDays: 30 });
    const after = (await suggestSubs(s.owner, s.jobs.j4)).find((r) => r.companyName.startsWith("Harbor"))!;
    expect(after.eligible).toBe(true);
    const log = await listAudit(s.owner, { entityId: "matching_rules" });
    expect(log[0].action).toBe("settings.matching_rules_changed");
  });
});

describe("audit trail for pricing and assignment", () => {
  it("logs every price change, counteroffer decision and assignment", async () => {
    await updateJob(s.owner, s.jobs.j4, { target_payout_cents: 220000 });
    const o = await createOffer(s.owner, { jobId: s.jobs.j4, subcontractorId: s.subs.coastline, payoutCents: 210000 });
    await sendOffer(s.owner, o.id);
    await respondToOffer(s.subA, o.id, { kind: "counteroffer", amountCents: 240000, note: "Texture match is tricky" });
    const pending = (await pendingApprovals(s.owner)).find((p) => p.offer_id === o.id)!;
    await reviewCounter(s.owner, pending.id, "approve", "OK — fair");
    await awardOffer(s.owner, o.id);

    const log = await listAudit(s.owner, { jobId: s.jobs.j4 });
    const actions = log.map((l) => l.action);
    for (const a of ["job.pricing_changed", "offer.created", "offer.sent", "offer.sub_counteroffer", "offer.payout_changed", "job.assigned"])
      expect(actions).toContain(a);
    const priceChange = log.find((l) => l.action === "offer.payout_changed")!;
    expect(priceChange.before).toMatchObject({ payout_cents: 210000 });
    expect(priceChange.after).toMatchObject({ payout_cents: 240000 });
    const assigned = log.find((l) => l.action === "job.assigned")!;
    expect(assigned.after).toMatchObject({ assigned_payout_cents: 240000, assigned_sub_id: s.subs.coastline });

    const job = await getJob(s.owner, s.jobs.j4);
    expect(job.assigned_payout_cents).toBe(240000);
    expect(job.status).toBe("assigned");
    expect((await getMyOffer(s.subA, o.id)).payoutCents).toBe(240000);
  });

  it("the audit log cannot be edited or deleted", async () => {
    await expect(s.db.query("update audit_log set action = 'x'")).rejects.toThrow(/append-only/);
    await expect(s.db.query("delete from audit_log")).rejects.toThrow(/append-only/);
  });

  it("rejecting a counter keeps the original price and re-opens the offer", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.mesa);
    const pending = (await pendingApprovals(s.owner)).find((p) => p.offer_id === o)!;
    await reviewCounter(s.owner, pending.id, "reject", "Too high");
    const view = await getMyOffer(s.subB, o);
    expect(view.status).toBe("new");
    expect(view.payoutCents).toBe(470000);
    expect(view.myResponses[0].outcome).toBe("not_approved");
  });
});

describe("nothing is sent outside the app", () => {
  it("text messages are queued for approval, never sent", async () => {
    const box = await listOutbox(s.owner);
    expect(box.length).toBeGreaterThan(0);
    for (const m of box) {
      expect(m.status).toBe("pending_approval");
      // texts contain a portal nudge only — no prices
      expect(JSON.stringify(m.payload)).not.toMatch(/\$|\d{4,}00/);
    }
  });
});

describe("CSV import", () => {
  const csv = `job_number,customer_name,address,city,services,title,work_order,contract_amount,target_payout,proposed_start,deposit_received
X-1,Test Person,1 Test St,San Diego,interior;doors,"Interior, doors","Paint 6 doors and 2 rooms, ""Emerald"" matte","$5,200.00",2600,11/15/2030,yes
S-1001,Dup,2 Test St,San Diego,interior,Dup,,,,,
X-2,Bad Row,3 Test St,San Diego,flooring,Bad,,abc,,2030-13-01,`;

  it("parses quoted fields", () => {
    const rows = parseCsv(csv);
    expect(rows[0].title).toBe("Interior, doors");
    expect(rows[0].work_order).toBe('Paint 6 doors and 2 rooms, "Emerald" matte');
  });

  it("previews without writing, flags errors and duplicates", async () => {
    const before = (await s.db.query<{ n: number }>("select count(*)::int n from jobs")).rows[0].n;
    const p = await previewJobs(s.owner, csv);
    expect(p[0].errors).toEqual([]);
    expect(p[0].data?.contract_amount_cents).toBe(520000);
    expect(p[0].data?.proposed_start).toBe("2030-11-15");
    expect(p[1].duplicate).toBe(true);
    expect(p[2].errors.join(" ")).toMatch(/flooring/);
    expect(p[2].errors.join(" ")).toMatch(/contract_amount/);
    expect((await s.db.query<{ n: number }>("select count(*)::int n from jobs")).rows[0].n).toBe(before);
    await expect(commitJobs(s.owner, csv, "t.csv")).rejects.toBeInstanceOf(ValidationError);
  });

  it("commits a clean file and skips duplicates", async () => {
    const clean = csv.split("\n").slice(0, 3).join("\n");
    expect(await commitJobs(s.owner, clean, "t.csv")).toEqual({ imported: 1, skipped: 1 });
  });

  it("coordinator imports drop pricing columns", async () => {
    const p = await previewJobs(s.coordinator, csv.replace("X-1", "X-9"));
    expect(p[0].data?.contract_amount_cents).toBeNull();
    expect(p[0].warnings.join(" ")).toMatch(/only the owner/);
  });

  it("imports subcontractors", async () => {
    const subs = `company_name,contact_name,phone,status,skills,service_areas
New Sub LLC (sample),Pat Q,555,prospect,interior;exterior,San Diego;Poway`;
    expect(await commitSubs(s.owner, subs, "subs.csv")).toEqual({ imported: 1, skipped: 0 });
  });
});
