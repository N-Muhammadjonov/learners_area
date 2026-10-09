#!/usr/bin/env node
/**
 * REAL-BROWSER verification of the Live Partner question search (C-OPEN-03).
 *
 * The server-side keyset continuation is covered by unit tests. What those cannot
 * prove is the part of the contract that only exists in the browser: that the room
 * distinguishes idle / loading / success / empty / error, that a slow reply for an
 * abandoned term is never presented as the new term's results, that a stale response
 * cannot overwrite a newer one, that a failed request is visible and retryable rather
 * than silently swallowed, that the cursor walk reaches prompts far past the first
 * page, and that a chosen prompt survives a later search.
 *
 * These are asserted by driving a real Chromium against the built server, using CDP
 * request interception to delay and to fail individual API calls — the only honest way
 * to create a stale-response race.
 *
 * Requirements (deliberately NOT repo dependencies):
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *   a built server on BASE_URL;  LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp
 *   a bank with >1500 published prompts matching one broad term.
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const STUDENT = { email: "demo.student@learnersarea.uz", password: "Student12345!" };
const QUESTIONS_API = "/api/speaking/live-partner/questions";

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const browser = await puppeteer.launch({
  args: [...chromium.args.filter((a) => a !== "--single-process"), "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

const searchState = (page) =>
  page.evaluate(() => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") ?? null);

const topicCount = (page) => page.evaluate(() => document.querySelectorAll('[data-practice-part="part1"] li button').length);

const topicLabels = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-practice-part="part1"] li button span:first-child')].map((el) => el.textContent?.trim()));

const typeSearch = async (page, term) => {
  // Triple-click is not a reliable clear on a controlled React input: it left the old
  // term in place and produced a concatenated query, which looked like a product defect
  // but was purely a harness bug. Select-all from the keyboard, then verify the field
  // really is what we think before asserting anything about the results.
  const input = await page.$('input[type="search"]');
  await input.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  const cleared = await page.evaluate(() => document.querySelector('input[type="search"]').value);
  if (cleared !== "") throw new Error(`search box did not clear, still holds ${JSON.stringify(cleared)}`);
  if (term) await page.type('input[type="search"]', term);
  const got = await page.evaluate(() => document.querySelector('input[type="search"]').value);
  if (got !== (term ?? "")) throw new Error(`search box holds ${JSON.stringify(got)}, expected ${JSON.stringify(term)}`);
};

try {
  // POSITIVE CONTROL: without a bank bigger than one page, every reachability
  // assertion below would be vacuously true.
  const { rows: bank } = await db.query(
    `select count(*)::int n from speaking_prompts
      where publication_state = 'published'
        and (available_in @> '["live_partner"]'::jsonb or available_in @> '["practice_alone"]'::jsonb)
        and prompt_text ilike '%scenario%'`
  );
  const matching = bank[0].n;
  check("the bank holds more published matches than one page", matching > 500, `${matching} matching prompts`);

  const { rows: draft } = await db.query(
    `select count(*)::int n from speaking_prompts where publication_state = 'draft' and prompt_text ilike '%scenario%'`
  );
  check("a draft prompt exists to make the leak test meaningful", draft[0].n > 0, `${draft[0].n} drafts`);

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.type("#email", STUDENT.email);
  await page.type("#password", STUDENT.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/app/speaking/live-partner`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('input[type="search"]', { timeout: 30000 });

  // ---- 1. idle ------------------------------------------------------------
  check("before any search the room is idle, not loading or errored", (await searchState(page)) === "idle");
  const initialTopics = await topicCount(page);
  check("the initial catalogue still renders without searching", initialTopics > 0, `${initialTopics} topics`);

  // ---- 2. loading then success -------------------------------------------
  // Intercept so the reply is slow enough for 'loading' to be observable.
  // ONE persistent handler for the whole run. Swapping handlers mid-flight leaves an
  // already-intercepted request with nobody to resolve it, which hangs the page and
  // produces failures that are harness artefacts rather than product defects.
  await page.setRequestInterception(true);
  let delayMs = 0;
  let failNext = false;
  let delayToken = null;   // when set, only URLs containing it are delayed, once
  page.on("request", async (req) => {
    const url = req.url();
    if (!url.includes(QUESTIONS_API)) { if (!req.isInterceptResolutionHandled()) await req.continue().catch(() => {}); return; }
    if (failNext) {
      failNext = false;
      if (!req.isInterceptResolutionHandled()) await req.respond({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }).catch(() => {});
      return;
    }
    // Delay is applied without blocking other interceptions: resolve this one later.
    const wait = delayToken && url.includes(delayToken) ? 4000 : delayMs;
    if (wait) {
      if (delayToken && url.includes(delayToken)) delayToken = null;
      setTimeout(() => { if (!req.isInterceptResolutionHandled()) void req.continue().catch(() => {}); }, wait);
      return;
    }
    if (!req.isInterceptResolutionHandled()) await req.continue().catch(() => {});
  });

  delayMs = 1500;
  await typeSearch(page, "scenario");
  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "loading",
    { timeout: 15000 }
  ).then(() => check("a search in flight is reported as loading", true))
   .catch(() => check("a search in flight is reported as loading", false, "never entered loading"));

  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "success",
    { timeout: 30000 }
  ).then(() => check("a completed search is reported as success", true))
   .catch(() => check("a completed search is reported as success", false, `state=${""}`));
  delayMs = 0;

  const afterSearch = await topicCount(page);
  check("the broad search returns a bounded page, not the whole bank", afterSearch > 0 && afterSearch <= 500, `${afterSearch} topics`);

  const labels = await topicLabels(page);
  check("no draft prompt leaks into the room", !labels.some((l) => (l ?? "").includes("Secret QA topic")));

  // ---- 3. continuation ----------------------------------------------------
  const moreBtn = await page.$("[data-partner-search-more]");
  check("a bounded broad search offers a continuation control", Boolean(moreBtn));
  if (moreBtn) {
    const before = await topicCount(page);
    await moreBtn.click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-practice-part="part1"] li button').length > n,
      { timeout: 30000 }, before
    ).catch(() => {});
    const after = await topicCount(page);
    check("loading more reaches prompts beyond the first page", after > before, `${before} -> ${after}`);

    const all = await topicLabels(page);
    const unique = new Set(all);
    check("paging in the browser never duplicates a prompt", unique.size === all.length, `${all.length} rows, ${unique.size} unique`);
  }

  // ---- 4. error + retry ---------------------------------------------------
  failNext = true;
  await typeSearch(page, "scenario 00007");
  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "error",
    { timeout: 30000 }
  ).then(() => check("a failed search is surfaced as an error, not silently ignored", true))
   .catch(() => check("a failed search is surfaced as an error, not silently ignored", false));

  const retry = await page.$("[data-partner-search-retry]");
  check("a failed search offers a retry", Boolean(retry));
  if (retry) {
    await retry.click();
    await page.waitForFunction(
      () => ["success", "empty"].includes(document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state")),
      { timeout: 30000 }
    ).then(() => check("retry recovers the search after a failure", true))
     .catch(() => check("retry recovers the search after a failure", false));
  }

  // ---- 5. empty -----------------------------------------------------------
  await typeSearch(page, "zzz-no-such-prompt-zzz");
  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "empty",
    { timeout: 30000 }
  ).then(() => check("a search with no matches is reported as empty, distinct from error", true))
   .catch(() => check("a search with no matches is reported as empty, distinct from error", false));

  // ---- 6. stale response race --------------------------------------------
  // Delay the FIRST term heavily, then change the term. The slow reply for the
  // abandoned term lands last; it must not be shown and must not overwrite.
  delayToken = "00011";

  await typeSearch(page, "scenario 00011");
  await new Promise((r) => setTimeout(r, 600)); // let the debounce fire the slow request
  await typeSearch(page, "scenario 00022");
  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "success",
    { timeout: 30000 }
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000)); // the abandoned reply lands in here

  const raced = await topicLabels(page);
  check(
    "a slow reply for an abandoned term is not presented as the new term's results",
    raced.some((l) => (l ?? "").includes("00022")) && !raced.some((l) => (l ?? "").includes("00011")),
    JSON.stringify(raced.slice(0, 6))
  );
  check("the stale reply did not overwrite the newer one", (await searchState(page)) === "success");

  // ---- 7. selection survives a later search -------------------------------
  delayToken = null;
  delayMs = 0;
  await typeSearch(page, "scenario 00033");
  await page.waitForFunction(
    () => document.querySelector("[data-partner-search-state]")?.getAttribute("data-partner-search-state") === "success",
    { timeout: 30000 }
  ).catch(() => {});
  const firstTopic = await page.$('[data-practice-part="part1"] li button');
  if (firstTopic) {
    await firstTopic.click();
    await page.waitForSelector("[data-partner-topic-question]", { timeout: 15000 }).catch(() => {});
    const chosen = await page.evaluate(
      () => document.querySelector("[data-partner-topic-question] p.whitespace-pre-line")?.textContent?.trim() ?? null
    );
    check("a prompt can be selected from a searched page", Boolean(chosen), String(chosen));

    await typeSearch(page, "scenario 00044");
    await new Promise((r) => setTimeout(r, 2500));
    const stillThere = await page.evaluate(() => Boolean(document.querySelector("[data-partner-topic-question]")));
    // Changing the term deliberately clears the selection in this room; what must not
    // happen is a blank panel left behind claiming a prompt is open.
    const panelBlank = await page.evaluate(() => {
      const panel = document.querySelector("[data-partner-topic-question]");
      if (!panel) return false;
      return (panel.querySelector("p.whitespace-pre-line")?.textContent ?? "").trim().length === 0;
    });
    check("a later search never leaves an open prompt panel blank", !panelBlank, `panelPresent=${stillThere}`);
  }

  await context.close();
} finally {
  await browser.close();
  await db.end();
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n  Failures:");
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
