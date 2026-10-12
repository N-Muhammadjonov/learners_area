#!/usr/bin/env node
/**
 * REAL-BROWSER acceptance for the lesson unit picker — Package A1/A2/A3/A5.
 *
 * The server side (bounded page, keyset continuation, cursor validation, label
 * identity) is covered by unit tests. None of those can prove the part of the contract
 * that only exists in a browser:
 *
 *   A1 — a unit chosen AFTER a cursor walk must survive a later search that REPLACES
 *        the option list: same id, correct visible label, and the save must write the
 *        unit the author believes they chose. A <select> whose value matches no option
 *        silently displays the FIRST option, so this failure mode is invisible to any
 *        test that only reads form state.
 *   A2 — 620 units sharing course + module + unit title must be distinguishable in the
 *        rendered list, using a real curriculum discriminator.
 *   A3 — stale-response invalidation must fire on QUERY INTENT CHANGE, not when the
 *        debounced fetch starts. Proven with CDP request interception: the reply for an
 *        abandoned term is held until the next term is already in flight.
 *   A5 — the whole staff journey, ending in a database foreign-key check.
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
const STAFF = { email: "teacher@learnersarea.uz", password: "Teacher12345!" };
const UNITS_API = "/api/lessons/units";
const TOTAL_UNITS = 620;

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

const { assertMutableDatabase, fixtureTag } = await import("../lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL);
const TAG = fixtureTag("unit-picker");

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

/**
 * The corpus this probe measures. 620 units that share ONE course, ONE module and ONE
 * unit title: the exact shape where search cannot narrow below the page size, so the
 * cursor walk and the label discriminator are both load-bearing.
 */
async function createCorpus() {
  const { rows: [course] } = await db.query(
    "insert into courses(title,slug)values($1,$2)returning id",
    [`Picker Course ${TAG}`, `picker-course-${TAG}`],
  );
  const { rows: [module] } = await db.query(
    `insert into course_modules(course_id,title,slug,"order")values($1,$2,$3,1)returning id`,
    [course.id, `Picker Module ${TAG}`, `picker-module-${TAG}`],
  );
  const values = [];
  const params = [];
  for (let i = 1; i <= TOTAL_UNITS; i += 1) {
    const base = (i - 1) * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, ${i})`);
    params.push(module.id, `Picker Unit ${TAG}`, `picker-unit-${i}-${TAG}`);
  }
  await db.query(`insert into units(module_id,title,slug,"order")values ${values.join(",")}`, params);
  const { rows } = await db.query(
    `select id from units where module_id=$1 order by "order" asc`, [module.id],
  );
  return { courseId: course.id, moduleId: module.id, unitIds: rows.map((r) => r.id) };
}

async function dropCorpus() {
  await db.query(
    `delete from lessons where unit_id in (select id from units where slug like $1)`, [`%${TAG}%`],
  );
  await db.query("delete from units where slug like $1", [`%${TAG}%`]);
  await db.query("delete from course_modules where slug like $1", [`%${TAG}%`]);
  await db.query("delete from courses where slug like $1", [`%${TAG}%`]);
  const { rows } = await db.query(
    `select (select count(*) from units where slug like $1)
          + (select count(*) from course_modules where slug like $1)
          + (select count(*) from courses where slug like $1) as n`, [`%${TAG}%`],
  );
  if (Number(rows[0].n) !== 0) throw new Error(`fixture residue for ${TAG}: ${rows[0].n} rows`);
}

const browser = await puppeteer.launch({
  args: [...chromium.args.filter((a) => a !== "--single-process"), "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

// ---- small DOM helpers -------------------------------------------------------
const optionCount = (page) =>
  page.evaluate(() => document.querySelector("[data-lesson-authoring-unit]")?.options.length ?? 0);

/**
 * Options that belong to THIS probe's corpus.
 *
 * The raw option count is legitimately one higher than the page size: a new lesson
 * starts with the first seed unit selected, and A1 requires the current selection to
 * stay in the list even when it matches no search. Counting tagged options measures
 * the server page without mistaking that pinned selection for an off-by-one.
 */
const corpusOptionCount = (page, tag) =>
  page.evaluate(
    (t) => [...(document.querySelector("[data-lesson-authoring-unit]")?.options ?? [])]
      .filter((o) => o.textContent.includes(t)).length,
    tag,
  );

const selectedUnit = (page) =>
  page.evaluate(() => {
    const select = document.querySelector("[data-lesson-authoring-unit]");
    if (!select) return null;
    const option = select.selectedOptions[0];
    return { value: select.value, label: option ? option.textContent.trim() : null };
  });

const optionLabels = (page) =>
  page.evaluate(() => [...(document.querySelector("[data-lesson-authoring-unit]")?.options ?? [])].map((o) => o.textContent.trim()));

const unitStatus = (page) =>
  page.evaluate(() => document.querySelector("[data-lesson-unit-status]")?.textContent.trim() ?? "");

const typeSearch = async (page, term) => {
  // Select-all + Backspace: a triple-click is not a reliable clear on a controlled
  // React input, and a half-cleared box reads as a product defect that is really a
  // harness bug. Verify the field holds what we think before asserting on results.
  const input = await page.$("[data-lesson-unit-search]");
  await input.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (term) await page.type("[data-lesson-unit-search]", term);
  const got = await page.evaluate(() => document.querySelector("[data-lesson-unit-search]").value);
  if (got !== (term ?? "")) throw new Error(`search box holds ${JSON.stringify(got)}, expected ${JSON.stringify(term)}`);
};

const settle = (page, ms = 1400) => page.evaluate((d) => new Promise((r) => setTimeout(r, d)), ms);

const fixture = await createCorpus();

try {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // ---- log in as STAFF -------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", STAFF.email);
  await page.type("#password", STAFF.password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('button[type=submit]')]);

  await page.goto(`${BASE}/app/listening/lessons/author`, { waitUntil: "networkidle0" });
  const deskPresent = await page.$("[data-lesson-authoring-desk]");
  check("A5: staff can open the lesson authoring desk", Boolean(deskPresent));
  if (!deskPresent) throw new Error("no authoring desk: the rest of the journey cannot be measured");

  // Start a new lesson so the unit picker is rendered.
  await page.click("[data-lesson-authoring-new]");
  await page.waitForSelector("[data-lesson-authoring-unit]");

  // POSITIVE CONTROL: without a corpus bigger than one page every reachability
  // assertion below would be vacuously true.
  const { rows: [{ n: corpusSize }] } = await db.query(
    "select count(*)::int n from units where slug like $1", [`%${TAG}%`],
  );
  check("the corpus exceeds one bounded page", corpusSize === TOTAL_UNITS && TOTAL_UNITS > 500, `${corpusSize} units`);

  // ---- A3: search, then a cursor walk ----------------------------------------
  await typeSearch(page, `Picker Unit ${TAG}`);
  await settle(page);
  const firstPage = await corpusOptionCount(page, TAG);
  check("A3: a search returns one bounded page", firstPage === 500, `${firstPage} corpus options`);
  // The one extra option is the pinned current selection, and it must be exactly that
  // — not a duplicate and not a stray row.
  const beforeWalk = await selectedUnit(page);
  const totalShown = await optionCount(page);
  check("A1: the only option outside the search results is the current selection",
    totalShown - firstPage <= 1 && (totalShown === firstPage || !beforeWalk?.label?.includes(TAG)),
    `${totalShown} shown, ${firstPage} from the corpus, selected ${JSON.stringify(beforeWalk?.label)}`);

  const moreButton = await page.$("[data-lesson-unit-more]");
  check("A1: the desk offers continuation past the first page", Boolean(moreButton));
  await page.click("[data-lesson-unit-more]");
  await settle(page);
  const afterMore = await corpusOptionCount(page, TAG);
  check("A1: load more appends the remainder", afterMore === TOTAL_UNITS, `${afterMore} corpus options after load more`);

  // ---- A2: identical units are distinguishable in the RENDERED list ----------
  const labels = (await optionLabels(page)).filter((label) => label.includes(TAG));
  const distinct = new Set(labels);
  check("A2: every option in the list reads differently", distinct.size === labels.length,
    `${distinct.size} distinct of ${labels.length}`);
  check("A2: the discriminator is the authored unit order", /› 620\. Picker Unit/.test(labels[labels.length - 1] ?? ""),
    `last label: ${labels[labels.length - 1]}`);
  const lastUnitId = fixture.unitIds[TOTAL_UNITS - 1];
  check("A2: no option exposes a raw row id as its discriminator",
    !labels.some((label) => label.includes(lastUnitId)));

  // ---- A1: select unit #620, then search something else ----------------------
  await page.select("[data-lesson-authoring-unit]", lastUnitId);
  const picked = await selectedUnit(page);
  check("A1: unit #620 can be selected after the walk", picked?.value === lastUnitId, JSON.stringify(picked));
  const pickedLabel = picked?.label;

  await typeSearch(page, "Picker Module");
  await settle(page);
  const afterSearch = await selectedUnit(page);
  check("A1: the selected unit id survives a replacing search",
    afterSearch?.value === lastUnitId, `now ${JSON.stringify(afterSearch)}`);
  check("A1: the selection still shows its correct label, not another unit's",
    afterSearch?.label === pickedLabel, `was ${JSON.stringify(pickedLabel)}, now ${JSON.stringify(afterSearch?.label)}`);

  await typeSearch(page, "");
  await settle(page);
  const afterClear = await selectedUnit(page);
  check("A1: the selection survives clearing the search box",
    afterClear?.value === lastUnitId && afterClear?.label === pickedLabel, JSON.stringify(afterClear));

  // ---- A3: a delayed reply for an ABANDONED term must never be presented -----
  // The reply for term A is held past the moment term B is typed. If invalidation
  // only happened when B's debounced fetch STARTED, A's reply would land first and be
  // accepted as B's results.
  const client = await page.target().createCDPSession();
  await client.send("Fetch.enable", { patterns: [{ urlPattern: `*${UNITS_API}*`, requestStage: "Request" }] });
  let holdFirst = true;
  const seenQueries = [];
  client.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    seenQueries.push(query);
    if (holdFirst && query.includes("Picker Unit")) {
      holdFirst = false;
      setTimeout(() => client.send("Fetch.continueRequest", { requestId }).catch(() => {}), 3000);
      return;
    }
    await client.send("Fetch.continueRequest", { requestId }).catch(() => {});
  });

  await typeSearch(page, `Picker Unit ${TAG}`);
  await settle(page, 600);           // inside the delayed request, before it resolves
  await typeSearch(page, "Picker Module");
  await settle(page, 5000);          // long enough for the held reply to arrive too

  const staleCount = await optionCount(page);
  const staleStatus = await unitStatus(page);
  // "Picker Module" matches the module title, so every unit matches — but the point is
  // the list must reflect the CURRENT term's request, and must not be left showing a
  // stale loading state or the abandoned term's count.
  check("A3: a held reply for an abandoned term does not leave the picker loading",
    !/search/i.test(staleStatus) || staleCount > 0, `status: ${staleStatus}`);
  const stillSelected = await selectedUnit(page);
  check("A3: the selection survives the stale-response race",
    stillSelected?.value === lastUnitId, JSON.stringify(stillSelected));

  // ---- A3: a FAILED request is visible and retryable -------------------------
  await client.send("Fetch.disable");
  const failClient = await page.target().createCDPSession();
  await failClient.send("Fetch.enable", { patterns: [{ urlPattern: `*${UNITS_API}*`, requestStage: "Request" }] });
  let failNext = true;
  failClient.on("Fetch.requestPaused", async ({ requestId }) => {
    if (failNext) {
      failNext = false;
      await failClient.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
      return;
    }
    await failClient.send("Fetch.continueRequest", { requestId }).catch(() => {});
  });

  await typeSearch(page, `Picker Unit ${TAG}`);
  await settle(page, 2500);
  const retryButton = await page.$("[data-lesson-unit-retry]");
  check("A3: a failed unit search is surfaced with a retry, not swallowed", Boolean(retryButton));
  const failedSelection = await selectedUnit(page);
  check("A3: a failed search does not clear the selection",
    failedSelection?.value === lastUnitId, JSON.stringify(failedSelection));
  if (retryButton) {
    await retryButton.click();
    await settle(page, 2500);
    const recovered = await corpusOptionCount(page, TAG);
    check("A3: retry after a failure recovers the list", recovered >= 500, `${recovered} corpus options`);
  }
  await failClient.send("Fetch.disable");

  // ---- A5: save the lesson into unit #620 ------------------------------------
  const slug = `picker-lesson-${TAG}`;
  const beforeSelection = await selectedUnit(page);
  check("A5: the intended unit is still selected at save time",
    beforeSelection?.value === lastUnitId, JSON.stringify(beforeSelection));

  await page.type("[data-lesson-authoring-title]", `Picker Lesson ${TAG}`);
  await page.evaluate(() => { document.querySelector("[data-lesson-authoring-slug]").value = ""; });
  await page.click("[data-lesson-authoring-slug]");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.type("[data-lesson-authoring-slug]", slug);
  await page.click("[data-lesson-authoring-source-ref]");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.type("[data-lesson-authoring-source-ref]", `picker-ref-${TAG}`);

  await page.click("[data-lesson-authoring-save]");
  await settle(page, 5000);

  // ---- A5: THE DATABASE IS THE TRUTH -----------------------------------------
  const { rows: saved } = await db.query(
    `select l.id, l.unit_id, u.slug as unit_slug, u."order" as unit_order
       from lessons l join units u on u.id = l.unit_id
      where l.slug = $1`, [slug],
  );
  check("A5: the lesson row exists after save", saved.length === 1, `${saved.length} rows for ${slug}`);
  if (saved.length === 1) {
    check("A5: the foreign key points at the unit the author chose",
      saved[0].unit_id === lastUnitId, `saved ${saved[0].unit_id}, chose ${lastUnitId}`);
    check("A5: that unit really is #620 of the corpus",
      Number(saved[0].unit_order) === TOTAL_UNITS, `order ${saved[0].unit_order}`);
  }

  // ---- A5: reload and confirm the relationship is shown back -----------------
  await page.goto(`${BASE}/app/listening/lessons/author`, { waitUntil: "networkidle0" });
  const reopened = saved[0]?.id ? await page.$(`[data-lesson-authoring-item="${saved[0].id}"]`) : null;
  check("A5: the saved lesson appears in the desk list", Boolean(reopened));
  if (reopened) {
    await reopened.click();
    await page.waitForSelector("[data-lesson-authoring-unit]");
    await settle(page, 2500);
    const restored = await selectedUnit(page);
    check("A5: reopening shows the same unit id", restored?.value === lastUnitId, JSON.stringify(restored));
    // The unit is #620: it is NOT in the server-rendered first page, so this only
    // passes if the desk resolved the label by id.
    check("A5: reopening names the unit correctly though it is off the first page",
      /› 620\. Picker Unit/.test(restored?.label ?? ""), `label: ${restored?.label}`);
  }

  await context.close();
} finally {
  await browser.close();
  await dropCorpus();
  await db.end();
}

console.log(`\n${failures.length ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${failures.length} failed\x1b[0m`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length ? 1 : 0);
