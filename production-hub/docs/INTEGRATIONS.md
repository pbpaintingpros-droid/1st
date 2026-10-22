# Integration plan

Status today: **none connected.** Everything runs on sample data and CSV import.
Each integration goes live only after (1) it's tested against your real account in read-only mode, and (2) you approve turning it on.

| System | What the Hub would do | Direction | Risk to live records | How to verify first |
|---|---|---|---|---|
| **DripJobs** | Pull sold jobs (customer, address, scope, price) so nobody retypes them | Read only | None — Hub never writes to DripJobs | Confirm your plan has API/Zapier access. Until then: export CSV → Hub **Import** page |
| **CompanyCam** | Pull project photos by address; you pick which are shared with the crew | Read only | None | Create an API token, test on one project, check photo matching by address |
| **Google Sheets** | Weekly production summary for your Monday review (jobs assigned, payouts, margin) | Write to one report sheet | Low — only a sheet you choose | Make a new blank sheet; never point at an existing live sheet |
| **RingCentral** | Text a sub "You have a new offer — log in to view" (no prices in texts) | Outbound SMS | Medium — messages real people | Confirm SMS + A2P 10DLC registration; send test texts to your own phone only |

## Safety rules built in
- Outbound actions are written to the **outbox** table with status `pending_approval`. Nothing leaves until an owner approves **and** `OUTBOUND_MESSAGING_ENABLED=true`.
- Texts never include prices, customer names, or other subs.
- Imports only *add* to the Hub. Duplicate job numbers are skipped.

## Code
- `src/lib/integrations/types.ts` — the contract each adapter implements (`CrmSource`, `PhotoSource`, `SheetSink`, `SmsChannel`)
- `src/lib/integrations/index.ts` — current placeholder adapters (they refuse to run) and the status shown on the Integrations page
