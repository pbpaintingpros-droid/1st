import { beforeAll, describe, expect, it } from "vitest";
import { actorFromToken, login } from "@/lib/auth/core";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { commitJobs, previewJobs } from "@/lib/import/csv";
import { can, PERMISSIONS } from "@/lib/permissions";
import { listAudit, listOutbox } from "@/lib/services/activity";
import { getMyOffer, listMyOffers, respondToOffer } from "@/lib/services/crew";
import { getJob, listJobs, updateJob, updateSchedule } from "@/lib/services/jobs";
import { awardOffer, createOffer, listOffersForJob, pendingApprovals, reviewCounter, sendOffer, suggestSubs, withdrawOffer } from "@/lib/services/offers";
import { saveMatchingRules } from "@/lib/services/settings";
import { addSubDocument, createSubLogin, getSub, listSubs, updateSub } from "@/lib/services/subs";
import { freshDb, offerId, type Seeded } from "./helpers";

let s: Seeded;
beforeAll(async () => {
  s = await freshDb();
});

describe("permission matrix", () => {
  it("subs have only the crew portal permission", () => {
    for (const p of PERMISSIONS) expect(can("sub", p)).toBe(p === "crew.portal");
  });
  it("owner has every internal permission but not the crew portal", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(p !== "crew.portal");
  });
  it("coordinator cannot see financials, approve counters, change settings, or manage users", () => {
    for (const p of ["jobs.view_financials", "counteroffers.approve", "settings.edit", "users.manage", "offers.send_above_target"] as const)
      expect(can("coordinator", p)).toBe(false);
  });
});

describe("signed-out requests are rejected", () => {
  it("every service throws AuthError with no actor", async () => {
    const calls = [
      () => listJobs(null),
      () => getJob(null, s.jobs.j1),
      () => listSubs(null),
      () => listMyOffers(null),
      () => listAudit(null),
      () => createOffer(null, { jobId: s.jobs.j1, subcontractorId: s.subs.harbor, payoutCents: 1 }),
      () => respondToOffer(null, "00000000-0000-0000-0000-000000000000", { kind: "accept" }),
    ];
    for (const c of calls) await expect(c()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("subcontractors cannot reach internal data or actions", () => {
  it("blocks every internal read", async () => {
    const reads = [
      () => listJobs(s.subA),
      () => getJob(s.subA, s.jobs.j1),
      () => listSubs(s.subA),
      () => getSub(s.subA, s.subs.coastline),
      () => listOffersForJob(s.subA, s.jobs.j1),
      () => suggestSubs(s.subA, s.jobs.j1),
      () => pendingApprovals(s.subA),
      () => listAudit(s.subA),
      () => listOutbox(s.subA),
      () => previewJobs(s.subA, "job_number\nX"),
    ];
    for (const r of reads) await expect(r()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks every internal write", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    const writes = [
      () => updateJob(s.subA, s.jobs.j1, { target_payout_cents: 999999 }),
      () => updateSchedule(s.subA, s.jobs.j2, "2030-01-01", "2030-01-02"),
      () => createOffer(s.subA, { jobId: s.jobs.j1, subcontractorId: s.subs.harbor, payoutCents: 100 }),
      () => sendOffer(s.subA, o),
      () => withdrawOffer(s.subA, o),
      () => awardOffer(s.subA, o),
      () => reviewCounter(s.subA, "00000000-0000-0000-0000-000000000000", "approve"),
      () => saveMatchingRules(s.subA, { requireAllSkills: false }),
      () => updateSub(s.subA, s.subs.coastline, { quality_rating: 5 }),
      () => addSubDocument(s.subA, s.subs.coastline, { doc_type: "w9", expires_on: null }),
      () => createSubLogin(s.subA, s.subs.coastline, "x@y.test", "long-enough-password"),
      () => commitJobs(s.subA, "job_number\nX", "x.csv"),
    ];
    for (const w of writes) await expect(w()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("staff cannot use the crew portal", () => {
  it("owner and coordinator get Forbidden from crew services", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    for (const a of [s.owner, s.coordinator]) {
      await expect(listMyOffers(a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getMyOffer(a, o)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(respondToOffer(a, o, { kind: "accept" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("coordinator limits", () => {
  it("does not see customer contract amounts or margins", async () => {
    const jobs = await listJobs(s.coordinator);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.contract_amount_cents).toBeNull();
      expect(j.margin_cents).toBeNull();
      expect(j.margin_pct).toBeNull();
    }
    const owners = await listJobs(s.owner);
    expect(owners.some((j) => j.contract_amount_cents != null)).toBe(true);
    for (const a of await pendingApprovals(s.coordinator)) expect(a.contract_amount_cents).toBeNull();
  });

  it("does not see contract amounts in the activity log", async () => {
    await updateJob(s.owner, s.jobs.j2, { contract_amount_cents: 654321 });
    const ownerLog = JSON.stringify(await listAudit(s.owner, { jobId: s.jobs.j2 }));
    expect(ownerLog).toContain("654321");
    const coordLog = JSON.stringify(await listAudit(s.coordinator));
    expect(coordLog).not.toContain("contract_amount_cents");
    expect(coordLog).not.toContain("654321");
  });

  it("cannot change contract amount or target payout", async () => {
    await expect(updateJob(s.coordinator, s.jobs.j1, { contract_amount_cents: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateJob(s.coordinator, s.jobs.j1, { target_payout_cents: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot approve a counteroffer", async () => {
    const [pending] = await pendingApprovals(s.coordinator);
    expect(pending).toBeDefined();
    await expect(reviewCounter(s.coordinator, pending.id, "approve")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot override matching rules to offer an unqualified sub", async () => {
    // j3 target is $3,600; Harbor is not yet on j3
    await s.db.query("update jobs set colors_confirmed = true where id = $1", [s.jobs.j3]);
    const offer = await createOffer(s.coordinator, { jobId: s.jobs.j3, subcontractorId: s.subs.harbor, payoutCents: 400000, overrideReason: null }).catch((e) => e);
    // Harbor doesn't do cabinets -> coordinator can't override matching rules either
    expect(offer).toBeInstanceOf(Error);
    expect(String(offer.message)).toMatch(/matching rules/);
    const forced = await createOffer(s.coordinator, { jobId: s.jobs.j3, subcontractorId: s.subs.harbor, payoutCents: 400000, overrideReason: "try" }).catch((e) => e);
    expect(forced).toBeInstanceOf(ForbiddenError);
  });

  it("can send at or below target, but the owner must send above it", async () => {
    const above = await createOffer(s.coordinator, { jobId: s.jobs.j1, subcontractorId: s.subs.harbor, payoutCents: 500000 }).catch((e) => e);
    // Harbor doesn't serve La Mesa → not eligible; use owner override to create the draft
    expect(above).toBeInstanceOf(Error);
    const draft = await createOffer(s.owner, { jobId: s.jobs.j1, subcontractorId: s.subs.harbor, payoutCents: 500000, overrideReason: "test" });
    await expect(sendOffer(s.coordinator, draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    await sendOffer(s.owner, draft.id);
  });

  it("cannot change matching rules or create logins", async () => {
    await expect(saveMatchingRules(s.coordinator, { minQualityRating: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSubLogin(s.coordinator, s.subs.newco, "new@x.test", "long-enough-password")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("authentication", () => {
  it("logs in with the right password and stores only a hash of the session token", async () => {
    const r = await login(s.db, "OWNER@sample.pbhub.test", "PB-sample-2026");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = await s.db.query<{ token_hash: string }>("select token_hash from sessions");
    expect(stored.rows.some((x) => x.token_hash === r.token)).toBe(false);
    expect((await actorFromToken(s.db, r.token))?.role).toBe("owner");
    expect(await actorFromToken(s.db, r.token + "x")).toBeNull();
  });

  it("rejects wrong passwords and locks after 5 failures", async () => {
    const email = "crew@harbor-sample.test";
    for (let i = 0; i < 4; i++) expect(await login(s.db, email, "wrong")).toEqual({ ok: false, reason: "invalid" });
    expect(await login(s.db, email, "wrong")).toEqual({ ok: false, reason: "locked" });
    expect(await login(s.db, email, "PB-sample-2026")).toEqual({ ok: false, reason: "locked" });
  });

  it("does not reveal whether an email exists", async () => {
    expect(await login(s.db, "nobody@nowhere.test", "x")).toEqual({ ok: false, reason: "invalid" });
  });

  it("inactive users lose access immediately", async () => {
    const r = await login(s.db, "coordinator@sample.pbhub.test", "PB-sample-2026");
    if (!r.ok) throw new Error("login failed");
    await s.db.query("update users set active = false where email = 'coordinator@sample.pbhub.test'");
    expect(await actorFromToken(s.db, r.token)).toBeNull();
    await s.db.query("update users set active = true where email = 'coordinator@sample.pbhub.test'");
  });
});
