/*
 * §04 — SPEAKING PRACTICE AND SPEAKING AI, DRIVEN IN A REAL BROWSER.
 *
 * The browser matrix proves surfaces render, are accessible, are translated and do not overflow. It
 * does not prove a JOURNEY: that choosing a Part really reaches a Topic, that a Topic really reaches a
 * Question, that a deep link survives a reload, that Back returns where the learner was, that a failed
 * request can actually be retried, or that the AI examiner really draws a script and moves through it.
 * A passing surface audit over a screen that cannot complete its own task is exactly the false PASS §04
 * forbids, so this probe clicks through the real product against the production build.
 *
 * Failures are injected with request interception, not by breaking the server: one request is aborted,
 * the learner presses Retry, and the next attempt is allowed through. That is the only way to observe
 * the §02 retry contract from the outside, and it is the difference between "a Retry button exists" and
 * "pressing it recovers".
 *
 * Topic pagination needs more topics than the seeded bank holds, so a synthetic corpus is inserted,
 * walked in the browser, and deleted afterwards — asserted, not assumed.
 *
 * Recording with a REAL microphone is not possible here and is not claimed. Where the recorder is
 * exercised it runs against Chromium's fake media device and is labelled as such.
 *
 * Usage: DATABASE_URL=... BASE_URL=http://127.0.0.1:3000 node scripts/verify-speaking-journeys.mjs
 */
import pg from "pg";
import { launchBrowser, createSession, auditPage, auditKeyboard, VIEWPORTS } from "./lib/browser-qa.mjs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("refusing to run: DATABASE_URL must point at a LOCAL disposable database");
  process.exit(2);
}
const STUDENT = ["demo.student@learnersarea.uz", "Student12345!"];
const MARKER = "QA-JOURNEY-";
/*
 * The server matches a topic by its NORMALIZED key (lower(btrim(topic))), so a deep link must carry the
 * lowercase form. The first draft passed the raw marker and every topic deep link silently resolved to
 * nothing — three rows failed for that reason alone, which is a probe bug, not a product defect.
 */
const topicKey = (suffix) => `${MARKER}${suffix}`.toLowerCase();
/** More topics than SPEAKING_TOPIC_PAGE (500), so continuation is genuinely reachable in the browser. */
const TOPICS = 520;

const client = new pg.Client({ connectionString: DATABASE_URL });
client.on("error", () => {});
await client.connect();

const rows = [];
let failures = 0;
const row = (id, action, actual, verdict, evidence = "") => {
  rows.push({ id, action, actual, verdict, evidence });
  const mark = verdict === "PASS" ? "  ok" : verdict === "SKIP" ? "skip" : "FAIL";
  if (verdict === "FAIL") failures += 1;
  console.log(`${mark} [${id}] ${action} (${verdict})\n        actual: ${actual}${evidence ? `\n        note:   ${evidence}` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Abort exactly one request whose URL matches, then let everything through. */
async function armFailure(page, urlFragment) {
  const state = { aborted: 0, seen: 0 };
  await page.setRequestInterception(true);
  const handler = (request) => {
    const url = request.url();
    if (url.includes(urlFragment)) {
      state.seen += 1;
      if (state.aborted === 0) {
        state.aborted += 1;
        return request.abort("failed").catch(() => {});
      }
    }
    return request.continue().catch(() => {});
  };
  page.on("request", handler);
  return {
    state,
    async disarm() {
      page.off("request", handler);
      await page.setRequestInterception(false).catch(() => {});
    },
  };
}

const text = (page, selector) => page.$eval(selector, (element) => element.textContent?.trim() ?? "").catch(() => null);
const exists = (page, selector) => page.$(selector).then((handle) => handle !== null);

try {
  // ── synthetic corpus: 520 single-question Part 1 topics, plus one long topic for question paging ─
  await client.query("delete from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);
  await client.query(`
    insert into speaking_prompts (part, category, prompt_text, topic, available_in)
    select 'part1'::speaking_part,'part1'::speaking_category,
           '${MARKER}' || lpad(i::text,4,'0') || ' — a synthetic Part 1 question',
           '${MARKER}T' || lpad(i::text,4,'0'),
           '["practice_alone","ai","live_partner"]'::jsonb
    from generate_series(1, ${TOPICS}) i
  `);
  // One topic holding more than SPEAKING_PROMPT_PAGE (100) questions, so question pagination is real.
  await client.query(`
    insert into speaking_prompts (part, category, prompt_text, topic, available_in)
    select 'part1'::speaking_part,'part1'::speaking_category,
           '${MARKER}LONG ' || lpad(i::text,4,'0') || ' — a question in one very long topic',
           '${MARKER}LONG',
           '["practice_alone","ai","live_partner"]'::jsonb
    from generate_series(1, 120) i
  `);
  const inserted = await client.query("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);
  row("J0-fixture", "a synthetic corpus large enough to exercise both paginations exists",
    `${inserted.rows[0].n} rows across ${TOPICS} single-question topics plus one 120-question topic`,
    inserted.rows[0].n === TOPICS + 120 ? "PASS" : "FAIL");

  const browser = await launchBrowser();

  // ══ J1 — Part → Topic → Question, the core journey ════════════════════════════════════════════
  {
    const session = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 1440, locale: "en" });
    const page = session.page;
    await page.goto(`${BASE}/app/speaking/practice`, { waitUntil: "networkidle2" });
    await wait(700);
    const sawParts = await exists(page, "[data-practice-parts]");
    const partCount = await text(page, '[data-practice-part-count="part1"]');
    await page.click('[data-practice-part="part1"]');
    await wait(1200);
    const stepAfterPart = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    const topicsShown = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => 0);
    const urlAfterPart = new URL(page.url()).searchParams.get("part");
    await page.click("[data-practice-topic]");
    await wait(1500);
    const stepAfterTopic = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    const questions = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
    const urlTopic = new URL(page.url()).searchParams.get("topic");
    const recorder = await page.$$eval("[data-local-recorder]", (els) => els.length).catch(() => 0);
    row("J1-journey", "Part → Topic → Question completes by clicking, and the URL tracks each step",
      `parts=${sawParts} part1count="${partCount}" → step=${stepAfterPart} topics=${topicsShown} ?part=${urlAfterPart}` +
      ` → step=${stepAfterTopic} questions=${questions} ?topic=${urlTopic} recorders=${recorder}`,
      sawParts && stepAfterPart === "topic" && topicsShown > 0 && urlAfterPart === "part1" &&
      stepAfterTopic === "questions" && questions > 0 && Boolean(urlTopic) && recorder > 0 ? "PASS" : "FAIL");

    // ══ J2 — the aria-live status region announces each step (WCAG 4.1.3) ══════════════════════
    const statusText = await text(page, "[data-practice-status]");
    const isLive = await page.$eval("[data-practice-status]", (el) =>
      el.getAttribute("aria-live") ?? el.closest("[aria-live]")?.getAttribute("aria-live") ?? "").catch(() => "");
    row("J2-status", "the status region is an aria-live region and describes the current step",
      `aria-live="${isLive}" text="${(statusText ?? "").slice(0, 90)}"`,
      isLive === "polite" && Boolean(statusText && statusText.length > 0) ? "PASS" : "FAIL");

    // ══ J3 — topic pagination reaches topic 501+ ═══════════════════════════════════════════════
    await page.goto(`${BASE}/app/speaking/practice?part=part1`, { waitUntil: "networkidle2" });
    await wait(1200);
    const firstPage = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => 0);
    const totalText = await text(page, "[data-practice-more-topics]");
    let clicks = 0;
    let reached = firstPage;
    while (clicks < 4 && await exists(page, "[data-practice-more-topics]")) {
      const before = reached;
      await page.click("[data-practice-more-topics]");
      await wait(1400);
      reached = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => before);
      clicks += 1;
      if (reached === before) break;
    }
    const distinct = await page.$$eval("[data-practice-topic]", (els) =>
      new Set(els.map((el) => el.getAttribute("data-practice-topic"))).size).catch(() => 0);
    row("J3-topic-paging", `topic discovery continues past the 500-row page bound (${clicks} continuation click(s))`,
      `first page=${firstPage} → after=${reached} distinct=${distinct} control="${(totalText ?? "").slice(0, 40)}"`,
      firstPage > 0 && reached > firstPage && distinct === reached ? "PASS" : "FAIL");

    // ══ J4 — question pagination inside one long topic ══════════════════════════════════════════
    await page.goto(`${BASE}/app/speaking/practice?part=part1&topic=${encodeURIComponent(topicKey("long"))}`, { waitUntil: "networkidle2" });
    await wait(1600);
    const qFirst = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
    const moreLabel = await text(page, "[data-practice-more-questions]");
    let qAfter = qFirst;
    if (await exists(page, "[data-practice-more-questions]")) {
      await page.click("[data-practice-more-questions]");
      await wait(1500);
      qAfter = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => qFirst);
    }
    const qDistinct = await page.$$eval("[data-practice-question]", (els) =>
      new Set(els.map((el) => el.getAttribute("data-practice-question"))).size).catch(() => 0);
    row("J4-question-paging", "a 120-question topic pages at 100 and continues without duplicates",
      `first page=${qFirst} → after=${qAfter} distinct=${qDistinct} control="${(moreLabel ?? "").slice(0, 44)}"`,
      qFirst > 0 && qFirst <= 100 && qAfter > qFirst && qDistinct === qAfter ? "PASS" : "FAIL");

    // ══ J5 — search and the no-results state ════════════════════════════════════════════════════
    await page.goto(`${BASE}/app/speaking/practice?part=part1`, { waitUntil: "networkidle2" });
    await wait(1000);
    await page.type("[data-practice-search]", `${MARKER}T0007`);
    await wait(1400);
    const hits = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => 0);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }, "[data-practice-search]");
    await wait(400);
    await page.type("[data-practice-search]", "zzz-no-such-topic-xyz");
    await wait(1400);
    const emptyText = await text(page, '[data-practice-empty="topics"]');
    const emptyHits = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => -1);
    row("J5-search", "server-side search narrows the list, and a search with no match says so",
      `match=${hits} topic(s); no-match message="${(emptyText ?? "").slice(0, 40)}" topics=${emptyHits}`,
      hits > 0 && hits < 20 && Boolean(emptyText) && emptyHits === 0 ? "PASS" : "FAIL");

    // ══ J6 — deep link, reload persistence, Back/Forward ════════════════════════════════════════
    const deep = `${BASE}/app/speaking/practice?part=part1&topic=${encodeURIComponent(topicKey("t0003"))}`;
    await page.goto(deep, { waitUntil: "networkidle2" });
    await wait(1600);
    const deepStep = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    const deepQuestions = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
    await page.reload({ waitUntil: "networkidle2" });
    await wait(1600);
    const reloadStep = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    const reloadQuestions = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
    await page.goBack({ waitUntil: "networkidle2" });
    await wait(1400);
    const backStep = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    await page.goForward({ waitUntil: "networkidle2" });
    await wait(1400);
    const forwardStep = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    row("J6-deeplink", "a direct ?part=&topic= URL opens the question step, survives reload, and Back/Forward navigate the steps",
      `deep=${deepStep}/${deepQuestions}q reload=${reloadStep}/${reloadQuestions}q back=${backStep} forward=${forwardStep}`,
      deepStep === "questions" && deepQuestions > 0 && reloadStep === "questions" && reloadQuestions > 0 &&
      backStep !== null && forwardStep === "questions" ? "PASS" : "FAIL");

    // ══ J7 — breadcrumb returns to the topic list without a server navigation ═══════════════════
    const crumb = await exists(page, '[data-practice-crumb="topic"]');
    if (crumb) {
      await page.click('[data-practice-crumb="topic"]');
      await wait(1400);
    }
    const crumbStep = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    row("J7-breadcrumb", "the breadcrumb walks back from Question to Topic",
      `crumb present=${crumb} step after=${crumbStep}`,
      crumb && crumbStep === "topic" ? "PASS" : "FAIL");

    /*
     * ══ J8 — Study Support loads only for the selected question ══════════════════════════════════
     * The listener must be attached BEFORE navigation: the first draft attached it after the page had
     * already fetched, counted zero requests, and reported a failure that was purely a probe artefact.
     *
     * The topic used is the 120-question one (100 listed after paging) precisely so the count is
     * meaningful: prefetching the bank would fire ~100 support requests here, while on-demand loading
     * fires exactly one per selection.
     */
    const supportRequests = [];
    const supportListener = (request) => { if (request.url().includes("/support")) supportRequests.push(request.url()); };
    page.on("request", supportListener);
    await page.goto(`${BASE}/app/speaking/practice?part=part1&topic=${encodeURIComponent(topicKey("long"))}`, { waitUntil: "networkidle2" });
    await wait(2200);
    const listedAfterLoad = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
    const afterLoad = supportRequests.length;
    const selectedFirst = await text(page, "[data-practice-selected]");
    const secondId = await page.$$eval("[data-practice-question]", (els) => els[1]?.getAttribute("data-practice-question") ?? null).catch(() => null);
    if (secondId) { await page.click(`[data-practice-question="${secondId}"]`); await wait(2000); }
    const afterSelect = supportRequests.length;
    const selectedSecond = await text(page, "[data-practice-selected]");
    const secondUrlMatches = supportRequests[supportRequests.length - 1]?.includes(secondId ?? "\u0000") ?? false;
    const supportState = await page.$eval("[data-practice-support]", (el) => el.getAttribute("data-practice-support")).catch(() => "panel");
    page.off("request", supportListener);
    row("J8-study-support", "study support is fetched on demand for the SELECTED question, never prefetched for the listed page",
      `${listedAfterLoad} questions listed; support requests after load=${afterLoad}, after selecting a second=${afterSelect}; ` +
      `second request targets the newly selected id=${secondUrlMatches}; selected="${(selectedFirst ?? "").slice(0, 26)}" → "${(selectedSecond ?? "").slice(0, 26)}"; state=${supportState}`,
      listedAfterLoad > 1 && afterLoad === 1 && afterSelect === 2 && secondUrlMatches && selectedFirst !== selectedSecond ? "PASS" : "FAIL");

    // ══ J9 — §02 topics failure then Retry recovers, in a real browser ══════════════════════════
    {
      /*
       * Both the part-count request and the topic-discovery request hit /facets, so matching the bare path
       * aborted the PARTS call and produced data-practice-error="parts" instead of "topics". The topics
       * call is the one carrying part=, which is what must be aborted here.
       */
      const armed = await armFailure(page, "/api/speaking/practice/facets?channel=practice_alone&part=");
      await page.goto(`${BASE}/app/speaking/practice?part=part1`, { waitUntil: "domcontentloaded" });
      await wait(2000);
      const sawError = await exists(page, '[data-practice-error="topics"]');
      const sawRetry = await exists(page, '[data-practice-retry="topics"]');
      if (sawRetry) { await page.click('[data-practice-retry="topics"]'); await wait(2000); }
      const recovered = await page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => 0);
      const errorGone = !(await exists(page, '[data-practice-error="topics"]'));
      await armed.disarm();
      row("J9-retry-topics", "§02 an aborted topic request shows an error and its Retry button recovers it",
        `aborted=${armed.state.aborted} error=${sawError} retryButton=${sawRetry} → topics=${recovered} errorCleared=${errorGone}`,
        armed.state.aborted === 1 && sawError && sawRetry && recovered > 0 && errorGone ? "PASS" : "FAIL");
    }

    // ══ J10 — §02 first-page questions failure stays on the topic and recovers ══════════════════
    {
      const armed = await armFailure(page, "/api/speaking/practice/questions");
      await page.goto(`${BASE}/app/speaking/practice?part=part1&topic=${encodeURIComponent(topicKey("t0005"))}`, { waitUntil: "domcontentloaded" });
      await wait(2000);
      const stepOnFailure = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
      const sawError = await exists(page, '[data-practice-error="questions"]');
      const sawRetry = await exists(page, '[data-practice-retry="questions"]');
      if (sawRetry) { await page.click('[data-practice-retry="questions"]'); await wait(2000); }
      const recovered = await page.$$eval("[data-practice-question]", (els) => els.length).catch(() => 0);
      await armed.disarm();
      row("J10-retry-questions", "§02 an aborted question page keeps the learner in the topic and Retry recovers it",
        `aborted=${armed.state.aborted} stepOnFailure=${stepOnFailure} error=${sawError} retry=${sawRetry} → questions=${recovered}`,
        armed.state.aborted === 1 && stepOnFailure === "questions" && sawError && sawRetry && recovered > 0 ? "PASS" : "FAIL");
    }

    // ══ J11 — keyboard access across the journey ════════════════════════════════════════════════
    await page.goto(`${BASE}/app/speaking/practice`, { waitUntil: "networkidle2" });
    await wait(1200);
    const stops = await auditKeyboard(page, { tabs: 10 });
    const reachable = stops.filter((stop) => stop.tag || stop.role).length;
    const partByKeyboard = await page.evaluate(() => {
      const target = document.querySelector('[data-practice-part="part1"]');
      target?.focus();
      return document.activeElement?.getAttribute?.("data-practice-part") ?? null;
    });
    await page.keyboard.press("Enter");
    await wait(1500);
    const stepAfterEnter = await page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
    row("J11-keyboard", "the journey is operable by keyboard alone: parts are focusable and Enter activates one",
      `tab stops=${stops.length} focusable=${reachable} focusedPart=${partByKeyboard} → step=${stepAfterEnter}`,
      partByKeyboard === "part1" && stepAfterEnter === "topic" ? "PASS" : "FAIL");

    // ══ J12 — responsive + no horizontal overflow on the speaking surfaces ══════════════════════
    const overflow = [];
    for (const key of [320, 390, 768, 1024, 1440]) {
      const mobile = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: key, locale: "en" });
      await mobile.page.goto(`${BASE}/app/speaking/practice?part=part1`, { waitUntil: "networkidle2" });
      await wait(900);
      const audit = await auditPage(mobile.page);
      overflow.push(`${key}:${audit.overflowPx ?? 0}px`);
      if ((audit.overflowPx ?? 0) > 0) failures += 0; // recorded below
      await mobile.close?.().catch?.(() => {});
    }
    row("J12-responsive", "no horizontal overflow at 320/390/768/1024/1440 on the practice surface",
      overflow.join(" "), overflow.every((entry) => entry.endsWith(":0px")) ? "PASS" : "FAIL");

    // ══ J13 — UZ locale renders the same journey ════════════════════════════════════════════════
    {
      const uz = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 390, locale: "uz" });
      await uz.page.goto(`${BASE}/app/speaking/practice`, { waitUntil: "networkidle2" });
      await wait(1000);
      const uzPart = await text(uz.page, '[data-practice-part="part1"]');
      await uz.page.click('[data-practice-part="part1"]');
      await wait(1400);
      const uzStep = await uz.page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step")).catch(() => null);
      const uzTopics = await uz.page.$$eval("[data-practice-topic]", (els) => els.length).catch(() => 0);
      const latin = (uzPart ?? "").length > 0 && !/[а-яА-Я]/.test(uzPart ?? "");
      row("J13-uz", "the UZ locale completes Part → Topic at 390px and renders Uzbek, not English or Cyrillic",
        `part label="${(uzPart ?? "").replace(/\s+/g, " ").slice(0, 46)}" step=${uzStep} topics=${uzTopics}`,
        latin && uzStep === "topic" && uzTopics > 0 ? "PASS" : "FAIL");
      await uz.close?.().catch?.(() => {});
    }

    await session.close?.().catch?.(() => {});
  }

  // ══ J14–J17 — Speaking Practice with AI ═══════════════════════════════════════════════════════
  {
    const session = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 1440, locale: "en" });
    const page = session.page;
    await page.goto(`${BASE}/app/speaking/ai`, { waitUntil: "networkidle2" });
    await wait(1200);
    const readiness = await page.$eval("[data-ai-readiness]", (el) => el.getAttribute("data-ai-readiness")).catch(() => null);
    const modes = await page.$$eval("[data-ai-mode]", (els) => els.map((el) => el.getAttribute("data-ai-mode"))).catch(() => []);
    row("J14-ai-modes", "all four AI modes are offered",
      `readiness=${readiness} modes=[${modes.join(",")}]`,
      ["full", "part1", "part2", "part3"].every((mode) => modes.includes(mode)) ? "PASS" : "FAIL");

    // The script is drawn server-side; no request may carry the bank.
    const scriptCalls = [];
    const heavyCalls = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/speaking/ai/script")) scriptCalls.push(url);
      if (url.includes("/api/speaking/practice/questions") || url.includes("/api/speaking/practice/facets")) heavyCalls.push(url);
    });
    await page.click('[data-ai-mode="full"]');
    await wait(2500);
    const aiState = await page.$eval("[data-ai-session]", (el) => el.getAttribute("data-ai-session")).catch(() => null);
    const progress = await text(page, "[data-ai-progress]");
    const recorder = await exists(page, "[data-question-recorder]");
    row("J15-ai-interview", "starting a full interview draws a server-side script and reaches the first question",
      `script calls=${scriptCalls.length} discovery calls=${heavyCalls.length} state=${aiState} progress="${(progress ?? "").slice(0, 46)}" recorder=${recorder}`,
      scriptCalls.length === 1 && heavyCalls.length === 0 && aiState === "running" && Boolean(progress) && recorder ? "PASS" : "FAIL");

    // Move to the next question: the session must advance without a new draw.
    if (await exists(page, "[data-ai-next]")) {
      await page.click("[data-ai-next]");
      await wait(1500);
    }
    const afterNext = await text(page, "[data-ai-progress]");
    row("J16-ai-transition", "the examiner advances to the next question without redrawing the script",
      `progress before="${(progress ?? "").slice(0, 30)}" after="${(afterNext ?? "").slice(0, 30)}" script calls=${scriptCalls.length}`,
      afterNext !== progress && scriptCalls.length === 1 ? "PASS" : "FAIL");

    // End the session and confirm it is a local action.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((el) => /end session/i.test(el.textContent ?? ""));
      button?.click();
    });
    await wait(1200);
    const afterEnd = await page.$eval("[data-ai-session]", (el) => el.getAttribute("data-ai-session")).catch(() => null);
    row("J17-ai-end", "ending the session returns to the mode grid locally, with no further network draw",
      `state=${afterEnd} script calls=${scriptCalls.length}`,
      afterEnd === "choose" && scriptCalls.length === 1 ? "PASS" : "FAIL");

    // ══ J18 — §02 AI script failure then Retry recovers ═════════════════════════════════════════
    {
      const armed = await armFailure(page, "/api/speaking/ai/script");
      await page.click('[data-ai-mode="part2"]');
      await wait(2200);
      const sawError = await exists(page, "[data-ai-error]");
      const sawRetry = await exists(page, "[data-ai-retry]");
      if (sawRetry) { await page.click("[data-ai-retry]"); await wait(2500); }
      const state = await page.$eval("[data-ai-session]", (el) => el.getAttribute("data-ai-session")).catch(() => null);
      const progress2 = await text(page, "[data-ai-progress]");
      await armed.disarm();
      row("J18-ai-retry", "§02 an aborted script draw shows an error and its Retry button starts the interview",
        `aborted=${armed.state.aborted} error=${sawError} retry=${sawRetry} → state=${state} progress="${(progress2 ?? "").slice(0, 40)}"`,
        armed.state.aborted === 1 && sawError && sawRetry && state === "running" && Boolean(progress2) ? "PASS" : "FAIL");
    }
    await session.close?.().catch?.(() => {});
  }

  // ══ J19 — recording cannot be exercised without media hardware ════════════════════════════════
  row("J19-recording", "prepare/answer timers and microphone capture with real audio",
    "CHROMIUM_ARGS deliberately carries no --use-fake-device-for-media-stream, and no real microphone " +
    "exists in this environment; the recorder element and its per-question mount were verified (J1/J15) " +
    "but capture, upload and evaluation were not exercised",
    "SKIP", "EXTERNAL_ACCEPTANCE_REQUIRED: real microphone hardware");

  await browser.close().catch(() => {});
} finally {
  const removed = await client.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]);
  const left = await client.query("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);
  const total = await client.query("select count(*)::int n from speaking_prompts");
  console.log(`# cleanup: deleted ${removed.rows.length} synthetic prompt(s); ${left.rows[0].n} remain; speaking_prompts total=${total.rows[0].n}`);
  if (left.rows[0].n !== 0) { failures += 1; rows.push({ id: "J-cleanup", action: "synthetic corpus removed", actual: `${left.rows[0].n} rows remain`, verdict: "FAIL", evidence: "" }); }
  await client.end().catch(() => {});
}

const pass = rows.filter((r) => r.verdict === "PASS").length;
const skip = rows.filter((r) => r.verdict === "SKIP").length;
console.log(`\n| id | action | actual | verdict |`);
console.log(`| --- | --- | --- | --- |`);
for (const r of rows) console.log(`| ${r.id} | ${r.action} | ${r.actual} | **${r.verdict}** |`);
console.log(`\n# §04 speaking journeys: ${pass} PASS / ${failures} FAIL / ${skip} SKIP of ${rows.length} rows`);
console.log(`# SKIP IS NOT PASS — ${skip} row(s) require hardware this environment does not have.`);
process.exit(failures === 0 ? 0 : 1);
