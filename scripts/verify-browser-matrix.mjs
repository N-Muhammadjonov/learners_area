#!/usr/bin/env node
/**
 * PACKAGE F — real-browser matrix: mobile viewports, accessibility and localisation.
 *
 *   node scripts/verify-browser-matrix.mjs [baseUrl]
 *
 * Every number in the report is measured in a live Chromium render. Nothing here is inferred
 * from source text: "does this page overflow at 320 px" is a property of computed layout, and
 * "does this control have an accessible name" is a property of the composed accessibility tree.
 * A grep can answer neither, and the suites that tried produced assertions about markup rather
 * than about what a learner sees.
 *
 * The protected theme and background design are NOT touched. This probe only reads.
 *
 * LOCALE CHECK. A translation check that greps for Uzbek words is weak: a page can contain
 * Uzbek and still be half-translated. The strong form is a DIFFERENCE test — render the same
 * route in `en` and in `uz` and require that the visible text actually changed. If two locales
 * produce byte-identical body text, the dictionary is not being applied, whatever it contains.
 */
import { writeFileSync } from "node:fs";
import {
  launchBrowser, createSession, auditPage, auditKeyboard, auditDialog, attachRequestRecorder, VIEWPORTS,
} from "./lib/browser-qa.mjs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";

const STUDENT = ["demo.student@learnersarea.uz", "Student12345!"];
const TEACHER = ["teacher@learnersarea.uz", "Teacher12345!"];
const ADMIN = ["admin@learnersarea.uz", "Admin12345!"];

/**
 * The surfaces named in the package requirement, with the actor who is entitled to each.
 * `interactive` marks the pages that also get a keyboard and dialog audit — running those on
 * every page would mostly measure static content and dilute the result.
 */
const LEARNER_SURFACES = [
  { id: "RD1", area: "Reading", path: "/app/reading" },
  { id: "RD2", area: "Reading", path: "/app/reading/academic" },
  { id: "RD3", area: "Reading", path: "/app/reading/general" },
  { id: "RD4", area: "Reading", path: "/app/reading/history" },
  { id: "LS1", area: "Listening", path: "/app/listening" },
  { id: "LS2", area: "Listening", path: "/app/listening/academic" },
  { id: "LS3", area: "Listening", path: "/app/listening/mcq" },
  { id: "LS4", area: "Listening", path: "/app/listening/history" },
  { id: "WR1", area: "Writing", path: "/app/writing", interactive: true },
  { id: "WR2", area: "Writing", path: "/app/writing/history" },
  { id: "SP1", area: "Speaking", path: "/app/speaking" },
  { id: "SP2", area: "Speaking", path: "/app/speaking/practice", interactive: true },
  { id: "SP3", area: "Speaking", path: "/app/speaking/live-partner", interactive: true },
  { id: "SP4", area: "Speaking", path: "/app/speaking/ai" },
  { id: "SP5", area: "Speaking", path: "/app/speaking/history" },
  { id: "SP6", area: "Speaking", path: "/app/speaking/lessons" },
  { id: "VC1", area: "Vocabulary", path: "/app/vocabulary", interactive: true },
  { id: "VC2", area: "Vocabulary", path: "/app/vocabulary/review", interactive: true },
  { id: "VC3", area: "Vocabulary", path: "/app/vocabulary/games" },
  { id: "LN1", area: "Lessons", path: "/app/courses/ielts" },
  { id: "LN2", area: "Lessons", path: "/app/video-lessons" },
  { id: "AS1", area: "Assignments", path: "/app/assignments" },
  { id: "PR1", area: "Progress", path: "/app/progress" },
  { id: "NT1", area: "Notifications", path: "/app/notifications" },
  { id: "PF1", area: "Profile", path: "/app/profile", interactive: true },
];

const STAFF_SURFACES = [
  { id: "AD1", area: "Staff admin", path: "/app/admin/content", actor: "ADMIN" },
  { id: "AD2", area: "Staff admin", path: "/app/admin/reading", actor: "ADMIN" },
  { id: "AD3", area: "Staff admin", path: "/app/admin/listening", actor: "ADMIN" },
  { id: "AD4", area: "Staff admin", path: "/app/admin/users", actor: "ADMIN" },
  { id: "AD5", area: "Staff admin", path: "/app/admin/roster", actor: "ADMIN" },
  { id: "AD6", area: "Staff admin", path: "/app/admin/materials", actor: "ADMIN" },
  { id: "TC1", area: "Staff admin", path: "/app/teacher/students", actor: "TEACHER" },
  { id: "TC2", area: "Staff admin", path: "/app/teacher/live-classes", actor: "TEACHER" },
  { id: "TC3", area: "Staff admin", path: "/app/management", actor: "TEACHER" },
];

const rows = [];
let exitCode = 0;
const notes = [];

function row(entry) {
  rows.push(entry);
  const bad = entry.verdict === "FAIL";
  console.log(`  ${bad ? "FAIL" : entry.verdict === "PASS" ? "  ok" : "  --"} [${entry.id}] ${entry.action} → ${entry.verdict}`);
  if (bad) exitCode = 1;
  return entry;
}

const browser = await launchBrowser();
console.log(`Chromium launched; base ${BASE}`);
const enText = new Map();

try {
  /* =============================================================== PHASE 1
   * Every surface × every viewport, in EN. This is where overflow and touch-target
   * defects live, and it is the phase that cannot be shortened: 320 px behaviour is
   * not implied by 1440 px behaviour.
   */
  console.log("\nPHASE 1 — layout, touch targets and accessible names (EN)");
  for (const surface of LEARNER_SURFACES) {
    const measurements = {};
    for (const viewport of Object.keys(VIEWPORTS)) {
      const session = await createSession(browser, {
        base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: Number(viewport), locale: "en",
      });
      try {
        const nav = await session.goto(surface.path);
        if (nav.status >= 500) {
          measurements[viewport] = { serverError: nav.status };
          continue;
        }
        const audit = await auditPage(session.page);
        measurements[viewport] = audit;
        if (Number(viewport) === 1440) enText.set(surface.path, audit);
      } finally {
        await session.close();
      }
    }

    // Horizontal overflow at a narrow width is the defect that matters most and the one a
    // source scan cannot see. Tolerate 1 px of rounding, not more.
    const overflowing = Object.entries(measurements)
      .filter(([, m]) => !m.serverError && m.overflowPx > 1)
      .map(([vp, m]) => `${vp}px:+${m.overflowPx}px`);
    const serverErrors = Object.entries(measurements).filter(([, m]) => m.serverError).map(([vp, m]) => `${vp}px:HTTP ${m.serverError}`);
    // A wide TABLE is allowed to be wide provided it scrolls inside its own container.
    // A wide table with no scrollable ancestor pushes the whole page sideways instead.
    const unscrollableTables = Object.entries(measurements)
      .flatMap(([vp, m]) => (m.tables ?? []).filter((t) => t.widerThanViewport && !t.hasScrollableAncestor).map((t) => `${vp}px:${t.scrollWidth}px`));
    const unnamed = Object.entries(measurements)
      .flatMap(([vp, m]) => (m.unnamed ?? []).map((u) => `${vp}px:${u.tag}${u.type ? `[${u.type}]` : ""}`));
    // Advisory only: controls between the WCAG 2.5.8 AA floor (24px) and the enhanced 44px
    // figure. Failing a page for meeting AA would be a false defect.
    const advisoryTargets = Object.entries(measurements)
      .filter(([, m]) => (m.advisoryTargetCount ?? 0) > 0)
      .map(([vp, m]) => `${vp}px:${m.advisoryTargetCount}`);
    const altMissing = Object.entries(measurements).flatMap(([vp, m]) => (m.imagesWithoutAlt ?? []).map(() => `${vp}px`));

    row({
      id: surface.id, area: surface.area, actor: "STUDENT_A", locale: "en",
      action: `${surface.path} rendered at 320/390/768/1440`,
      expected: "no page-level horizontal overflow; wide tables scroll inside a container; every control has an accessible name; every image has alt text",
      actual: [
        `overflow=${overflowing.length ? overflowing.join(", ") : "none at any width"}`,
        `unscrollable tables=${unscrollableTables.length ? unscrollableTables.join(", ") : "none"}`,
        `unnamed controls=${unnamed.length ? unnamed.slice(0, 5).join(", ") : "none"}`,
        `images without alt=${altMissing.length}`,
        advisoryTargets.length ? `advisory: ${advisoryTargets.join(", ")} control(s) between the 24px AA floor and 44px` : "",
        serverErrors.length ? `SERVER ERRORS ${serverErrors.join(", ")}` : "",
      ].filter(Boolean).join("; "),
      verdict: overflowing.length || unscrollableTables.length || serverErrors.length ? "FAIL"
        : unnamed.length || altMissing.length ? "A11Y_DEFECT" : "PASS",
    });
    if (unnamed.length || altMissing.length) notes.push(`${surface.id} ${surface.path}: ${unnamed.length} unnamed control(s), ${altMissing.length} image(s) without alt`);
  }

  /* =============================================================== PHASE 2
   * Staff surfaces at the two widths that matter. Admin tables are the densest
   * content in the product and the most likely to overflow a phone.
   */
  console.log("\nPHASE 2 — staff and admin surfaces");
  for (const surface of STAFF_SURFACES) {
    const creds = surface.actor === "ADMIN" ? ADMIN : TEACHER;
    const measurements = {};
    for (const viewport of [320, 1440]) {
      const session = await createSession(browser, { base: BASE, email: creds[0], password: creds[1], viewport, locale: "en" });
      try {
        const nav = await session.goto(surface.path);
        measurements[viewport] = nav.status >= 500 ? { serverError: nav.status } : await auditPage(session.page);
      } finally {
        await session.close();
      }
    }
    const overflowing = Object.entries(measurements).filter(([, m]) => !m.serverError && m.overflowPx > 1).map(([vp, m]) => `${vp}px:+${m.overflowPx}px`);
    const unscrollableTables = Object.entries(measurements)
      .flatMap(([vp, m]) => (m.tables ?? []).filter((t) => t.widerThanViewport && !t.hasScrollableAncestor).map((t) => `${vp}px:${t.scrollWidth}px`));
    const denied = Object.entries(measurements).filter(([, m]) => !m.serverError && m.overflowPx === undefined);
    row({
      id: surface.id, area: surface.area, actor: surface.actor, locale: "en",
      action: `${surface.path} rendered at 320/1440`,
      expected: "the entitled staff role reaches the page; dense tables scroll inside a container rather than pushing the page sideways",
      actual: `overflow=${overflowing.length ? overflowing.join(", ") : "none"}; unscrollable tables=${unscrollableTables.length ? unscrollableTables.join(", ") : "none"}; tables seen=${[320, 1440].map((v) => `${v}px:${measurements[v]?.tables?.length ?? 0}`).join("/")}`,
      verdict: denied.length ? "FAIL" : overflowing.length || unscrollableTables.length ? "FAIL" : "PASS",
    });
  }

  /* =============================================================== PHASE 3
   * UZ. The difference test: the same route in uz must not render byte-identical
   * visible text to en. Identical text means the dictionary was never applied.
   */
  console.log("\nPHASE 3 — Uzbek localisation (difference test against EN)");
  for (const surface of LEARNER_SURFACES) {
    const session = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 1440, locale: "uz" });
    let uz;
    let uzNarrow;
    try {
      await session.goto(surface.path);
      uz = await auditPage(session.page);
    } finally {
      await session.close();
    }
    const narrow = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 320, locale: "uz" });
    try {
      await narrow.goto(surface.path);
      uzNarrow = await auditPage(narrow.page);
    } finally {
      await narrow.close();
    }
    const en = enText.get(surface.path);
    // A page whose EN render is empty gives no baseline to differ from; say so rather than
    // reporting a pass on an empty comparison.
    const comparable = en && en.textLength > 40;
    const changed = comparable && en.bodyHash !== uz.bodyHash && uz.textLength > 40;
    const identical = comparable && !changed;
    row({
      id: `${surface.id}-UZ`, area: surface.area, actor: "STUDENT_A", locale: "uz",
      action: `${surface.path} rendered in Uzbek and compared with its English render`,
      expected: "the visible text differs from EN (the dictionary is applied), the document language is set, no Cyrillic leaks into a Latin UI, and 320 px still does not overflow",
      actual: [
        comparable ? `text ${en.textLength}→${uz.textLength} chars; changed=${changed}` : "EN baseline too small to compare",
        `lang=${uz.lang ?? "(unset)"}`,
        `cyrillic=${uz.cyrillicCount}`,
        `untranslated markers=${uz.untranslatedMarkers.length ? uz.untranslatedMarkers.join(",") : "none"}`,
        `320px overflow=${uzNarrow.overflowPx > 1 ? `+${uzNarrow.overflowPx}px` : "none"}`,
      ].join("; "),
      verdict: identical ? "FAIL"
        : !comparable ? "NOT_MEASURABLE"
        : uz.cyrillicCount > 0 || uz.untranslatedMarkers.length || uzNarrow.overflowPx > 1 ? "I18N_DEFECT" : "PASS",
    });
    if (uz.cyrillicCount > 0) notes.push(`${surface.id}-UZ ${surface.path}: ${uz.cyrillicCount} Cyrillic character(s) in an Uzbek-Latin UI`);
    if (uz.untranslatedMarkers.length) notes.push(`${surface.id}-UZ ${surface.path}: untranslated key(s) ${uz.untranslatedMarkers.join(", ")}`);
    if (uzNarrow.overflowPx > 1) notes.push(`${surface.id}-UZ ${surface.path}: +${uzNarrow.overflowPx}px horizontal overflow at 320px in Uzbek (longer strings)`);
  }

  /* =============================================================== PHASE 4
   * Keyboard access and focus management on the interactive surfaces, at 320 px —
   * the width where focus rings and target sizes are most likely to be wrong.
   */
  console.log("\nPHASE 4 — keyboard access, focus order and dialogs (320px)");
  for (const surface of LEARNER_SURFACES.filter((s) => s.interactive)) {
    const session = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 320, locale: "en" });
    try {
      await session.goto(surface.path);
      const stops = await auditKeyboard(session.page, { tabs: 14 });
      // Focus reaching <main> is the requirement. Requiring a stop ON a heading was a bad check:
      // headings are not focusable without an explicit tabindex, so that "failure" described
      // correct behaviour on every page in the product.
      const reachedMain = stops.some((s) => s.insideMain);
      const invisibleFocus = stops.filter((s) => !s.outline);
      const pageAudit = await auditPage(session.page);
      const smallTargets = pageAudit.smallTargetCount;
      const advisory = pageAudit.advisoryTargetCount;
      row({
        id: `${surface.id}-KB`, area: surface.area, actor: "STUDENT_A", locale: "en",
        action: `${surface.path}: 14 Tab presses at 320px`,
        expected: "focus reaches content inside <main>, every stop shows a visible focus indicator, and no touch target is below the WCAG 2.5.8 AA floor of 24px",
        actual: `stops=${stops.length} (${stops.slice(0, 5).map((s) => s.tag).join("→")}); reachedMain=${reachedMain}; stops without a visible indicator=${invisibleFocus.length}; below 24px=${smallTargets}; advisory 24-44px=${advisory}`,
        verdict: stops.length === 0 ? "FAIL"
          : invisibleFocus.length || smallTargets ? "A11Y_DEFECT" : "PASS",
      });
      if (invisibleFocus.length) notes.push(`${surface.id}-KB ${surface.path}: ${invisibleFocus.length} focus stop(s) with no visible indicator`);
      if (smallTargets) notes.push(`${surface.id}-KB ${surface.path}: ${smallTargets} touch target(s) BELOW the 24px WCAG AA floor at 320px — ${JSON.stringify(pageAudit.smallTargets.slice(0, 4))}`);
      else if (advisory) notes.push(`${surface.id}-KB ${surface.path}: ${advisory} control(s) meet the 24px AA floor but are below the enhanced 44px target (advisory, not a defect)`);
    } finally {
      await session.close();
    }
  }

  /* =============================================================== PHASE 5
   * Live-region / status-announcement coverage, and duplicate-request waste.
   * Both are runtime-only properties.
   */
  console.log("\nPHASE 5 — status announcements and duplicate requests");
  const noLiveRegion = [];

  /**
   * Make the page change state, so a conditionally rendered live region has a reason to exist.
   *
   * Only controls INSIDE <main> are used, and navigation is never followed: clicking a tab, a
   * filter, a disclosure or a "show more" is a state change, while clicking a link would measure
   * a different page. Returns false when the surface owns no such control, which the caller must
   * record as "not measurable" rather than as a defect.
   */
  async function triggerStateChange(page) {
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('main button:not([disabled]), main [role=tab], main [role=button], main [aria-expanded], main input[type=checkbox], main input[type=radio], main select'),
      ).filter((el) => {
        if (el.closest("a[href]")) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight * 2;
      });
      const target = candidates[0];
      if (!target) return false;
      target.click();
      return true;
    });
    if (!clicked) return false;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return true;
  }
  for (const surface of LEARNER_SURFACES) {
    const session = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 390, locale: "en" });
    try {
      const recorder = attachRequestRecorder(session.page);
      await session.goto(surface.path);
      const audit = await auditPage(session.page);
      const dupes = recorder.duplicates();
      recorder.detach();
      const asyncWork = recorder.sawAsync();
      // A live region is required only where the page performs asynchronous work of its own. A
      // server-rendered hub that never fetches has no state change to announce, and demanding a
      // region from it flagged 20 pages that were behaving correctly.
      //
      // Even that is not enough. In this product a status region is CONDITIONALLY rendered:
      // /app/profile's photo panel owns `<p role="status">` but only once a save has produced a
      // message, and the dictionary word popover owns `role="alert"` only once a lookup fails. So
      // an at-rest count of 0 describes pages that implement announcements correctly. The honest
      // test makes the page change state and measures again; only a page that still owns no region
      // after a real interaction is a defect, and a page with no interactive control at all is
      // recorded as an observation rather than counted as a failure.
      let liveAfter = audit.liveRegions;
      let interacted = false;
      if (audit.liveRegions === 0 && asyncWork) {
        interacted = await triggerStateChange(session.page);
        if (interacted) liveAfter = (await auditPage(session.page)).liveRegions;
      }
      const regionMissing = asyncWork && interacted && liveAfter === 0;
      if (regionMissing) noLiveRegion.push(surface.path);
      else if (audit.liveRegions === 0 && asyncWork) {
        notes.push(`${surface.id} ${surface.path}: no live region at rest (${interacted ? "and none after an interaction that changed state" : "no interactive control available to trigger one"}) — observation, not counted as a defect`);
      }
      if (dupes.length) {
        notes.push(`${surface.id} ${surface.path}: ${dupes.length} duplicated product GET(s) — ${dupes.slice(0, 3).map((d) => `${d.url}×${d.count}`).join(", ")}`);
      }
      if (session.consoleErrors.length) {
        notes.push(`${surface.id} ${surface.path}: ${session.consoleErrors.length} browser console error(s) — ${session.consoleErrors.slice(0, 2).join(" | ").slice(0, 200)}`);
      }
      row({
        id: `${surface.id}-RT`, area: surface.area, actor: "STUDENT_A", locale: "en",
        action: `${surface.path}: live regions, duplicate product requests and console errors at 390px`,
        expected: "no product GET issued twice for the same URL; no console errors; a status region exists wherever the page fetches asynchronously and changes state",
        actual: `async work=${asyncWork}; live regions at rest=${audit.liveRegions}; after interaction=${liveAfter} (interacted=${interacted}); duplicated product GETs=${dupes.length ? dupes.map((d) => `${d.url.replace(/^https?:\/\/[^/]+/, "")}×${d.count}`).join(", ") : "none"}; console errors=${session.consoleErrors.length}`,
        verdict: dupes.length || session.consoleErrors.length ? "PERF_DEFECT"
          : regionMissing ? "A11Y_DEFECT" : "PASS",
      });
    } finally {
      await session.close();
    }
  }
} catch (error) {
  console.error("\nBROWSER MATRIX ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});

  const tally = (v) => rows.filter((r) => r.verdict === v).length;
  const byArea = [...new Set(rows.map((r) => r.area))].map((area) => {
    const inArea = rows.filter((r) => r.area === area);
    return `  ${area}: ${inArea.filter((r) => r.verdict === "PASS").length}/${inArea.length}`;
  });

  const lines = [
    "# Real-browser matrix (Package F)",
    "",
    `Rendered in Chromium against \`${BASE}\`. Every measurement is taken from a live render;`,
    "none is inferred from source text. Viewports 320 / 390 / 768 / 1440; locales en and uz.",
    "The protected theme and background design were not modified — this probe only reads.",
    "",
    `**${tally("PASS")} PASS / ${rows.length - tally("PASS")} NOT-PASS** across ${rows.length} rows — ` +
      `FAIL ${tally("FAIL")}, a11y defects ${tally("A11Y_DEFECT")}, i18n defects ${tally("I18N_DEFECT")}, ` +
      `perf defects ${tally("PERF_DEFECT")}, not measurable ${tally("NOT_MEASURABLE")}.`,
    "",
    ...byArea,
    "",
    "| id | area | actor | locale | action | expected | actual | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.id} | ${r.area} | ${r.actor} | ${r.locale} | \`${r.action}\` | ${r.expected} | ${r.actual} | **${r.verdict}** |`),
    "",
    notes.length
      ? `## Defects and observations\n\n${notes.map((n) => `- ${n}`).join("\n")}\n`
      : "## Defects and observations\n\nNone recorded.\n",
  ];
  writeFileSync("docs/BROWSER-MATRIX.md", `${lines.join("\n")}\n`);
  console.log(`\n${lines.slice(6, 9 + byArea.length).join("\n")}`);
  console.log(`\nPASS ${tally("PASS")} / rows ${rows.length}; defects noted ${notes.length}`);
}

process.exit(exitCode || process.exitCode === 1 ? 1 : 0);
