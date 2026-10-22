// End-to-end smoke test against a running server (sample data).
// Usage: npm run start (in one terminal), then: node e2e/smoke.mjs [baseUrl] [screenshotDir]
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3];
const PW = "PB-sample-2026";
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();

async function session(email, device) {
  const ctx = await browser.newContext(device ?? { viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL(/\/(hub|crew)/), page.click("button:has-text('Sign in')")]);
  return { ctx, page };
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

// --- Owner -------------------------------------------------------------
{
  const { page } = await session("owner@sample.pbhub.test");
  check(page.url().endsWith("/hub"), "owner lands on the Hub");
  check(await page.locator("text=Margin").first().isVisible(), "owner sees margin column");
  await shot(page, "01-owner-dashboard");
  await page.locator("text=Exterior repaint — 2-story >> visible=true").first().click();
  await page.waitForSelector("text=Private offers");
  check(await page.locator("text=Financials (owner only)").isVisible(), "owner sees financials on job");
  await shot(page, "02-owner-job");
  await page.goto(`${BASE}/hub/approvals`);
  check(await page.locator("text=Mesa Pro Painting (sample)").isVisible(), "counteroffer is in approvals");
  await shot(page, "03-owner-approvals");
  await page.goto(`${BASE}/hub/calendar`);
  await shot(page, "04-calendar");
  await page.goto(`${BASE}/hub/subs`);
  await shot(page, "05-subs");
  await page.locator("text=Summit Brush Co. (sample) >> visible=true").first().click();
  await page.waitForURL(/\/hub\/subs\/[0-9a-f-]+/);
  check(await page.locator("text=Blocked from offers").isVisible(), "expired-insurance sub is blocked");
  await shot(page, "06-sub-profile");
  await page.goto(`${BASE}/hub/activity`);
  await shot(page, "07-activity");
  await page.goto(`${BASE}/crew`);
  check(page.url().endsWith("/hub"), "owner is redirected away from the Crew Portal");
}

// --- Coordinator ----------------------------------------------------------
{
  const { page } = await session("coordinator@sample.pbhub.test");
  check(!(await page.locator("th:has-text('Margin')").count()), "coordinator has no margin column");
  await page.locator("text=Exterior repaint — 2-story >> visible=true").first().click();
  await page.waitForSelector("text=Private offers");
  check(!(await page.locator("text=Financials (owner only)").count()), "coordinator does not see financials");
  check(!(await page.locator("text=$9,800").count()), "coordinator never sees the $9,800 contract");
  await page.goto(`${BASE}/hub/settings`);
  check(page.url().endsWith("/hub"), "coordinator can't open settings");
}

// --- Sub on iPhone ---------------------------------------------------------
{
  const { page, ctx } = await session("crew@coastline-sample.test", devices["iPhone 13"]);
  check(page.url().endsWith("/crew"), "sub lands on Crew Portal");
  const html = await page.content();
  check(!/Mesa Pro|Harbor Coatings|9,800|4,900|gate code/.test(html), "crew list shows no competitors, contract, target or internal notes");
  await shot(page, "10-crew-list-iphone");
  await page.locator("text=Exterior repaint — 2-story >> visible=true").first().click();
  await page.waitForSelector("text=Work order");
  const detail = await page.content();
  check(!/Mesa Pro|Jordan|5,200|9,800|4,900|gate code|619555019/.test(detail), "crew offer page leaks nothing confidential");
  check(!/other crews|others are|bidders|interested/i.test(detail), "no competition indicators");
  await shot(page, "11-crew-offer-iphone");

  // try to open Mesa's offer by URL → 404
  const resp = await page.goto(`${BASE}/hub`);
  check(page.url().endsWith("/crew"), "sub is redirected away from the Hub");
  const api = await ctx.request.get(`${BASE}/api/files/doc/00000000-0000-0000-0000-000000000000`);
  check(api.status() === 404, "sub can't fetch internal documents");

  // Respond: suggest a start date on the cabinet job
  await page.goto(`${BASE}/crew`);
  await page.locator("text=Kitchen cabinets — white >> visible=true").first().click();
  await page.click("summary:has-text('Suggest a start date')");
  await page.fill("input[name=suggested_start]", "2030-03-02");
  await page.click("button:has-text('Send date')");
  await page.waitForSelector("text=Start date suggestion sent");
  check(true, "sub suggested a start date");
  void resp;
}

// --- Mesa tries Coastline's offer by id ---------------------------------------
{
  const { page: coast } = await session("crew@coastline-sample.test");
  await coast.locator("text=Exterior repaint — 2-story >> visible=true").first().click();
  await coast.waitForURL(/\/crew\/offers\//);
  const coastOfferUrl = coast.url();
  const { page: mesa } = await session("crew@mesa-sample.test");
  const r = await mesa.goto(coastOfferUrl);
  check(r?.status() === 404, "another sub's offer URL returns 404");
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
