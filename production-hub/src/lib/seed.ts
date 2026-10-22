/**
 * SAMPLE DATA ONLY. Fake people, fake addresses, fake prices.
 * Used for local demo and automated tests until real integrations are verified.
 */
import type { Actor } from "@/lib/auth/core";
import { hashPassword } from "@/lib/auth/password";
import type { Db } from "@/lib/db";
import { setDb } from "@/lib/db";
import { awardOffer, createOffer, sendOffer } from "@/lib/services/offers";
import { respondToOffer } from "@/lib/services/crew";
import { DEFAULT_MATCHING_RULES } from "@/lib/services/rules";

export const SAMPLE_PASSWORD = "PB-sample-2026";

export const SAMPLE_LOGINS = {
  owner: "owner@sample.pbhub.test",
  coordinator: "coordinator@sample.pbhub.test",
  subA: "crew@coastline-sample.test",
  subB: "crew@mesa-sample.test",
  subC: "crew@harbor-sample.test",
} as const;

const addDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function samplePhotoSvg(label: string, hue: number) {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="800" height="600" fill="hsl(${hue},25%,82%)"/>
<rect x="150" y="220" width="500" height="300" fill="hsl(${hue},20%,70%)"/>
<polygon points="120,230 400,90 680,230" fill="hsl(${hue},18%,55%)"/>
<rect x="360" y="380" width="80" height="140" fill="hsl(${hue},15%,40%)"/>
<text x="400" y="575" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#333">SAMPLE PHOTO — ${label}</text>
</svg>`,
  );
}

export async function seed(db: Db) {
  setDb(db);
  const hash = await hashPassword(SAMPLE_PASSWORD);

  await db.query(
    `insert into settings (key, value) values ('matching_rules', $1) on conflict (key) do nothing`,
    [JSON.stringify(DEFAULT_MATCHING_RULES)],
  );

  // --- Staff -------------------------------------------------------------
  const owner = (
    await db.query<{ id: string }>(
      "insert into users (email, name, role, password_hash) values ($1,'Cameron (sample owner)','owner',$2) returning id",
      [SAMPLE_LOGINS.owner, hash],
    )
  ).rows[0];
  await db.query("insert into users (email, name, role, password_hash) values ($1,'Santiago (sample coordinator)','coordinator',$2)", [
    SAMPLE_LOGINS.coordinator,
    hash,
  ]);
  const ownerActor: Actor = { userId: owner.id, role: "owner", name: "Cameron", email: SAMPLE_LOGINS.owner, subcontractorId: null };

  // --- Subcontractors ----------------------------------------------------
  const sub = async (s: {
    company: string;
    contact: string;
    phone: string;
    status: string;
    skills: string[];
    areas: string[];
    rating: number | null;
    max: number;
    crew: number;
  }) =>
    (
      await db.query<{ id: string }>(
        `insert into subcontractors (company_name, contact_name, phone, status, skills, service_areas, quality_rating, max_active_jobs, crew_size, source, internal_notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sample','Sample record')
         returning id`,
        [s.company, s.contact, s.phone, s.status, s.skills, s.areas, s.rating, s.max, s.crew],
      )
    ).rows[0].id;

  const coastline = await sub({ company: "Coastline Finishes (sample)", contact: "Alex Rivera", phone: "+16195550101", status: "active", skills: ["interior", "exterior", "cabinets", "drywall", "doors"], areas: ["san diego", "la mesa", "chula vista", "el cajon"], rating: 5, max: 3, crew: 4 });
  const mesa = await sub({ company: "Mesa Pro Painting (sample)", contact: "Jordan Lee", phone: "+16195550102", status: "active", skills: ["interior", "exterior", "stucco", "wood_metal", "pergola_fence"], areas: ["san diego", "la mesa", "santee", "el cajon", "poway"], rating: 4, max: 2, crew: 3 });
  const harbor = await sub({ company: "Harbor Coatings (sample)", contact: "Sam Patel", phone: "+16195550103", status: "active", skills: ["interior", "exterior", "epoxy", "skim_coat", "wallpaper"], areas: ["san diego", "chula vista", "national city", "coronado"], rating: 4, max: 2, crew: 2 });
  const summit = await sub({ company: "Summit Brush Co. (sample)", contact: "Taylor Kim", phone: "+16195550104", status: "active", skills: ["interior", "exterior", "cabinets"], areas: ["escondido", "san marcos", "poway"], rating: 3, max: 2, crew: 2 });
  const newco = await sub({ company: "Fresh Coat Crew (sample)", contact: "Morgan Diaz", phone: "+16195550105", status: "onboarding", skills: ["interior"], areas: ["san diego"], rating: null, max: 1, crew: 2 });

  const docs = async (subId: string, glExpires: string, verified = true) => {
    for (const [type, exp] of [
      ["general_liability", glExpires],
      ["workers_comp", glExpires],
      ["w9", null],
      ["sub_agreement", null],
    ] as const) {
      await db.query(
        `insert into sub_documents (subcontractor_id, doc_type, expires_on, verified_by, verified_at, notes)
         values ($1,$2,$3,$4,$5,'Sample — no file attached')`,
        [subId, type, exp, verified ? owner.id : null, verified ? new Date().toISOString() : null],
      );
    }
  };
  await docs(coastline, addDays(240));
  await docs(mesa, addDays(20)); // expiring soon → warning
  await docs(harbor, addDays(180));
  await docs(summit, addDays(-10)); // EXPIRED → blocked from offers
  await db.query(
    "insert into sub_documents (subcontractor_id, doc_type, notes) values ($1,'w9','Sample — awaiting verification')",
    [newco],
  );

  for (const s of [coastline, mesa, harbor])
    for (const step of ["intro_call", "references_checked", "sample_job_reviewed", "payment_setup", "standards_reviewed", "portal_login_sent"])
      await db.query("insert into onboarding_steps (subcontractor_id, step, completed_at, completed_by) values ($1,$2,now(),$3)", [s, step, owner.id]);
  await db.query("insert into onboarding_steps (subcontractor_id, step, completed_at, completed_by) values ($1,'intro_call',now(),$2)", [newco, owner.id]);

  const subUser = async (email: string, name: string, subId: string) =>
    (
      await db.query<{ id: string }>(
        "insert into users (email, name, role, subcontractor_id, password_hash) values ($1,$2,'sub',$3,$4) returning id",
        [email, name, subId, hash],
      )
    ).rows[0].id;
  const subAUser = await subUser(SAMPLE_LOGINS.subA, "Alex Rivera", coastline);
  const subBUser = await subUser(SAMPLE_LOGINS.subB, "Jordan Lee", mesa);
  await subUser(SAMPLE_LOGINS.subC, "Sam Patel", harbor);

  // --- Jobs --------------------------------------------------------------
  const job = async (j: {
    num: string;
    customer: string;
    address: string;
    city: string;
    services: string[];
    title: string;
    workOrder: string | null;
    contract: number;
    target: number | null;
    start: string | null;
    days: number;
    deposit: boolean;
    colors: boolean;
    status?: string;
  }) =>
    (
      await db.query<{ id: string }>(
        `insert into jobs (job_number, customer_name, customer_phone, address, city, zip, services, title, work_order, internal_notes,
           contract_amount_cents, target_payout_cents, proposed_start, proposed_end, estimated_days, deposit_received, colors_confirmed, status, source)
         values ($1,$2,'+16195550199',$3,$4,'92000',$5,$6,$7,'Sample internal note — customer prefers text, gate code 1234',$8,$9,$10,$11,$12,$13,$14,$15,'sample') returning id`,
        [
          j.num, j.customer, j.address, j.city, j.services, j.title, j.workOrder, j.contract * 100, j.target == null ? null : j.target * 100,
          j.start, j.start ? addDays(daysFromToday(j.start) + Math.ceil(j.days) - 1) : null,
          j.days, j.deposit, j.colors, j.status ?? "draft",
        ],
      )
    ).rows[0].id;

  const WO_EXT = `EXTERIOR REPAINT — body, trim, fascia, garage door
Prep: pressure wash, scrape loose paint, sand edges, caulk gaps with SW 1050QD, spot prime bare wood with ProBlock.
Paint: 2 coats SW Duration Satin body, 2 coats Duration Semi-Gloss trim.
Protect: mask windows, cover plants, drop cloths on hardscape.
Exclusions: no wood replacement unless approved by PB.`;
  const WO_INT = `INTERIOR REPAINT — living room, hallway, 3 bedrooms (walls only)
Prep: patch nail holes, caulk baseboards, spot prime patches.
Paint: 2 coats SW Emerald Matte walls. Ceilings/trim excluded.
Protect: move furniture to center and cover, floor protection throughout.`;
  const WO_CAB = `KITCHEN CABINETS — 24 doors, 10 drawer fronts, boxes
Prep: remove doors/hardware & label, degloss, sand, fill grain where noted, prime with SW Extreme Bond.
Paint: 2 coats SW Emerald Urethane Trim Enamel, sprayed (doors off-site), boxes brushed/rolled.
Reinstall & adjust hinges.`;

  const j1 = await job({ num: "S-1001", customer: "Pat Morgan", address: "123 Sample St", city: "La Mesa", services: ["exterior"], title: "Exterior repaint — 2-story", workOrder: WO_EXT, contract: 9800, target: 4900, start: addDays(9), days: 5, deposit: true, colors: true });
  const j2 = await job({ num: "S-1002", customer: "Chris Nguyen", address: "456 Example Ave", city: "San Diego", services: ["interior"], title: "Interior repaint — 5 rooms", workOrder: WO_INT, contract: 6200, target: 3100, start: addDays(5), days: 3, deposit: true, colors: true });
  const j3 = await job({ num: "S-1003", customer: "Robin Alvarez", address: "789 Demo Ct", city: "Chula Vista", services: ["cabinets"], title: "Kitchen cabinets — white", workOrder: WO_CAB, contract: 7400, target: 3600, start: addDays(14), days: 6, deposit: true, colors: false });
  const j4 = await job({ num: "S-1004", customer: "Jamie Brooks", address: "22 Placeholder Rd", city: "El Cajon", services: ["interior", "drywall"], title: "Interior + drywall repair", workOrder: null, contract: 4300, target: 2100, start: null, days: 2, deposit: false, colors: false });
  const j5 = await job({ num: "S-1005", customer: "Drew Collins", address: "9 Fictional Way", city: "San Diego", services: ["exterior", "wood_metal"], title: "Exterior + wrought iron railings", workOrder: WO_EXT + "\nAlso: wire-brush and paint iron railings, Pro Industrial DTM.", contract: 11800, target: 5900, start: addDays(2), days: 6, deposit: true, colors: true });

  for (const [jobId, labels] of [
    [j1, ["Front elevation", "Rear elevation", "Garage door"]],
    [j2, ["Living room", "Hallway"]],
    [j3, ["Kitchen overview"]],
    [j5, ["Front", "Railings"]],
  ] as const) {
    let hue = 30;
    for (const label of labels) {
      const bytes = samplePhotoSvg(label, (hue += 50));
      const f = await db.query<{ id: string }>(
        "insert into files (file_name, content_type, size_bytes, data, uploaded_by) values ($1,'image/svg+xml',$2,$3,$4) returning id",
        [`${label}.svg`, bytes.byteLength, bytes, owner.id],
      );
      await db.query("insert into job_photos (job_id, file_id, caption, share_with_crew) values ($1,$2,$3,true)", [jobId, f.rows[0].id, `${label} (sample)`]);
    }
  }
  // An internal-only photo (e.g. signed contract) — crews must never see it
  const privateBytes = samplePhotoSvg("INTERNAL ONLY", 0);
  const pf = await db.query<{ id: string }>(
    "insert into files (file_name, content_type, size_bytes, data, uploaded_by) values ('contract.svg','image/svg+xml',$1,$2,$3) returning id",
    [privateBytes.byteLength, privateBytes, owner.id],
  );
  await db.query("insert into job_photos (job_id, file_id, caption, share_with_crew) values ($1,$2,'Signed contract (internal)',false)", [j1, pf.rows[0].id]);

  // ready status where checks pass
  await db.query("update jobs set status = 'ready' where id = any($1)", [[j1, j2, j3, j5]]);

  // --- Offers ------------------------------------------------------------
  const subA: Actor = { userId: subAUser, role: "sub", name: "Alex Rivera", email: SAMPLE_LOGINS.subA, subcontractorId: coastline };
  const subB: Actor = { userId: subBUser, role: "sub", name: "Jordan Lee", email: SAMPLE_LOGINS.subB, subcontractorId: mesa };

  // J1: offered to Coastline and Mesa; Mesa counteroffers (pending owner approval)
  const o1a = await createOffer(ownerActor, { jobId: j1, subcontractorId: coastline, payoutCents: 480000 });
  const o1b = await createOffer(ownerActor, { jobId: j1, subcontractorId: mesa, payoutCents: 470000 });
  await sendOffer(ownerActor, o1a.id);
  await sendOffer(ownerActor, o1b.id);
  await respondToOffer(subB, o1b.id, { kind: "counteroffer", amountCents: 520000, note: "Back side needs a lot of scraping — 2 extra days." });

  // J2: offered to Coastline, accepted and awarded → on the calendar
  const o2 = await createOffer(ownerActor, { jobId: j2, subcontractorId: coastline, payoutCents: 300000 });
  await sendOffer(ownerActor, o2.id);
  await respondToOffer(subA, o2.id, { kind: "accept", note: "Can start on the proposed date." });
  await awardOffer(ownerActor, o2.id);

  // J3: offered to Coastline, sub requests walkthrough
  const o3 = await createOffer(ownerActor, { jobId: j3, subcontractorId: coastline, payoutCents: 350000, noteToSub: "Customer is home after 3pm." });
  await sendOffer(ownerActor, o3.id);
  await respondToOffer(subA, o3.id, { kind: "walkthrough_request", note: "Want to check the cabinet boxes before pricing." });

  // J5: draft offer to Harbor (not yet visible to Harbor)
  await createOffer(ownerActor, { jobId: j5, subcontractorId: harbor, payoutCents: 580000, overrideReason: "Sample: Harbor doesn't list wood/metal" });

  return { owner: ownerActor, subs: { coastline, mesa, harbor, summit, newco }, jobs: { j1, j2, j3, j4, j5 } };
}

function daysFromToday(iso: string) {
  return Math.round((Date.parse(iso) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);
}
