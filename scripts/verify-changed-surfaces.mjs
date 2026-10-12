#!/usr/bin/env node
/**
 * PRIORITY G — responsive, EN/UZ and Day/Night acceptance for the surfaces this round changed.
 *
 *   node scripts/verify-changed-surfaces.mjs [base]
 *
 * Two learner surfaces were modified: Speaking Practice gained a visually hidden status region, and
 * the Listening review gained two new verdict states rendered with neutral ink tokens instead of the
 * failure band. Both changes carry a specific risk that a desktop-only, English-only, Day-only check
 * would miss:
 *
 *   - a status region that is supposed to be invisible could still take up layout at 320px and push
 *     the page into horizontal overflow;
 *   - `bg-ink-50` with `text-ink-500` is a token pair, and tokens are re-valued per theme, so the
 *     neutral badge could be perfectly legible in Day Mode and unreadable in Night Mode. A colour
 *     that exists is not a colour that can be read.
 *
 * So the badge's contrast ratio is COMPUTED from the colours the browser actually resolved, in both
 * themes, rather than assumed from the class names. Layout is measured at 320 / 390 / 768 / 1024 /
 * 1440 and the protected design is only read, never modified.
 */
import pg from "pg";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }
const { assertMutableDatabase, createRowSweeper } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-changed-surfaces" });
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const sweeper = createRowSweeper({ client, probe: "changed-surfaces", tables: ["listening_answers", "listening_attempts", "activity_events"] });
await sweeper.capture();

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** WCAG relative luminance and contrast ratio, computed from resolved rgb() colours. */
const parseRgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
function contrast(fg, bg) {
  const lum = ([r, g, b]) => {
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(parseRgb(fg)), lum(parseRgb(bg))];
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const browser = await launchBrowser();
try {
  /* ---- one ungraded listening attempt, so the new neutral states are on screen ---- */
  const student = (await q("select id from users where email='demo.student@learnersarea.uz'"))[0].id;
  const test = (await q("select id from listening_tests order by created_at limit 1"))[0].id;
  const questions = await q('select id from listening_questions where test_id=$1 order by "order"', [test]);
  const [attempt] = await q(
    `insert into listening_attempts (user_id, test_id, status, score, total_questions, submitted_at)
     values ($1,$2,'completed',NULL,NULL,now()) returning id`, [student, test]);
  for (const question of questions) {
    await q(`insert into listening_answers (attempt_id, question_id, user_answer, is_correct) values ($1,$2,$3,NULL)`,
      [attempt.id, question.id, "QA2 responsive probe answer"]);
  }
  const REVIEW = `/app/listening/attempts/${attempt.id}`;

  const readPage = async (page) => page.evaluate(() => {
    const de = document.documentElement;
    const overflowPx = Math.max(0, de.scrollWidth - window.innerWidth);
    const status = document.querySelector("[data-practice-status]");
    const statusBox = status ? status.getBoundingClientRect() : null;
    // The neutral verdict badges, with the colours the browser actually resolved.
    const badges = [...document.querySelectorAll("[data-listening-verdict-label]")]
      .filter((el) => ["notGraded", "unanswered"].includes(el.getAttribute("data-listening-verdict-label")))
      .map((el) => {
        const cs = getComputedStyle(el);
        const card = el.closest("[data-listening-verdict]");
        /*
         * Resolve the EFFECTIVE background: an element whose own background is transparent is painted
         * by whatever is behind it, and comparing text against rgba(0,0,0,0) produces a number that
         * describes nothing. Walking up to the first non-transparent ancestor is also what caught a
         * real defect — a badge class that Tailwind never generated, so the label had no pill at all.
         */
        let bg = cs.backgroundColor;
        let node = el;
        while (node && /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)) {
          node = node.parentElement;
          if (!node) break;
          bg = getComputedStyle(node).backgroundColor;
        }
        return { verdict: el.getAttribute("data-listening-verdict-label"), text: el.textContent.trim(), color: cs.color,
                 ownBg: cs.backgroundColor, bg,
                 borderColor: card ? getComputedStyle(card).borderTopColor : "", fontSize: parseFloat(cs.fontSize) };
      });
    return {
      innerWidth: window.innerWidth, overflowPx, theme: de.getAttribute("data-theme"), lang: de.getAttribute("lang"),
      statusText: status?.textContent?.trim() ?? null,
      statusBox: statusBox ? { w: Math.round(statusBox.width), h: Math.round(statusBox.height) } : null,
      verdicts: [...document.querySelectorAll("[data-listening-verdict]")].map((c) => c.getAttribute("data-listening-verdict")),
      badges, bodyText: document.body.innerText.slice(0, 400),
    };
  });

  const setTheme = async (page, theme) => {
    await page.evaluate(async (t) => { await fetch("/api/theme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ theme: t }) }); }, theme);
  };

  /* ---------------- 1. layout at every width, both surfaces, English, Day ---------------- */
  for (const viewport of [320, 390, 768, 1024, 1440]) {
    const s = await createSession(browser, { base: BASE, email: "demo.student@learnersarea.uz", password: "Student12345!", viewport, locale: "en" });
    for (const [label, path, isPractice] of [["Speaking Practice", "/app/speaking/practice", true], ["Listening review", REVIEW, false]]) {
      await s.goto(path);
      await s.page.waitForSelector(isPractice ? "[data-practice-status]" : "[data-listening-verdict]", { timeout: 20000 }).catch(() => {});
      const p = await readPage(s.page);
      check(`${viewport}px EN day · ${label}: no page-level horizontal overflow`,
        p.overflowPx === 0, `scrollWidth exceeds the ${p.innerWidth}px viewport by ${p.overflowPx}px`);
      if (isPractice) {
        check(`${viewport}px EN day · ${label}: the status region is present and takes no layout space`,
          Boolean(p.statusText) && p.statusBox && p.statusBox.w <= 1 && p.statusBox.h <= 1,
          `text="${p.statusText}" box=${p.statusBox ? `${p.statusBox.w}×${p.statusBox.h}` : "none"}`);
      } else {
        check(`${viewport}px EN day · ${label}: every question renders the not-graded verdict`,
          p.verdicts.length === questions.length && p.verdicts.every((v) => v === "notGraded"),
          `verdicts=${p.verdicts.join(",") || "(none)"}`);
      }
      check(`${viewport}px EN day · ${label}: no console errors`,
        s.consoleErrors.length === 0, s.consoleErrors.slice(0, 2).join(" | ") || "0 errors");
    }
    await s.close();
  }

  /* ------------- 2. Uzbek and Night Mode, including computed badge contrast ------------- */
  for (const locale of ["en", "uz"]) {
    for (const theme of ["day", "night"]) {
      const s = await createSession(browser, { base: BASE, email: "demo.student@learnersarea.uz", password: "Student12345!", viewport: 390, locale });
      await s.goto(REVIEW);
      await setTheme(s.page, theme);
      await s.goto(REVIEW);
      await s.page.waitForSelector("[data-listening-verdict-label]", { timeout: 20000 }).catch(() => {});
      const p = await readPage(s.page);
      const tag = `390px ${locale.toUpperCase()} ${theme}`;

      check(`${tag} · the server rendered the requested theme`, p.theme === theme, `data-theme="${p.theme}"`);
      check(`${tag} · the neutral badges are rendered for every not-graded question`,
        p.badges.length === questions.length, `${p.badges.length} neutral badge(s) for ${questions.length} questions`);

      const ratios = p.badges.map((b) => ({ ...b, ratio: contrast(b.color, b.bg) }));
      const worst = ratios.reduce((min, r) => (r.ratio < min.ratio ? r : min), ratios[0] ?? { ratio: Infinity });
      // 4.5:1 is WCAG AA for text at these sizes; the badge text is small, so the higher threshold applies.
      check(`${tag} · the neutral badge text is readable (contrast ≥ 4.5:1)`,
        ratios.length > 0 && ratios.every((r) => r.ratio >= 4.5),
        ratios.length ? `worst ${worst.ratio.toFixed(2)}:1 (color ${worst.color} on effective ${worst.bg}${/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(worst.ownBg ?? "") ? " — the badge itself is TRANSPARENT, so no background utility was generated" : ""}, ${worst.fontSize}px, "${worst.text}")` : "no badges rendered");

      const expectedLabel = locale === "uz" ? "Baholanmagan" : "Not graded";
      check(`${tag} · the badge carries the ${locale.toUpperCase()} label`,
        p.badges.every((b) => b.text === expectedLabel), `labels: ${[...new Set(p.badges.map((b) => b.text))].join(", ") || "(none)"}`);

      check(`${tag} · the border is the neutral token, never the failure band`,
        p.badges.every((b) => !/255\s*133\s*122|220\s*38\s*38/.test(b.borderColor)),
        `resolved border colours: ${[...new Set(p.badges.map((b) => b.borderColor))].join(", ")}`);

      const expectedHeader = locale === "uz" ? "Hali baholanmagan" : "Not graded yet";
      check(`${tag} · the header still says the work is not graded, in ${locale.toUpperCase()}`,
        p.bodyText.includes(expectedHeader) || (await s.page.evaluate(() => document.body.innerText)).includes(expectedHeader),
        `expected "${expectedHeader}"`);
      check(`${tag} · no console errors`, s.consoleErrors.length === 0, s.consoleErrors.slice(0, 2).join(" | ") || "0 errors");

      // The practice status region in the same locale/theme combination.
      await s.goto("/app/speaking/practice");
      await s.page.waitForSelector("[data-practice-status]", { timeout: 20000 }).catch(() => {});
      const pp = await readPage(s.page);
      const expectedStatus = locale === "uz" ? "Qismni tanlang" : "Choose a part";
      check(`${tag} · the practice status region renders the ${locale.toUpperCase()} string and stays invisible`,
        pp.statusText === expectedStatus && pp.statusBox && pp.statusBox.w <= 1 && pp.overflowPx === 0,
        `text="${pp.statusText}" box=${pp.statusBox ? `${pp.statusBox.w}×${pp.statusBox.h}` : "none"} overflow=${pp.overflowPx}px`);
      await s.close();
    }
  }
} catch (error) {
  console.error("\nABORTED:", error?.message ?? error);
  failures.push("aborted");
} finally {
  const { removed, residue } = await sweeper.sweep();
  console.log(`\n  sweeper removed: ${removed.join(", ") || "nothing"}`);
  console.log(`  residue: ${residue.length ? residue.join(", ") : "none"}`);
  if (residue.length) failures.push("residue");
  await client.end().catch(() => {});
  await browser.close().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
