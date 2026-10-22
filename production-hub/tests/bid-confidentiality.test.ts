import { beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { canSubSeePhoto, getMyOffer, listMyOffers, respondToOffer } from "@/lib/services/crew";
import { awardOffer, createOffer, reviewCounter, sendOffer, pendingApprovals } from "@/lib/services/offers";
import { freshDb, offerId, type Seeded } from "./helpers";

let s: Seeded;
beforeAll(async () => {
  s = await freshDb();
});

/** Every key a crew view is allowed to contain. Adding a field means updating this list on purpose. */
const ALLOWED_DETAIL_KEYS = [
  "id", "status", "title", "city", "services", "payoutCents", "proposedStart", "proposedEnd", "sentAt",
  "jobNumber", "address", "workOrder", "estimatedDays", "noteFromPB", "expiresAt", "photos", "customerName",
  "scheduledStart", "scheduledEnd", "myResponses", "allowedActions",
].sort();

async function secretsFor(jobId: string) {
  const job = (await s.db.query<Record<string, unknown>>("select * from jobs where id = $1", [jobId])).rows[0];
  const offers = (
    await s.db.query<{ payout_cents: number; company_name: string; contact_name: string; subcontractor_id: string }>(
      "select o.payout_cents, s.company_name, s.contact_name, o.subcontractor_id from offers o join subcontractors s on s.id = o.subcontractor_id where o.job_id = $1",
      [jobId],
    )
  ).rows;
  return { job, offers };
}

describe("subs only see their own offers", () => {
  it("lists only offers addressed to the sub's company, never drafts", async () => {
    const mine = await listMyOffers(s.subA);
    const ids = (await s.db.query<{ id: string }>("select id from offers where subcontractor_id = $1 and status <> 'draft'", [s.subs.coastline])).rows.map((r) => r.id);
    expect(mine.map((o) => o.id).sort()).toEqual(ids.sort());

    // Harbor has only a DRAFT on S-1005 → sees nothing
    expect(await listMyOffers(s.subC)).toEqual([]);
  });

  it("returns Not Found (not Forbidden) for another sub's offer", async () => {
    const mesaOffer = await offerId(s.db, s.jobs.j1, s.subs.mesa);
    await expect(getMyOffer(s.subA, mesaOffer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(respondToOffer(s.subA, mesaOffer, { kind: "accept" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(respondToOffer(s.subA, mesaOffer, { kind: "counteroffer", amountCents: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns Not Found for a draft addressed to the sub", async () => {
    const draft = await offerId(s.db, s.jobs.j5, s.subs.harbor);
    await expect(getMyOffer(s.subC, draft)).rejects.toBeInstanceOf(NotFoundError);
    await expect(respondToOffer(s.subC, draft, { kind: "accept" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns Not Found for junk ids", async () => {
    await expect(getMyOffer(s.subA, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyOffer(s.subA, "' or 1=1 --")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("crew offer views never leak confidential data", () => {
  it("contains only whitelisted fields", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    const view = await getMyOffer(s.subA, o);
    expect(Object.keys(view).sort()).toEqual(ALLOWED_DETAIL_KEYS);
    for (const p of view.photos) expect(Object.keys(p).sort()).toEqual(["caption", "id"]);
    for (const summary of await listMyOffers(s.subA))
      expect(Object.keys(summary).sort()).toEqual(["city", "id", "payoutCents", "proposedEnd", "proposedStart", "sentAt", "services", "status", "title"]);
  });

  it("never includes contract amount, target payout, margin, internal notes, customer phone, or other subs", async () => {
    // S-1001 is offered to Coastline ($4,800) AND Mesa (countered $5,200)
    const { job, offers } = await secretsFor(s.jobs.j1);
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    const json = JSON.stringify([await getMyOffer(s.subA, o), await listMyOffers(s.subA)]);

    const contract = job.contract_amount_cents as number;
    const target = job.target_payout_cents as number;
    for (const needle of [
      String(contract), (contract / 100).toFixed(0), String(target), (target / 100).toFixed(0),
      String(contract - 480000), // margin vs. this sub's payout
      job.internal_notes as string, job.customer_phone as string, job.customer_name as string,
    ])
      expect(json).not.toContain(needle);

    for (const other of offers.filter((x) => x.subcontractor_id !== s.subs.coastline)) {
      expect(json).not.toContain(other.company_name);
      expect(json).not.toContain(other.contact_name);
      expect(json).not.toContain(String(other.payout_cents));
      expect(json).not.toContain(other.subcontractor_id);
    }
    // Mesa's counteroffer amount
    expect(json).not.toContain("520000");
    expect(json).not.toMatch(/Mesa Pro|Harbor Coatings|Summit Brush|Fresh Coat/); // ("La Mesa" is the job city)
  });

  it("has no competition or demand indicators", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    const json = JSON.stringify(await getMyOffer(s.subA, o)).toLowerCase();
    for (const word of ["bidder", "competitor", "other crew", "others", "interested", "viewers", "offer_count", "offercount", "rank", "lowest", "highest"])
      expect(json).not.toContain(word);
  });

  it("shows only the sub's own responses", async () => {
    const mesaOffer = await offerId(s.db, s.jobs.j1, s.subs.mesa);
    const mesaView = await getMyOffer(s.subB, mesaOffer);
    expect(mesaView.myResponses).toHaveLength(1);
    expect(mesaView.myResponses[0]).toMatchObject({ kind: "counteroffer", amountCents: 520000, outcome: "pending" });

    const coastView = await getMyOffer(s.subA, await offerId(s.db, s.jobs.j1, s.subs.coastline));
    expect(coastView.myResponses).toEqual([]);
  });

  it("hides customer identity until the job is awarded to that sub", async () => {
    const open = await getMyOffer(s.subA, await offerId(s.db, s.jobs.j1, s.subs.coastline));
    expect(open.customerName).toBeNull();
    const awarded = await getMyOffer(s.subA, await offerId(s.db, s.jobs.j2, s.subs.coastline));
    expect(awarded.status).toBe("awarded");
    expect(awarded.customerName).toBe("Chris N.");
  });
});

describe("after a job is awarded to someone else", () => {
  it("the other sub sees only 'closed' — no winner, no price, no address", async () => {
    // Owner approves Mesa's counter on S-1001, then awards to Mesa
    const pending = (await pendingApprovals(s.owner)).find((p) => p.job_id === s.jobs.j1)!;
    await reviewCounter(s.owner, pending.id, "approve");
    await awardOffer(s.owner, await offerId(s.db, s.jobs.j1, s.subs.mesa));

    const loser = await getMyOffer(s.subA, await offerId(s.db, s.jobs.j1, s.subs.coastline));
    expect(loser.status).toBe("closed");
    expect(loser.allowedActions).toEqual([]);
    expect(loser.address).toBeNull();
    expect(loser.workOrder).toBeNull();
    expect(loser.photos).toEqual([]);
    const json = JSON.stringify(loser);
    expect(json).not.toMatch(/Mesa Pro|Jordan|520000|"awarded"/i);

    const notif = await s.db.query<{ title: string; body: string }>(
      "select n.title, n.body from notifications n join users u on u.id = n.user_id where u.subcontractor_id = $1",
      [s.subs.coastline],
    );
    for (const n of notif.rows) expect(`${n.title} ${n.body}`).not.toMatch(/Mesa Pro|Jordan|5,200/);
  });

  it("the losing sub can no longer respond", async () => {
    const o = await offerId(s.db, s.jobs.j1, s.subs.coastline);
    await expect(respondToOffer(s.subA, o, { kind: "accept" })).rejects.toThrow(/isn't available/);
  });
});

describe("photo access", () => {
  it("subs can see crew-shared photos on jobs offered to them", async () => {
    const photo = (await s.db.query<{ id: string }>("select id from job_photos where job_id = $1 and share_with_crew limit 1", [s.jobs.j3])).rows[0];
    expect(await canSubSeePhoto(s.db, s.subs.coastline, photo.id)).toBe(true);
  });
  it("never internal-only photos, never jobs not offered to them, never closed offers", async () => {
    const internal = (await s.db.query<{ id: string }>("select id from job_photos where not share_with_crew limit 1")).rows[0];
    expect(await canSubSeePhoto(s.db, s.subs.mesa, internal.id)).toBe(false);

    const j3photo = (await s.db.query<{ id: string }>("select id from job_photos where job_id = $1 limit 1", [s.jobs.j3])).rows[0];
    expect(await canSubSeePhoto(s.db, s.subs.mesa, j3photo.id)).toBe(false);

    // Coastline's S-1001 offer is now closed
    const j1photo = (await s.db.query<{ id: string }>("select id from job_photos where job_id = $1 and share_with_crew limit 1", [s.jobs.j1])).rows[0];
    expect(await canSubSeePhoto(s.db, s.subs.coastline, j1photo.id)).toBe(false);
    // Harbor only has a draft on S-1005
    const j5photo = (await s.db.query<{ id: string }>("select id from job_photos where job_id = $1 limit 1", [s.jobs.j5])).rows[0];
    expect(await canSubSeePhoto(s.db, s.subs.harbor, j5photo.id)).toBe(false);
  });
});

describe("sending an offer makes it visible, and only to that sub", () => {
  it("draft → sent appears only in the recipient's portal", async () => {
    const draft = await offerId(s.db, s.jobs.j5, s.subs.harbor);
    await sendOffer(s.owner, draft);
    expect((await listMyOffers(s.subC)).map((o) => o.id)).toEqual([draft]);
    expect((await listMyOffers(s.subA)).map((o) => o.id)).not.toContain(draft);
    expect((await listMyOffers(s.subB)).map((o) => o.id)).not.toContain(draft);
  });
});
