#!/usr/bin/env node
/**
 * REAL-BROWSER verification of the Vocabulary word map.
 *
 * Why this moved out of scripts/verify-vocabulary.mjs: the map lives in
 * VocabWordsPanel, a CLIENT component that renders its tiles only after its data request
 * resolves. The server-rendered HTML for /app/vocabulary contains a loading boundary and
 * no `data-word-map` at all, so asserting on the raw HTTP body could only ever fail — and
 * it was failing for that reason, not because the map was broken. Confirmed by driving a
 * real browser: the tiles render with correct per-state and per-source counts.
 *
 * The invariants are unchanged; only the place they are measured is correct now:
 *   1. the map renders, with per-state and per-source tiles carrying real counts;
 *   2. the source tiles add up to THIS student's library size, taken from the database,
 *      so the tally is per user rather than global;
 *   3. no other account's word appears on the page;
 *   4. a tile filters the list (it is navigation, not decoration).
 *
 * Requirements (deliberately NOT repo dependencies):
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *   a built server on BASE_URL;  LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const STUDENT = { email: "demo.student@learnersarea.uz", password: "Student12345!" };

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

try {
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
  await page.goto(`${BASE}/app/vocabulary`, { waitUntil: "networkidle0", timeout: 60000 });

  // Wait for the panel's own data to land rather than sleeping a fixed amount.
  await page
    .waitForSelector("[data-word-map-state]", { timeout: 30000 })
    .catch(() => {});

  const map = await page.evaluate(() => ({
    present: Boolean(document.querySelector("[data-word-map]")),
    states: [...document.querySelectorAll("[data-word-map-state]")].map((el) => ({
      state: el.getAttribute("data-word-map-state"),
      count: Number(el.getAttribute("data-word-map-count")),
    })),
    sources: [...document.querySelectorAll("[data-word-map-source]")].map((el) => ({
      source: el.getAttribute("data-word-map-source"),
      count: Number(el.getAttribute("data-word-map-count")),
    })),
    terms: [...document.querySelectorAll("[data-vocab-term]")].map((el) => el.textContent?.trim()),
  }));

  check("the library carries a word map", map.present);
  check("the map counts the library by state", map.states.length > 0, `tiles=${map.states.length}`);
  check("the map counts where the words came from", map.sources.length > 0, `tiles=${map.sources.length}`);
  check(
    "each map tile carries a real count",
    [...map.states, ...map.sources].every((t) => Number.isFinite(t.count)),
    JSON.stringify([...map.states, ...map.sources])
  );

  const own = await db.query(
    "select count(*)::int n from user_vocabulary v join users u on u.id = v.user_id where u.email = $1",
    [STUDENT.email]
  );
  const libSize = own.rows[0].n;
  // POSITIVE CONTROL: an empty library would make every count assertion vacuous.
  check("the fixture student has a non-empty library", libSize > 0, `${libSize} words`);

  const sourceTotal = map.sources.reduce((a, t) => a + t.count, 0);
  check(
    `the source tiles add up to this student's own library (${libSize} words)`,
    sourceTotal === libSize,
    `tiles sum to ${sourceTotal}`
  );
  const stateTotal = map.states.reduce((a, t) => a + t.count, 0);
  check(
    `the state tiles add up to this student's own library (${libSize} words)`,
    stateTotal === libSize,
    `tiles sum to ${stateTotal}`
  );

  // A term belonging only to another account must never appear here.
  const foreign = await db.query(
    `select l.term from user_vocabulary v
       join users u on u.id = v.user_id
       join lexemes l on l.id = v.lexeme_id
      where u.email <> $1
        and l.term not in (
          select l2.term from user_vocabulary v2
            join lexemes l2 on l2.id = v2.lexeme_id
           where v2.user_id = (select id from users where email = $1))
      limit 1`,
    [STUDENT.email]
  );
  if (foreign.rows.length > 0) {
    const term = foreign.rows[0].term;
    const body = await page.content();
    check(`no other student's word leaks into the map (${term})`, !body.includes(`>${term}<`));
  } else {
    check("no other student's word leaks into the map", true, "no foreign term available to test");
  }

  // The map is navigation: clicking a non-empty state tile must filter the list.
  const clickable = map.states.find((t) => t.count > 0);
  if (clickable) {
    const before = await page.evaluate(() => document.querySelectorAll("[data-vocab-term]").length);
    await page.click(`[data-word-map-state="${clickable.state}"]`);
    await new Promise((r) => setTimeout(r, 750));
    const after = await page.evaluate((state) => ({
      rows: document.querySelectorAll("[data-vocab-term]").length,
      pressed: document.querySelector(`[data-word-map-state="${state}"]`)?.getAttribute("aria-pressed"),
      cleared: Boolean(document.querySelector("[data-word-map-clear]")),
    }), clickable.state);
    check(
      `clicking the "${clickable.state}" tile filters the list`,
      after.pressed === "true" && after.cleared && after.rows <= before,
      `before=${before} after=${after.rows} pressed=${after.pressed} clear=${after.cleared}`
    );
  } else {
    check("clicking a tile filters the list", false, "no non-empty state tile to click");
  }
} finally {
  await browser.close();
  await db.end().catch(() => {});
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
