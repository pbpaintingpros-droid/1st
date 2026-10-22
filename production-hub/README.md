# PB Production Hub — Stage 1

Subcontractor assignment and scheduling for PB Painting. It has two sides:

| | **PB Production Hub** (internal) | **PB Crew Portal** (subcontractors) |
|---|---|---|
| Who | Owner (Cameron), Coordinator (Santiago) | Each sub company, with its own login |
| URL | `/hub` | `/crew` |
| Sees | All jobs, all offers, all subs, activity log. Owner also sees contract amounts and margins | **Only** offers sent to their own company |
| Does | Check job readiness, match subs, send private offers, review counteroffers, award, schedule | Accept, decline, ask for a walkthrough, suggest a start date, counteroffer |

> **Status: SAMPLE DATA ONLY.** Nothing is connected to DripJobs, CompanyCam, Google Sheets or RingCentral. No texts or emails are sent. All names, addresses and prices are made up.

---

## Try it (on this computer)

You need Node.js 20+ installed. In a terminal, inside the `production-hub` folder:

```bash
npm install          # first time only
npm run db:seed      # loads the sample data (built-in local database, no setup)
npm run dev          # starts the app
```

Open http://localhost:3000 and sign in. Password for every sample login: **`PB-sample-2026`**

| Login | Role |
|---|---|
| `owner@sample.pbhub.test` | Owner — everything |
| `coordinator@sample.pbhub.test` | Coordinator — no prices/margins, can't approve counteroffers |
| `crew@coastline-sample.test` | Sub: Coastline Finishes |
| `crew@mesa-sample.test` | Sub: Mesa Pro Painting (has a counteroffer pending) |
| `crew@harbor-sample.test` | Sub: Harbor Coatings |

To start over with fresh sample data: `npm run db:reset` then `npm run db:seed`.

## Run the automated tests

```bash
npm test             # 48 tests: permissions, bid confidentiality, workflow, import
npm run lint         # TypeScript type check
```

With the app running (`npm run build && npm start`), the browser click-through test:

```bash
node e2e/smoke.mjs http://localhost:3000
```

---

## How an offer works

```
Job (from import/DripJobs)
  │  Readiness check: work order, services, target payout, start date, deposit   ← must all pass
  ▼
Matching: subs ranked by skills, service area, rating, capacity                  ← rules set in Settings
  │  Insurance/W-9/agreement must be on file, verified, not expired              ← can never be overridden
  ▼
Draft offer (private to PB) ──► Send ──► appears ONLY in that sub's portal
                                          │
            ┌─────────────┬───────────────┼───────────────┬──────────────┐
         Accept        Decline     Walkthrough      Start date      Counteroffer
            │                                                          │
            │                                       Coordinator recommends (optional)
            │                                       Owner approves / rejects
            ▼                                                          │
         Award ◄───────────────────────────────────────────────────────┘
            │  Job assigned at the agreed payout, scheduled
            │  Every other open offer closes as "No longer available"
            ▼
         Calendar
```

**Price safeguards**
- Coordinator can send offers **at or below** the job's target payout. Above target → owner must send.
- Only the owner approves counteroffers. Approving is what changes the payout.
- Every price change, assignment and sub response is written to an activity log that **cannot be edited or deleted** (enforced by the database itself).

**What a sub never sees** (enforced on the server and covered by tests):
other subs' names or bids, how many subs got the offer, customer contract amount, PB's target payout, margins, internal notes, customer phone, internal-only photos. No "3 crews interested" or other competition/urgency indicators. A sub asking for another sub's offer gets "Not found" — they can't even tell it exists.

---

## Moving to Supabase (when you're ready)

1. Create a Supabase project → **Project Settings → Database → Connection string → URI** (use the *Session pooler* one).
2. Copy `.env.example` to `.env.local` and paste it as `DATABASE_URL=...`.
3. Run `npm run db:migrate` — creates the tables.
4. Create your real owner login (ask Claude to add a one-time "create owner" step — not done yet on purpose).
5. Import your real subs and open jobs from CSV on the **Import** page.

The app refuses to load sample data into a database set by `DATABASE_URL` unless you explicitly confirm.

Hosting: the app is a standard Next.js app (Vercel works). Not deployed yet.

## Where things live

| Folder | What |
|---|---|
| `db/migrations/` | Database tables (plain SQL — works on Supabase) |
| `src/lib/permissions.ts` | **Who can do what.** Edit here to change Santiago's access |
| `src/lib/services/rules.ts` | Readiness checks, insurance checks, matching rules |
| `src/lib/services/offers.ts` | Staff side of offers/counteroffers/award |
| `src/lib/services/crew.ts` | Crew Portal — the confidentiality boundary |
| `src/lib/integrations/` | DripJobs / CompanyCam / Sheets / RingCentral plans (not connected) |
| `tests/` | Automated tests |
| `docs/INTEGRATIONS.md` | Integration plan |

## Not in Stage 1 (next stages)

- Live integrations (each needs to be verified first — see `docs/INTEGRATIONS.md`)
- Sending texts/emails (outbox exists; sending is hard-off)
- Password reset, two-factor login, user management screen
- Photo upload from the Hub (photos come from sample data now; CompanyCam later)
- Sub self-service document upload and onboarding
- Re-assigning an awarded job, change orders, payment tracking
