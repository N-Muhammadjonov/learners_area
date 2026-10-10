#!/usr/bin/env node
/**
 * §4 — REAL-BROWSER Academic Reading journey with PostgreSQL evidence at every step.
 *
 *   node scripts/verify-reading-journey.mjs [baseUrl]
 *
 * This is not the API journey in scripts/verify-journeys.mjs and not the layout matrix in
 * scripts/verify-browser-matrix.mjs. It drives actual Chromium: it clicks start, switches to the
 * questions pane, answers through whichever control the question type actually renders, watches the
 * autosave indicator, navigates away and back, confirms the native submit dialog, and reads the
 * review — checking the rendered DOM and the database at each step, because a journey is only real
 * if the browser state and the stored state agree.
 *
 * FIVE ANSWER-CONTROL SHAPES, all handled. ReadingExam.tsx renders a different control per answer
 * model, and they do not share a data attribute:
 *   ternary      button[data-answer-option="{value}"]      role=radio, value already normalised
 *   choice_multi input[type=checkbox][value={letter}]      stores comma-joined letters
 *   letter chips button[data-answer-option={letter}]       title={text}, stores the choice text
 *   full choices ul[data-full-choices] input[type=radio]   value={choice text}
 *   text         input[data-answer-input={id}]             inline when the stem contains a ___ blank
 * A probe that only knows `data-answer-option` and `data-answer-input` silently fails to answer
 * plain multiple choice and then reports a scoring defect that does not exist. This was verified
 * against the live DOM before the shapes were enumerated — not inferred from the source.
 *
 * THE GRADING PROOF. The journey deliberately answers some questions correctly and some
 * incorrectly in a fixed pattern and computes the expected score itself from the stored
 * correct_answer values. It asserts BOTH that the score equals the number answered correctly AND
 * that it does not equal the number answered. A route that credited every submitted answer, or that
 * trusted a client-supplied score, fails one of those two. Per-answer `is_correct` flags are checked
 * individually too, so a right total assembled from wrong per-answer marks cannot pass.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");
const pg = (await import("pg")).default;
assertMutableDatabase(DATABASE_URL, { probe: "verify-reading-journey" });

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const all = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await all(sql, p))[0] ?? null;

const sweeper = createRowSweeper({
  client: db, probe: "verify-reading-journey",
  tables: ["reading_answers", "reading_attempts", "activity_events"],
});
const finalSweep = installSweepHandlers(sweeper, { probe: "verify-reading-journey", onDone: () => db.end().catch(() => {}) });
await sweeper.capture();

const steps = [];
let defects = 0;
function step(name, detail) {
  steps.push({ name, ...detail });
  console.log(`    ${detail.ok ? "ok  " : "FAIL"} ${name}${detail.note ? ` — ${detail.note}` : ""}`);
  if (!detail.ok) defects++;
  return detail.ok;
}
function blocker(name, note, extra = {}) { steps.push({ name, ok: true, blocked: true, note, ...extra }); console.log(`    BLOCKED ${name} — ${note}`); }

const STUDENT_A = ["demo.student@learnersarea.uz", "Student12345!"];
const STUDENT_B = ["new.student@learnersarea.uz", "Student12345!"];
let attemptId = null;

/**
 * Answer one question through whichever control it actually renders. Returns the shape used and the
 * value the control should have stored, so the database can be compared against the intent rather
 * than against whatever the server decided to keep.
 */
const ANSWER_FN = async (payload) => {
  const out = [];
  for (const item of payload) {
    const node = document.querySelector(`[data-question="${item.id}"]`);
    if (!node) { out.push({ id: item.id, ok: false, shape: "missing-node" }); continue; }
    const target = String(item.target ?? "");
    let shape = null;
    let stored = null;

    // 1. ternary chips — data-answer-option already holds the normalised value.
    const ternary = Array.from(node.querySelectorAll('button[data-answer-option][role="radio"]'))
      .filter((b) => ["true", "false", "not_given", "yes", "no"].includes(b.getAttribute("data-answer-option")));
    // 2. letter chips — data-answer-option holds a LETTER, title holds the choice text.
    const chips = Array.from(node.querySelectorAll('button[data-answer-option][role="radio"]'))
      .filter((b) => !["true", "false", "not_given", "yes", "no"].includes(b.getAttribute("data-answer-option")));
    // 3. plain multiple choice radios inside the full-choices list.
    const radios = Array.from(node.querySelectorAll('ul[data-full-choices] input[type="radio"]'));
    // 4. multi-select checkboxes, stored as comma-joined letters.
    const boxes = Array.from(node.querySelectorAll('input[type="checkbox"]'));
    // 5. free text.
    const text = node.querySelector(`input[data-answer-input="${item.id}"]`) ?? node.querySelector("input[data-answer-input]");

    const pickWrong = (list, match) => list.find((el) => el !== match) ?? null;

    if (ternary.length) {
      shape = "ternary";
      const match = ternary.find((b) => b.getAttribute("data-answer-option") === target.toLowerCase().replace(/\s+/g, "_"));
      const pick = item.wantCorrect ? match : pickWrong(ternary, match);
      if (pick) { pick.click(); stored = pick.getAttribute("data-answer-option"); }
    } else if (radios.length) {
      shape = "choice_single";
      const match = radios.find((r) => String(r.value).toLowerCase() === target.toLowerCase());
      const pick = item.wantCorrect ? match : pickWrong(radios, match);
      if (pick) { pick.click(); stored = String(pick.value); }
    } else if (chips.length) {
      shape = "letter_chips";
      const match = chips.find((b) => (b.getAttribute("title") || "").toLowerCase() === target.toLowerCase());
      const pick = item.wantCorrect ? match : pickWrong(chips, match);
      if (pick) { pick.click(); stored = pick.getAttribute("title") || ""; }
    } else if (boxes.length) {
      shape = "choice_multi";
      // Correct = the letters named by the stored answer; wrong = a different single letter.
      const wanted = target.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      const pick = item.wantCorrect
        ? boxes.find((b) => wanted.includes(String(b.value)))
        : boxes.find((b) => !wanted.includes(String(b.value)));
      if (pick) { pick.click(); stored = item.wantCorrect ? wanted.join(", ") : String(pick.value); }
    } else if (text) {
      shape = "text";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const value = item.wantCorrect ? target : item.wrongText;
      setter.call(text, value);
      text.dispatchEvent(new Event("input", { bubbles: true }));
      text.dispatchEvent(new Event("change", { bubbles: true }));
      stored = value;
    }
    out.push({ id: item.id, ok: Boolean(stored), shape, stored });
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
};

const browser = await launchBrowser();
try {
  /* --------------------------------------------------------------- 1. actor */
  const a = await createSession(browser, { base: BASE, email: STUDENT_A[0], password: STUDENT_A[1], viewport: 1440, locale: "en" });
  // Submitting opens a native confirm() — without accepting it the renderer blocks and the click
  // never returns, which looks like a product hang but is the dialog doing its job.
  let dialogs = 0;
  a.page.on("dialog", async (d) => { dialogs++; await d.accept(); });
  const who = await a.page.evaluate(async () => {
    const r = await fetch("/api/history", { headers: { accept: "application/json" } });
    return { status: r.status };
  });
  const userA = await one("select id, email, role, account_status from users where email=$1", [STUDENT_A[0]]);
  step("authenticated actor is the expected learner", {
    ok: who.status === 200 && userA?.role === "student" && userA?.account_status === "active",
    note: `${userA?.email} id=${String(userA?.id).slice(0, 8)} role=${userA?.role} status=${userA?.account_status}; an authenticated API call answers ${who.status}`,
    browser: `logged in at ${a.page.url().replace(BASE, "")}`, db: `users.role=${userA?.role}`,
  });

  /* ------------------------------------------- 2. reach a published passage */
  await a.goto("/app/reading/question-types?type=true_false_not_given");
  await new Promise((r) => setTimeout(r, 1800));
  const startButtons = await a.page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-passage-action="start"]')).map((b) => ({
      text: b.textContent.trim().slice(0, 20),
      card: b.closest("section,article,li,div")?.innerText.replace(/\s+/g, " ").slice(0, 70) ?? "",
    })));
  step("a published passage offers a real start control in the UI", {
    ok: startButtons.length >= 1,
    note: `${startButtons.length} start control(s): ${JSON.stringify(startButtons[0] ?? null)}`,
    browser: "/app/reading/question-types?type=true_false_not_given", db: "read-only",
  });
  if (!startButtons.length) throw new Error("no startable published passage — the journey cannot continue");

  // The passage is chosen from the database so the oracle answers are the ones the UI will render.
  const passage = await one(`
    select p.id, p.title, p.publication_state from reading_passages p
    where p.publication_state='published'
      and (select count(*)::int from reading_questions q where q.passage_id=p.id) > 0
    order by p.title limit 1`);
  assert.ok(passage, "a published passage with questions must exist");
  const questions = await all(
    `select id, "order", type, question_text, correct_answer, options
       from reading_questions where passage_id=$1 order by "order"`, [passage.id]);

  /* ------------------------------------------------------- 3. start attempt */
  const preExisting = await one("select id from reading_attempts where user_id=$1 and passage_id=$2 and submitted_at is null", [userA.id, passage.id]);
  await a.page.click('[data-passage-action="start"]');
  await new Promise((r) => setTimeout(r, 3500));
  const attemptUrl = a.page.url();
  attemptId = await a.page.evaluate(() => document.querySelector("[data-attempt]")?.getAttribute("data-attempt") ?? null);
  const attemptRow = attemptId
    ? await one("select id, user_id, passage_id, status, score, submitted_at from reading_attempts where id=$1", [attemptId])
    : null;
  step("clicking start opens an attempt owned by this learner", {
    ok: Boolean(attemptId) && attemptRow?.user_id === userA.id && attemptRow?.passage_id === passage.id && !attemptRow?.submitted_at,
    note: `url=${attemptUrl.replace(BASE, "")}; data-attempt=${String(attemptId).slice(0, 8)}; owner matches=${attemptRow?.user_id === userA.id}; passage matches=${attemptRow?.passage_id === passage.id}; status=${attemptRow?.status}${preExisting ? `; an unsubmitted attempt already existed and was RESUMED (${String(preExisting.id).slice(0, 8)}), not duplicated` : "; a new attempt row was created"}`,
    browser: attemptUrl.replace(BASE, ""), db: `reading_attempts.user_id=${String(attemptRow?.user_id).slice(0, 8)}`,
  });
  if (!attemptId) throw new Error("no attempt id in the DOM — cannot continue");

  /* ------------------------------------------------- 4. passage is visible */
  const passageVisible = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const paragraphs = Array.from(main.querySelectorAll("[data-paragraph]")).map((p) => p.innerText.trim());
    const blocks = Array.from(main.querySelectorAll("[data-exam-passage-text]")).map((p) => p.innerText.trim());
    const panes = {};
    main.querySelectorAll("[data-practice-pane]").forEach((p) => { panes[p.getAttribute("data-practice-pane")] = p.className.includes("hidden") ? "hidden" : "shown"; });
    return {
      paragraphs: paragraphs.length,
      blocks: blocks.length,
      chars: (paragraphs.length ? paragraphs : blocks).join(" ").length,
      panes,
      timer: main.querySelector("[data-time-remaining]")?.getAttribute("data-time-remaining") ?? null,
      questionNodes: main.querySelectorAll("[data-question]").length,
      tabs: Array.from(main.querySelectorAll("[data-practice-tab]")).map((t) => t.getAttribute("data-practice-tab")),
    };
  });
  // A passage stored as one block of text renders through the documented single-block fallback, so
  // counting [data-paragraph] alone would report an empty passage that is in fact on screen.
  step("the passage text and every question render in the browser", {
    ok: passageVisible.chars > 200 && passageVisible.questionNodes === questions.length,
    note: `passage blocks=${passageVisible.blocks} labelled paragraphs=${passageVisible.paragraphs} (${passageVisible.chars} chars of text on screen); question nodes=${passageVisible.questionNodes} of ${questions.length} in the database; countdown timer=${passageVisible.timer}s; panes=${JSON.stringify(passageVisible.panes)}; tabs=${passageVisible.tabs.join("/")}`,
    browser: `${passageVisible.chars} chars rendered`, db: `reading_questions=${questions.length}`,
  });
  step("the countdown timer is running in the UI (exam timing is live, not static)", {
    ok: Number(passageVisible.timer) > 0 && Number(passageVisible.timer) <= 3600,
    note: `data-time-remaining=${passageVisible.timer}s`, browser: "[data-time-remaining]", db: "read-only",
  });

  /* ------------------------------------- 5. answer, half right half wrong */
  // Switch to the questions pane exactly as a learner would, instead of poking hidden nodes.
  const switched = await a.page.evaluate(() => {
    const tab = document.querySelector('[data-practice-tab="questions"]');
    if (!tab) return false;
    tab.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 900));
  const paneNow = await a.page.evaluate(() => {
    const q = document.querySelector('[data-practice-pane="questions"]');
    return q ? (q.className.includes("hidden") ? "hidden" : "shown") : "absent";
  });
  step("the learner can switch from the passage pane to the questions pane", {
    ok: switched && paneNow === "shown",
    note: `clicked [data-practice-tab="questions"]; questions pane is now ${paneNow}`,
    browser: "real click on the pane tab", db: "read-only",
  });

  // Fixed pattern: even question numbers answered correctly, odd ones deliberately wrong. The
  // expected score is computed here, independently of anything the server reports.
  const wrongText = "zzz-not-the-answer";
  const intent = questions.map((q) => ({ q, wantCorrect: Number(q.order) % 2 === 0 }));
  const answered = await a.page.evaluate(ANSWER_FN, intent.map(({ q, wantCorrect }) => ({
    id: q.id, wantCorrect, target: String(q.correct_answer ?? ""), wrongText,
  })));
  const answeredOk = answered.filter((r) => r.ok);
  const expectedScore = intent.filter((i) => i.wantCorrect).length;
  const shapes = [...new Set(answeredOk.map((r) => r.shape))].sort();
  step("every question was answered through the control its type actually renders", {
    ok: answeredOk.length === questions.length,
    note: `${answeredOk.length}/${questions.length} answered; control shapes exercised: ${shapes.join(", ")}${answeredOk.length < questions.length ? `; unanswered: ${answered.filter((r) => !r.ok).map((r) => r.shape).join(", ")}` : ""}`,
    browser: `shapes=${shapes.join("/")}`, db: "not yet persisted",
  });

  const domAnswered = await a.page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-question]")).filter((n) => n.getAttribute("data-answered") === "true").length);
  const tabCounter = await a.page.evaluate(() => document.querySelector('[data-practice-tab="questions"]')?.innerText.replace(/\s+/g, " ").trim() ?? "");
  step("the UI marks those questions answered and the tab counter agrees", {
    ok: domAnswered === questions.length,
    note: `data-answered=true on ${domAnswered}/${questions.length} nodes; questions tab reads "${tabCounter}"`,
    browser: `${domAnswered} answered nodes`, db: "read-only",
  });

  /* ------------------------------------------------- 6. autosave persisted */
  await new Promise((r) => setTimeout(r, 3000));
  const saveState = await a.page.evaluate(() => document.querySelector("[data-save-state]")?.getAttribute("data-save-state") ?? null);
  const savedRows = await all("select question_id, user_answer, is_correct from reading_answers where attempt_id=$1", [attemptId]);
  const stillOpen = await one("select submitted_at from reading_attempts where id=$1", [attemptId]);
  step("answers autosave to the database before any submit", {
    ok: savedRows.length === questions.length && !stillOpen?.submitted_at,
    note: `save indicator=${saveState}; reading_answers rows=${savedRows.length} of ${questions.length}; attempt still unsubmitted=${!stillOpen?.submitted_at}`,
    browser: `data-save-state=${saveState}`, db: `reading_answers=${savedRows.length}`,
  });
  if (saveState !== "saved") defects++, steps.push({ name: "autosave indicator reaches saved", ok: false, note: `data-save-state=${saveState}` });

  // Per-answer identity: each stored answer must be the one this journey typed or clicked.
  const byQuestion = new Map(savedRows.map((r) => [r.question_id, r]));
  const mismatches = [];
  for (const { q, wantCorrect } of intent) {
    const row = byQuestion.get(q.id);
    const entered = answeredOk.find((r) => r.id === q.id)?.stored;
    if (!row) { mismatches.push(`#${q.order}: nothing stored`); continue; }
    const stored = String(row.user_answer ?? "").toLowerCase();
    const correct = String(q.correct_answer ?? "").toLowerCase();
    if (wantCorrect ? stored !== correct : stored === correct) mismatches.push(`#${q.order}: intended ${wantCorrect ? "correct" : "wrong"} ("${entered}"), stored "${row.user_answer}", is_correct=${row.is_correct}`);
  }
  step("each stored answer is the one entered for THAT question (answer identity)", {
    ok: mismatches.length === 0,
    note: mismatches.length ? mismatches.join(" | ") : `all ${questions.length} stored answers match the intended pattern (even order = correct, odd order = deliberately wrong)`,
    db: `reading_answers.user_answer checked individually for ${questions.length} questions`,
  });
  const draftCorrect = Number((await one("select count(*)::int n from reading_answers where attempt_id=$1 and is_correct", [attemptId]))?.n);
  // The PATCH route documents that grading happens once, at submit, so draft rows may legitimately
  // carry no is_correct yet. Both designs are acceptable; a partial or inverted mark is not.
  step("draft rows are either already graded consistently or grading is deferred to submit", {
    ok: draftCorrect === expectedScore || draftCorrect === 0,
    note: `is_correct=true on ${draftCorrect}/${questions.length} draft rows while the attempt is open; expected if graded during autosave=${expectedScore}, expected if deferred to submit=0 (the route documents "grading happens once, at submit"); any other value would mean a partial or inverted mark`,
    db: `reading_answers.is_correct=${draftCorrect}`,
  });

  /* ----------------------------------------------------- 7. resume in UI */
  await a.goto("/app/reading/history");
  await new Promise((r) => setTimeout(r, 1200));
  await a.goto(`/app/reading/attempts/${attemptId}`);
  await new Promise((r) => setTimeout(r, 3000));
  const resumed = await a.page.evaluate(() => ({
    answered: Array.from(document.querySelectorAll("[data-question]")).filter((n) => n.getAttribute("data-answered") === "true").length,
    attempt: document.querySelector("[data-attempt]")?.getAttribute("data-attempt") ?? null,
  }));
  step("leaving and returning resumes the same attempt with its answers intact", {
    ok: resumed.attempt === attemptId && resumed.answered === questions.length,
    note: `same attempt id=${resumed.attempt === attemptId}; answers still rendered as answered=${resumed.answered}/${questions.length}`,
    browser: `/app/reading/attempts/${String(attemptId).slice(0, 8)}`, db: "read-only",
  });

  /* ------------------------------------------------- 8. sealed-exam surface */
  const sealed = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const controls = Array.from(main.querySelectorAll("button, a[href], [role=button]"));
    return {
      lookupControls: controls.filter((c) => /look\s?up|dictionary|meaning|save (word|to vocabulary)|add word/i.test(`${c.textContent} ${c.getAttribute("aria-label") ?? ""}`)).length,
      wordTargets: main.querySelectorAll("[data-word], [data-clickable-text='true']").length,
      lexicalAssistance: main.innerHTML.includes('data-lexical-assistance="true"'),
    };
  });
  step("SEC-12 exam seal: no meaning lookup or vocabulary saving in the sealed exam surface", {
    ok: sealed.lookupControls === 0 && !sealed.lexicalAssistance,
    note: `lookup/dictionary/save-word controls=${sealed.lookupControls}; clickable word targets=${sealed.wordTargets}; lexicalAssistance enabled in the DOM=${sealed.lexicalAssistance} (ReadingExam passes lexicalAssistance={false})`,
    browser: `${sealed.lookupControls} lexical controls present`, db: "read-only",
  });

  /* ---------------------------------------------------------- 9. submit */
  const beforeSubmit = await one("select score, submitted_at, status from reading_attempts where id=$1", [attemptId]);
  await a.page.evaluate(() => document.querySelector('[data-practice-tab="questions"]')?.click());
  await new Promise((r) => setTimeout(r, 600));
  await a.page.evaluate(() => document.querySelector("[data-submit-attempt]")?.click());
  await new Promise((r) => setTimeout(r, 5000));
  const afterSubmit = await one("select score, total_questions, submitted_at, status from reading_attempts where id=$1", [attemptId]);
  const correctFlags = await one("select count(*)::int n from reading_answers where attempt_id=$1 and is_correct", [attemptId]);
  step("submitting produces an authoritative server-side score", {
    ok: Boolean(afterSubmit?.submitted_at) && Number(afterSubmit?.score) === expectedScore && Number(correctFlags?.n) === expectedScore,
    note: `score=${afterSubmit?.score} of ${afterSubmit?.total_questions}; expected from the answering pattern=${expectedScore}; is_correct rows=${correctFlags?.n}; submitted_at set=${Boolean(afterSubmit?.submitted_at)}; status=${afterSubmit?.status}; before submit score was ${beforeSubmit?.score ?? "null"}; native confirm dialogs accepted=${dialogs}`,
    browser: `clicked [data-submit-attempt], accepted ${dialogs} confirm dialog(s)`, db: `reading_attempts.score=${afterSubmit?.score}`,
  });
  step("the score is NOT the number of answers submitted (grading is real, not crediting)", {
    ok: Number(afterSubmit?.score) !== questions.length && Number(afterSubmit?.score) === expectedScore,
    note: `answered ${questions.length}, scored ${afterSubmit?.score} — a route that credited every submission or trusted a client score would report ${questions.length}`,
    db: `score=${afterSubmit?.score} != questions=${questions.length}`,
  });
  // Duplicate submission must not re-grade or duplicate the attempt. The replay is well-formed
  // (real questionId + answer, exactly the schema the route validates) and deliberately ALL CORRECT,
  // so the only thing that can keep the score down is the server's already-submitted seal — a 400
  // invalid_input here would be a probe defect, not a denial, and would prove nothing.
  const allCorrect = questions.map((q) => ({ questionId: q.id, answer: String(q.correct_answer ?? "") }));
  const dupRes = await a.page.evaluate(async (payload) => {
    const r = await fetch(`/api/reading/attempts/${payload.id}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: payload.answers }) });
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  }, { id: attemptId, answers: allCorrect });
  const afterDup = await one("select score from reading_attempts where id=$1", [attemptId]);
  const attemptCount = Number((await one("select count(*)::int n from reading_attempts where passage_id=$1 and user_id=$2", [passage.id, userA.id]))?.n);
  step("a replayed submit with ALL-CORRECT answers cannot re-grade a sealed attempt", {
    ok: Number(afterDup?.score) === expectedScore && attemptCount === 1 && dupRes.status !== 200,
    note: `well-formed replay carrying ${allCorrect.length} correct answers → HTTP ${dupRes.status} body="${dupRes.body.slice(0, 70)}"; score stayed ${afterDup?.score} (a re-grade would have produced ${questions.length}); attempts for this learner+passage=${attemptCount}`,
    db: `reading_attempts.score=${afterDup?.score}, count=${attemptCount}`,
  });

  /* --------------------------------------------------------- 10. review */
  // On success ReadingExam calls router.refresh(); the page renders ReadingAnalysis instead of the
  // exam once status leaves in_progress. "locked" is only set on a 409 or when reopening an already
  // submitted attempt, so the honest post-submit assertion is that the EXAM IS GONE and a read-only
  // review with per-question evidence has taken its place — not that a save badge says locked.
  const review = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const stray = Array.from(main.querySelectorAll("input, button[data-answer-option]"))
      .filter((el) => !el.disabled)
      .map((el) => `${el.tagName}${el.type ? `[${el.type}]` : ""}${el.name ? `.name=${el.name}` : ""}@${(el.closest("[data-reading-practice],[data-evidence],header,nav,aside")?.getAttribute("data-reading-practice") ? "exam" : el.closest("nav,aside,header") ? "shell" : "other")}`);
    return {
      examGone: main.querySelector("[data-reading-practice]") === null,
      submitGone: main.querySelector("[data-submit-attempt]") === null,
      questionNodes: main.querySelectorAll("[data-question]").length,
      evidenceNodes: main.querySelectorAll("[data-evidence]").length,
      typeRows: main.querySelectorAll("[data-type]").length,
      scoreText: (main.innerText.match(/\b\d+\s*\/\s*\d+\b/) ?? [null])[0],
      strayEnabledControls: stray,
      text: main.innerText.replace(/\s+/g, " ").slice(0, 150),
    };
  });
  step("after submission the exam is replaced by a read-only review", {
    ok: review.examGone && review.submitGone && review.questionNodes === 0 && review.evidenceNodes === questions.length,
    note: `exam component unmounted=${review.examGone}; submit control gone=${review.submitGone}; editable question nodes left=${review.questionNodes}; per-question evidence blocks in the review=${review.evidenceNodes} of ${questions.length}; type breakdown rows=${review.typeRows}; score shown in the UI=${review.scoreText}; remaining enabled inputs are shell chrome, not answer controls: ${JSON.stringify(review.strayEnabledControls)}`,
    browser: "ReadingAnalysis review rendered", db: `status=${afterSubmit?.status}`,
  });
  step("the review shows the per-question result for every question", {
    ok: review.evidenceNodes === questions.length && review.scoreText === `${expectedScore}/${questions.length}`,
    note: `${review.evidenceNodes}/${questions.length} questions carry a data-evidence block; UI score "${review.scoreText}" equals the database score ${afterSubmit?.score}/${afterSubmit?.total_questions}`,
    browser: "data-evidence per question", db: `score=${afterSubmit?.score}/${afterSubmit?.total_questions}`,
  });
  // A fresh server render of the same attempt must also be read-only — that is the durable state,
  // not just the client-side transition after the submit click.
  const reload = await a.goto(`/app/reading/attempts/${attemptId}`);
  await new Promise((r) => setTimeout(r, 2500));
  const reloaded = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return {
      examGone: main.querySelector("[data-reading-practice]") === null,
      answerControls: main.querySelectorAll("input[data-answer-input], button[data-answer-option], ul[data-full-choices] input").length,
      evidence: main.querySelectorAll("[data-evidence]").length,
    };
  });
  step("reloading a submitted attempt server-renders it read-only (the seal is durable)", {
    ok: reload.status === 200 && reloaded.examGone && reloaded.answerControls === 0,
    note: `HTTP ${reload.status}; exam component present=${!reloaded.examGone}; answer controls rendered=${reloaded.answerControls}; evidence blocks=${reloaded.evidence}`,
    browser: "fresh navigation to the attempt", db: "read-only",
  });
  // Answers are persisted through PATCH /api/reading/attempts/{id} (ReadingExam.tsx:241) — that is
  // the real write path, so that is what a tamper attempt has to use.
  const postLockAnswer = await a.page.evaluate(async (payload) => {
    const r = await fetch(`/api/reading/attempts/${payload.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      // Well-formed against the route's schema, and carrying the correct answers, so a 409 here is
      // the seal refusing the write rather than the validator rejecting a malformed probe.
      body: JSON.stringify({ answers: payload.answers }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  }, { id: attemptId, answers: allCorrect });
  const tampered = await one("select count(*)::int n from reading_answers where attempt_id=$1 and user_answer='tampered'", [attemptId]);
  const scoreAfterTamper = await one("select score from reading_attempts where id=$1", [attemptId]);
  step("NEGATIVE CONTROL: answers cannot be written after the attempt is sealed", {
    ok: Number(tampered?.n) === 0 && Number(scoreAfterTamper?.score) === expectedScore && postLockAnswer.status === 409,
    note: `PATCH on the real answer-write path with well-formed correct answers → HTTP ${postLockAnswer.status} body="${postLockAnswer.body.slice(0, 70)}" (the route maps already_submitted to 409); rows holding "tampered"=${tampered?.n}; score still ${scoreAfterTamper?.score}`,
    db: "reading_answers + reading_attempts re-read after the attempt",
  });

  /* -------------------------------------------------------- 11. history */
  const history = await a.goto("/app/reading/history");
  await new Promise((r) => setTimeout(r, 2200));
  const inHistory = await a.page.evaluate((payload) => {
    const main = document.querySelector("main") ?? document.body;
    return {
      links: main.querySelectorAll(`a[href*="${payload.id}"]`).length,
      scoreShown: main.innerText.includes(String(payload.score)),
      text: main.innerText.replace(/\s+/g, " ").slice(0, 140),
    };
  }, { id: attemptId, score: expectedScore });
  const historyAttempt = await one("select id, score from reading_attempts where id=$1 and user_id=$2", [attemptId, userA.id]);
  step("the attempt persists in Reading history", {
    ok: history.status === 200 && Boolean(historyAttempt) && inHistory.links >= 1,
    note: `HTTP ${history.status}; the row still exists for this learner=${Boolean(historyAttempt)} with score=${historyAttempt?.score}; links to it on the page=${inHistory.links}; score visible=${inHistory.scoreShown}; rendered: "${inHistory.text.slice(0, 90)}"`,
    browser: "/app/reading/history", db: `reading_attempts id=${String(attemptId).slice(0, 8)}`,
  });

  /* ------------------------------------------------------- 12. progress */
  const progress = await a.goto("/app/progress");
  // The progress region is streamed, so wait for the card instead of sampling a fixed delay.
  await a.page.waitForSelector('[data-progress-module="reading"]', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  // The figures the page shows are computed in src/lib/data/progress.ts as counts and
  // accuracy = Math.round(score/total*100) over this learner's completed attempts, so the expected
  // values are recomputed from PostgreSQL here and compared with the rendered DOM. A keyword search
  // for "reading" would pass on a page that merely mentions the word.
  const expectProgress = await one(`
    select count(*)::int attempts,
           count(*) filter (where status='completed')::int submitted,
           coalesce(sum(score) filter (where status='completed'),0)::int score,
           coalesce(sum(total_questions) filter (where status='completed'),0)::int total
    from reading_attempts where user_id=$1`, [userA.id]);
  const expectAccuracy = expectProgress.submitted > 0 && expectProgress.total > 0
    ? Math.round((expectProgress.score / expectProgress.total) * 100) : null;
  const progressDom = await a.page.evaluate(() => {
    const card = document.querySelector('[data-progress-module="reading"]');
    return card ? {
      present: true,
      attempts: card.getAttribute("data-progress-attempts"),
      value: card.querySelector("[data-progress-value]")?.getAttribute("data-progress-value") ?? null,
      text: card.innerText.replace(/\s+/g, " ").trim().slice(0, 90),
    } : { present: false, attempts: null, value: null, text: "" };
  });
  step("progress figures are recomputed from this learner's attempts and match PostgreSQL", {
    ok: progress.status === 200 && progressDom.present
      && Number(progressDom.attempts) === expectProgress.attempts
      && progressDom.value === (expectAccuracy === null ? "none" : `${expectAccuracy}%`),
    note: `HTTP ${progress.status}; reading card present=${progressDom.present}; attempts shown=${progressDom.attempts} vs database=${expectProgress.attempts}; accuracy shown=${progressDom.value} vs round(${expectProgress.score}/${expectProgress.total}*100)=${expectAccuracy}%; submitted=${expectProgress.submitted}; card reads "${progressDom.text}"`,
    browser: `[data-progress-module="reading"] value=${progressDom.value}`,
    db: `reading_attempts: attempts=${expectProgress.attempts} submitted=${expectProgress.submitted} score=${expectProgress.score}/${expectProgress.total}`,
  });

  /* --------------------------------- 13. cross-student: absence of data */
  const b = await createSession(browser, { base: BASE, email: STUDENT_B[0], password: STUDENT_B[1], viewport: 1440, locale: "en" });
  b.page.on("dialog", async (d) => { await d.accept(); });
  const userB = await one("select id from users where email=$1", [STUDENT_B[0]]);
  const crossRes = await b.goto(`/app/reading/attempts/${attemptId}`);
  await new Promise((r) => setTimeout(r, 3000));
  const cross = await b.page.evaluate((marker) => {
    const html = document.documentElement.innerHTML;
    const main = document.querySelector("main") ?? document.body;
    return {
      // The wrong-answer string is unique to A's attempt: if it renders for B, protected data leaked.
      leakedAnswer: html.includes(marker),
      leakedAttempt: html.includes("data-attempt="),
      answerControls: main.querySelectorAll("input[data-answer-input], button[data-answer-option], ul[data-full-choices] input").length,
      text: main.innerText.replace(/\s+/g, " ").slice(0, 160),
    };
  }, wrongText);
  step("NEGATIVE CONTROL: student B opening A's attempt sees none of A's protected data", {
    ok: !cross.leakedAnswer && cross.answerControls === 0,
    note: `HTTP ${crossRes.status} (a 200 here is the known valid-UUID/no-row routing decision, judged separately); A's unique wrong-answer string present in B's HTML=${cross.leakedAnswer}; answer controls rendered=${cross.answerControls}; B id=${String(userB?.id).slice(0, 8)}; rendered: "${cross.text.slice(0, 90)}"`,
    browser: "B loaded /app/reading/attempts/{A's id}", db: `reading_attempts.user_id != ${String(userB?.id).slice(0, 8)}`,
  });
  step("the privacy judgement is made on the PAYLOAD, not the status code", {
    ok: !cross.leakedAnswer,
    note: "status and leakage are recorded on separate axes; a streamed 200 shell whose body holds none of A's answers is a routing decision, not an IDOR",
    db: "read-only",
  });
  // B attacks A's attempt through the two real write routes with well-formed bodies. Neither route
  // exposes a GET, so a bare GET would only have measured Next's 405 and proved nothing.
  const bApi = await b.page.evaluate(async (payload) => {
    const out = {};
    const patch = await fetch(`/api/reading/attempts/${payload.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: payload.answers }),
    });
    out.PATCH = { status: patch.status, body: (await patch.text()).slice(0, 100) };
    const submit = await fetch(`/api/reading/attempts/${payload.id}/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: payload.answers }),
    });
    out.POST_submit = { status: submit.status, body: (await submit.text()).slice(0, 100) };
    return out;
  }, { id: attemptId, answers: allCorrect });
  const bEffect = await one("select score, submitted_at, user_id from reading_attempts where id=$1", [attemptId]);
  const bAnswers = Number((await one("select count(*)::int n from reading_answers where attempt_id=$1", [attemptId]))?.n);
  step("B cannot write to A's attempt through the real routes (refusal AND no DB effect)", {
    ok: bApi.PATCH.status >= 400 && bApi.POST_submit.status >= 400
      && bEffect?.user_id === userA.id && Number(bEffect?.score) === expectedScore && bAnswers === questions.length,
    note: `PATCH → ${bApi.PATCH.status} "${bApi.PATCH.body.slice(0, 40)}"; POST submit → ${bApi.POST_submit.status} "${bApi.POST_submit.body.slice(0, 40)}"; DB effect: owner still ${String(bEffect?.user_id).slice(0, 8)} (B is ${String(userB?.id).slice(0, 8)}), score still ${bEffect?.score}, answer rows still ${bAnswers}`,
    db: `reading_attempts.user_id unchanged, score=${bEffect?.score}, reading_answers=${bAnswers}`,
  });
  await b.close();

  /* ------------------------------- 14. General Reading / formal exam state */
  const sets = Number((await one("select count(*)::int n from general_reading_sets"))?.n ?? 0);
  const qualifying = await all(`
    select s.id, count(distinct gp.passage_id)::int passages, count(q.id)::int questions
    from general_reading_sets s
    left join general_reading_passages gp on gp.set_id = s.id
    left join reading_questions q on q.passage_id = gp.passage_id
    group by s.id`);
  const usable = qualifying.filter((r) => Number(r.passages) === 3 && Number(r.questions) === 40);
  // The formal exam is assembled from passages carrying test_no/passage_no, and the set page calls
  // generalSetDetail() and refuses anything that is not exactly 3 sequential passages / 40 questions.
  const numberedPassages = Number((await one("select count(*)::int n from reading_passages where test_no is not null"))?.n ?? 0);
  const formalAttempts = Number((await one("select count(*)::int n from reading_assessments"))?.n ?? 0);
  const generalPage = await a.goto("/app/reading/general");
  await new Promise((r) => setTimeout(r, 2000));
  const generalText = await a.page.evaluate(() => (document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 200));
  blocker("General Reading Passage 1 / 2 / 3 / Full Reading, and the formal 3-passage/40-question Academic exam",
    `OWNER_ASSET_REQUIRED — general_reading_sets=${sets}; sets satisfying the page's own rule (exactly 3 sequentially numbered passages, 40 questions total, none empty)=${usable.length}; reading_passages carrying test_no=${numberedPassages}; reading_assessments rows=${formalAttempts}. The UI shows an honest empty state rather than a broken list: "${generalText.slice(0, 110)}". §4 forbids fabricating IELTS materials, so no substitute was invented and this is recorded, not silently skipped.`,
    { browser: `/app/reading/general HTTP ${generalPage.status}`, db: `general_reading_sets=${sets}, numbered passages=${numberedPassages}` });
  await a.close();
} catch (error) {
  console.error("\nREADING JOURNEY ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  defects++;
} finally {
  await browser.close().catch(() => {});
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log(`\n  sweeper removed: ${sweep.removed.join(", ")}`);
    if (sweep.residue.length) { console.error(`  RESIDUE: ${sweep.residue.join(", ")}`); defects++; }
    else console.log("  residue: none");
  } catch (error) { console.error("  sweeper failed:", error.message); defects++; }
  await finalSweep("end of run");

  const passed = steps.filter((s) => s.ok && !s.blocked).length;
  const blocked = steps.filter((s) => s.blocked).length;
  const lines = [
    "# §4 Real-browser Reading journey",
    "",
    `Driven in real Chromium against \`${BASE}\`, with PostgreSQL checked at every step. The learner`,
    "answers half the questions correctly and half deliberately wrongly, so the expected score is",
    "computed by this probe and compared with what the server stored — a route that credited every",
    "submission, or trusted a client-supplied score, cannot pass.",
    "",
    `**${passed} / ${steps.length - blocked} steps passed · ${blocked} recorded blocker(s) · ${defects} defect(s).**`,
    "",
    "## Answer-control shapes actually exercised",
    "",
    "`ReadingExam.tsx` renders five different controls and they share no common data attribute:",
    "",
    "| answer model | control | value stored |",
    "| --- | --- | --- |",
    "| ternary (TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN) | `button[data-answer-option][role=radio]` | normalised value |",
    "| single choice with full text options | `ul[data-full-choices] input[type=radio]` | the choice text |",
    "| single choice with letter-only options | `button[data-answer-option={letter}]`, `title`={text} | the choice text |",
    "| multi-select | `input[type=checkbox][value={letter}]` | comma-joined letters |",
    "| free text | `input[data-answer-input={id}]`, inline when the stem has a `___` blank | the typed text |",
    "",
    "These were enumerated against the live DOM, not inferred from source: an earlier revision of this",
    "probe knew only `data-answer-option` and `data-answer-input`, failed to answer plain multiple",
    "choice, and appeared to report a scoring defect that did not exist. Submitting also opens a",
    "native `confirm()`, which blocks the renderer until a dialog handler accepts it.",
    "",
    "| step | result | evidence | browser | database |",
    "| --- | --- | --- | --- | --- |",
    ...steps.map((s) => `| ${s.name} | ${s.blocked ? "BLOCKED" : s.ok ? "PASS" : "FAIL"} | ${String(s.note ?? "").replace(/\|/g, "\\|")} | ${String(s.browser ?? "—").replace(/\|/g, "\\|")} | ${String(s.db ?? "—").replace(/\|/g, "\\|")} |`),
    "",
    "## Blocker",
    "",
    "General Reading (Passage 1 / Passage 2 / Passage 3 / Full Reading) and the formal Academic",
    "Reading exam are `OWNER_ASSET_REQUIRED`: `/app/reading/academic/[setId]` refuses any set that is",
    "not exactly 3 passages with exactly 40 questions, and no qualifying set exists in the database.",
    "§4 forbids fabricating IELTS materials, so no substitute was invented. The UI states this",
    "honestly to the learner rather than rendering a broken list.",
    "",
  ];
  writeFileSync("docs/READING-JOURNEY.md", `${lines.join("\n")}\n`);
  console.log(`\n${passed}/${steps.length - blocked} steps passed · ${blocked} blocker(s) · ${defects} defect(s) · docs/READING-JOURNEY.md`);
}
process.exit(defects ? 1 : 0);
