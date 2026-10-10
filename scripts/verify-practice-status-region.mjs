#!/usr/bin/env node
/**
 * Real-Chromium verification of the Speaking Practice status region (WCAG 4.1.3).
 *
 *   node scripts/verify-practice-status-region.mjs [base]
 *
 * The browser matrix measured the defect: /app/speaking/practice does async work, the probe
 * interacted with it, and it had ZERO live regions before and after. Every step change in
 * PracticeStudio replaces the whole content region through history.pushState, and the topic list
 * re-filters per keystroke — no server navigation, no focus movement, so nothing was announced.
 *
 * What makes this more than "an element now exists": the announced text is cross-checked against
 * what is actually rendered at each step. A status region that says "12 topics" while nine are on
 * screen is worse than none, because it is confidently wrong. So the count in the announcement must
 * equal the number of topic buttons in the DOM, and the question count must equal the number of
 * rendered questions. It is also checked in Uzbek, since an announcement is only useful in the
 * language the learner is actually using, and the region must be visually hidden so the protected
 * design is untouched.
 */
const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const browser = await launchBrowser();
const statusOf = async (page) =>
  page.$eval("[data-practice-status]", (el) => ({
    text: el.textContent?.trim() ?? "",
    role: el.getAttribute("role"),
    live: el.getAttribute("aria-live"),
    // A visually hidden region must not occupy layout: sr-only clips to a 1px box.
    box: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  })).catch(() => null);

try {
  /* ------------------------------------------------------------- ENGLISH */
  const en = await createSession(browser, {
    base: BASE, email: "demo.student@learnersarea.uz", password: "Student12345!",
    viewport: 390, locale: "en",
  });
  await en.goto("/app/speaking/practice");
  await en.page.waitForSelector("[data-practice-step]", { timeout: 20000 });

  const atRest = await statusOf(en.page);
  check("at rest the page carries a polite status region",
    atRest?.role === "status" && atRest?.live === "polite",
    atRest ? `role=${atRest.role} aria-live=${atRest.live} text="${atRest.text}"` : "no [data-practice-status] in the DOM");
  check("at rest it announces the first step rather than staying empty",
    Boolean(atRest?.text) && /choose a part/i.test(atRest.text ?? ""),
    `"${atRest?.text ?? ""}"`);
  check("the region is visually hidden, so the protected layout is unchanged",
    atRest !== null && atRest.box.w <= 1 && atRest.box.h <= 1,
    atRest ? `rendered box ${atRest.box.w}×${atRest.box.h}px` : "not rendered");
  const liveRegions = await en.page.$$eval("[aria-live], [role=status]", (els) => els.length);
  check("the surface now reports at least one live region to the matrix's own measurement",
    liveRegions >= 1, `${liveRegions} live region(s) at rest (was 0)`);

  // Step 1 -> 2: choose a part.
  const partHandle = await en.page.$("[data-practice-part]");
  const partName = await en.page.$eval("[data-practice-part]", (el) => el.textContent ?? "");
  await partHandle.click();
  await en.page.waitForSelector("[data-practice-step='topic'], [data-practice-topics]", { timeout: 20000 });
  const afterPart = await statusOf(en.page);
  const stepNow = await en.page.$eval("[data-practice-step]", (el) => el.getAttribute("data-practice-step"));
  check("choosing a part changes the step AND announces the new one",
    stepNow === "topic" && Boolean(afterPart?.text) && afterPart.text !== atRest?.text,
    `step=${stepNow}; announcement moved from "${atRest?.text}" to "${afterPart?.text}"`);

  // The announced topic count must equal the topics actually rendered.
  const topicButtons = await en.page.$$eval("[data-practice-topic]", (els) => els.length);
  const announcedTopics = Number(/(\d+)\s+topics?/.exec(afterPart?.text ?? "")?.[1] ?? NaN);
  check("the announced topic count equals the number of topics rendered",
    Number.isFinite(announcedTopics) && announcedTopics === topicButtons,
    `announced ${announcedTopics}, DOM holds ${topicButtons} topic button(s)`);

  // Filtering must update the announcement, and stay truthful.
  const search = await en.page.$("input[aria-label]");
  if (search && topicButtons > 0) {
    const firstTitle = await en.page.$eval("[data-practice-topic]", (el) => (el.textContent ?? "").trim().split(/\d+/)[0].trim());
    const probe = firstTitle.slice(0, Math.min(4, firstTitle.length));
    await search.click();
    await search.type(probe, { delay: 25 });
    await new Promise((r) => setTimeout(r, 350));
    const filteredButtons = await en.page.$$eval("[data-practice-topic]", (els) => els.length);
    const afterFilter = await statusOf(en.page);
    const announcedFiltered = Number(/(\d+)\s+topics?/.exec(afterFilter?.text ?? "")?.[1] ?? NaN);
    check("filtering topics updates the announcement and it still matches the DOM",
      Number.isFinite(announcedFiltered) && announcedFiltered === filteredButtons && filteredButtons <= topicButtons,
      `typed "${probe}": announced ${announcedFiltered}, rendered ${filteredButtons} of ${topicButtons}`);
    await en.page.$eval("input[aria-label]", (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await new Promise((r) => setTimeout(r, 250));
  } else {
    check("filtering topics updates the announcement and it still matches the DOM", false,
      topicButtons === 0 ? "no topic buttons rendered, so filtering could not be exercised" : "no search input found");
  }

  // Step 2 -> 3: open a topic, and cross-check the question count.
  const topicTitle = await en.page.$eval("[data-practice-topic]", (el) => (el.textContent ?? "").trim());
  await (await en.page.$("[data-practice-topic]")).click();
  await en.page.waitForSelector("[data-practice-questions]", { timeout: 20000 });
  const afterTopic = await statusOf(en.page);
  const renderedQuestions = await en.page.$$eval("[data-practice-questions] ol > li", (els) => els.length);
  const announcedQuestions = Number(/(\d+)\s+questions?/.exec(afterTopic?.text ?? "")?.[1] ?? NaN);
  check("opening a topic announces it, and the question count matches the rendered list",
    Number.isFinite(announcedQuestions) && announcedQuestions === renderedQuestions && renderedQuestions > 0,
    `announced "${afterTopic?.text}"; rendered ${renderedQuestions} question(s); topic button read "${topicTitle.slice(0, 40)}"`);
  check("no console errors were produced while navigating the steps",
    en.consoleErrors.length === 0,
    en.consoleErrors.length ? en.consoleErrors.slice(0, 3).join(" | ") : "0 errors");
  await en.close();

  /* --------------------------------------------------------------- UZBEK */
  const uz = await createSession(browser, {
    base: BASE, email: "demo.student@learnersarea.uz", password: "Student12345!",
    viewport: 390, locale: "uz",
  });
  await uz.goto("/app/speaking/practice");
  await uz.page.waitForSelector("[data-practice-status]", { timeout: 20000 });
  const uzRest = await statusOf(uz.page);
  check("in Uzbek the region announces the Uzbek string, not the English one",
    Boolean(uzRest?.text) && /qismni tanlang/i.test(uzRest.text) && !/choose a part/i.test(uzRest.text),
    `"${uzRest?.text ?? ""}"`);
  await (await uz.page.$("[data-practice-part]")).click();
  await uz.page.waitForSelector("[data-practice-step='topic'], [data-practice-topics]", { timeout: 20000 });
  const uzTopic = await statusOf(uz.page);
  const uzButtons = await uz.page.$$eval("[data-practice-topic]", (els) => els.length);
  const uzAnnounced = Number(/(\d+)\s+ta\s+mavzu/.exec(uzTopic?.text ?? "")?.[1] ?? NaN);
  check("and the Uzbek topic count is rendered in Uzbek and still equals the DOM",
    Number.isFinite(uzAnnounced) && uzAnnounced === uzButtons,
    `announced "${uzTopic?.text}" (${uzAnnounced}); rendered ${uzButtons}`);
  await uz.close();
} catch (error) {
  console.error("\nABORTED:", error?.message ?? error);
  failures.push("aborted");
} finally {
  await browser.close().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
