#!/usr/bin/env node
/**
 * REAL-BROWSER acceptance for Reading V4 — a genuine Chromium, not jsdom.
 *
 *   BASE_URL=… DATABASE_URL=… AUTH_SECRET=… CHROMIUM_PATH=/path/to/chromium \
 *   node scripts/verify-reading-browser.mjs
 *
 * Proves the things a DOM test cannot: a real pointer selection over laid-out
 * text produces a highlight at the right offsets, removal restores the text,
 * the vocabulary popover opens on a real click in learning mode and never in an
 * active exam, and the workspace actually lays out at 390 / 768 / 1440 CSS px
 * without horizontal overflow or controls pushed off-screen.
 *
 * It runs against the SAME built server and isolated QA2 database as
 * `verify-reading-v4.mjs`, and deletes every fixture it creates.
 */
import pg from "pg";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set (the server's own secret)");
if (!EXECUTABLE) throw new Error("CHROMIUM_PATH must point at a real Chromium binary");
assertIsolatedTarget(DATABASE_URL);

const REF = `rdg-browser-${randomUUID().slice(0, 8)}`;
let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${ok ? "" : ` — ${detail}`}`);
  if (ok) pass += 1; else failures.push(name);
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const created = { sets: [], passages: [], attempts: [], users: [] };

const BODY = "The bank approved the loan in 1998. " +
  "Reading quickly is a skill that improves with deliberate practice over many weeks. ".repeat(4);

/** Select a substring with a REAL pointer drag across the laid-out text. */
async function dragSelect(page, selector, needle) {
  const box = await page.evaluate(([sel, text]) => {
    const host = document.querySelector(sel);
    if (!host) return null;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent.indexOf(text);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) continue;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return null;
  }, [selector, needle]);
  if (!box) return false;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift").catch(() => {});
  await page.dispatchEvent(selector, "keyup", { key: "Shift", bubbles: true });
  return true;
}

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
});

try {
  const [student] = await q(
    `insert into users (name,email,role,account_status) values ($1,$2,'student','active') returning id,role,name`,
    [`${REF} student`, `${REF}-student@learners-qa.invalid`]);
  created.users.push(student.id);
  const token = await new SignJWT({ sub: student.id, role: student.role, name: student.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));

  /* One General learning set (1 passage) and one Academic full test (3 passages). */
  const makeSet = async (title, counts) => {
    const [set] = await q(`insert into general_reading_sets (title,publication_state,source_ref) values ($1,'published',$2) returning id`,
      [title, `${REF}-${randomUUID().slice(0, 6)}`]);
    created.sets.push(set.id);
    const passages = [];
    for (const [index, count] of counts.entries()) {
      const [p] = await q(`insert into reading_passages (title,body_text,publication_state,difficulty_level,suggested_minutes)
        values ($1,$2,'published','B2',20) returning id`, [`${title} part ${index + 1}`, BODY]);
      created.passages.push(p.id);
      await q(`insert into general_reading_passages (passage_id,set_id,passage_no) values ($1,$2,$3)`, [p.id, set.id, index + 1]);
      for (let n = 1; n <= count; n += 1)
        await q(`insert into reading_questions (passage_id,"order",question_no,type,type_code,question_text,correct_answer,explanation)
          values ($1,$2,$2,'short_answer','short_answer',$3,'bank','The first sentence names the lender.')`,
          [p.id, n, `Who approved the loan in question ${n}?`]);
      passages.push(p.id);
    }
    return { setId: set.id, passages };
  };
  const general = await makeSet(`${REF} General`, [5]);
  const academic = await makeSet(`${REF} Academic`, [13, 13, 14]);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "la_session", value: token, url: BASE }]);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  /* ------------------------------------------------ General: pointer highlight */
  await page.goto(`${BASE}/app/reading/general/${general.setId}`, { waitUntil: "networkidle" });
  check("B1 the General workspace paints its passage in a real browser",
    await page.locator("[data-clickable-text]").first().isVisible());
  const textBefore = (await page.locator("[data-clickable-text]").first().innerText()).trim();
  const dragged = await dragSelect(page, "[data-clickable-text]", "approved the loan");
  check("B2 a real pointer drag selects laid-out passage text", dragged);
  const control = page.locator("[data-highlight-control] button").first();
  check("B3 the highlight control appears for a real selection", await control.isVisible().catch(() => false));
  if (await control.isVisible().catch(() => false)) {
    await control.click();
    const mark = page.locator("[data-clickable-text] mark").first();
    check("B4 the highlight lands on exactly the selected words",
      (await mark.innerText().catch(() => "")).includes("approved the loan"), await mark.innerText().catch(() => "no mark"));
    const textAfter = (await page.locator("[data-clickable-text]").first().innerText()).trim();
    check("B5 highlighting does not alter the passage text", textAfter === textBefore);
    const remove = page.locator("[data-reading-remove-highlight]").first();
    check("B6 a highlight can be removed from the keyboard-reachable list", await remove.isVisible());
    await remove.click();
    check("B7 removal deletes the highlight, never the text",
      (await page.locator("[data-clickable-text] mark").count()) === 0 &&
      (await page.locator("[data-clickable-text]").first().innerText()).trim() === textBefore);
  }

  /* ------------------------------------------- General: pointer Dictionary */
  const word = page.locator("[data-word]").filter({ hasText: /^bank$/ }).first();
  if (await word.count()) {
    await word.click();
    check("B8 a real click on a word opens the canonical Dictionary popover",
      await page.locator("[data-word-popover], [role=dialog]").first().isVisible({ timeout: 5000 }).catch(() => false));
    await page.keyboard.press("Escape");
  } else check("B8 a real click on a word opens the canonical Dictionary popover", false, "no lexical target rendered");

  /* --------------------------------------------- General: explicit Check only */
  const firstInput = page.locator("[data-general-questions] [data-answer-input]").first();
  if (await firstInput.count()) {
    await firstInput.fill("bank");
    check("B9 typing an answer reveals nothing before Check",
      (await page.locator("[data-general-result]").count()) === 0);
    await page.locator("[data-general-check]").first().click();
    check("B10 an explicit Check reveals the server's verdict",
      await page.locator("[data-general-result]").first().isVisible({ timeout: 10000 }).catch(() => false));
    await firstInput.fill("changed");
    check("B11 editing immediately withdraws the stale verdict",
      (await page.locator("[data-general-result]").count()) === 0);
  } else check("B9 typing an answer reveals nothing before Check", false, "no answer control rendered");

  /* ------------------------------------------------- Academic: no help, real UI */
  const start = await fetch(`${BASE}/api/reading/academic`, {
    method: "POST", headers: { cookie: `la_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ setId: academic.setId }),
  });
  const attemptId = (await start.json()).id;
  if (attemptId) created.attempts.push(attemptId);
  await page.goto(`${BASE}/app/reading/attempts/${attemptId}`, { waitUntil: "networkidle" });
  check("B12 the active exam renders its workspace and timer",
    await page.locator("[data-practice-timer]").first().isVisible());
  check("B13 the active exam paints no lexical target at all",
    (await page.locator("[data-word], [data-clickable-text]").count()) === 0);
  const examBody = page.locator("[data-passage-body]").first();
  const examTextBefore = (await examBody.innerText()).trim();
  await dragSelect(page, "[data-passage-body]", "approved the loan");
  const examControl = page.locator("[data-highlight-control] button").first();
  check("B14 highlighting still works inside the active exam", await examControl.isVisible().catch(() => false));
  if (await examControl.isVisible().catch(() => false)) {
    await examControl.click();
    check("B15 the exam highlight changes no exam text",
      (await examBody.innerText()).trim() === examTextBefore);
  }
  check("B16 no popover can be opened in the active exam",
    (await page.locator("[data-word-popover], [role=dialog]").count()) === 0);

  /* ------------------------------------------------------------- viewports */
  for (const [width, height, label] of [[390, 844, "mobile"], [768, 1024, "tablet"], [1440, 900, "desktop"]]) {
    await page.setViewportSize({ width, height });
    for (const [name, url] of [
      ["Reading hub", `${BASE}/app/reading`],
      ["General", `${BASE}/app/reading/general/${general.setId}`],
      ["Academic exam", `${BASE}/app/reading/attempts/${attemptId}`],
      ["Question types", `${BASE}/app/reading/question-types?type=short_answer`],
      ["Retention", `${BASE}/app/reading/retention`],
    ]) {
      await page.goto(url, { waitUntil: "networkidle" });
      const overflow = await page.evaluate((w) => ({
        scrollWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("main *")]
          .filter((el) => el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).overflowX !== "auto" && getComputedStyle(el).overflowX !== "scroll")
          .slice(0, 3).map((el) => el.tagName + "." + String(el.className).slice(0, 40)),
      }), width);
      check(`B17 ${name} lays out at ${width}px (${label}) with no horizontal overflow`,
        overflow.scrollWidth <= width + 1, `scrollWidth ${overflow.scrollWidth}: ${overflow.offenders.join(", ")}`);
    }
  }
  check("B18 no Reading surface logged a browser error", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await context.close();
} finally {
  await browser.close();
  await q(`delete from reading_answers where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_assessment_passages where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_assessments where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_attempts where id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from general_reading_progress where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from general_reading_passages where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from reading_questions where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from reading_passages where id = any($1::uuid[])`, [created.passages]);
  await q(`delete from general_reading_sets where id = any($1::uuid[])`, [created.sets]);
  await q(`delete from user_vocabulary where user_id = any($1::uuid[])`, [created.users]).catch(() => {});
  await q(`delete from activity_events where user_id = any($1::uuid[])`, [created.users]);
  await q(`delete from users where id = any($1::uuid[])`, [created.users]);
  const residue = await q(`select (select count(*)::int from users where id = any($1::uuid[]))
    + (select count(*)::int from reading_passages where id = any($2::uuid[]))
    + (select count(*)::int from general_reading_sets where id = any($3::uuid[]))
    + (select count(*)::int from reading_attempts where id = any($4::uuid[])) as n`,
    [created.users, created.passages, created.sets, created.attempts]);
  check("Z1 every browser fixture is deleted (residue 0)", Number(residue[0].n) === 0, `${residue[0].n} rows remain`);
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) { console.log(`failed: ${failures.join(", ")}`); process.exit(1); }
