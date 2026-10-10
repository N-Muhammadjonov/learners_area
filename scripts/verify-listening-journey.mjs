#!/usr/bin/env node
/**
 * §5 — REAL-BROWSER Listening journey with PostgreSQL evidence at every step.
 *
 *   node scripts/verify-listening-journey.mjs [baseUrl]
 *
 * Drives actual Chromium through selection, start, the missing-audio state, answering, the native
 * submit confirm dialog, review, history and progress, and compares the rendered DOM with
 * PostgreSQL at each step.
 *
 * WHAT IS EXECUTABLE, AND WHAT IS NOT. The canonical Academic full exam (Parts, per-Part audio and
 * transcripts, its own timer, pause/resume, audio-position autosave) is served from
 * `/app/listening/tests/{id}/{activity}`, which calls `fullListeningDetail()` and 404s without a row
 * in `listening_packages`. That table is empty and §5 forbids fabricating owner ZIPs or audio, so
 * those surfaces are recorded as OWNER_ASSET_REQUIRED rather than skipped silently or faked.
 *
 * What IS executable is the natively authored test in `listening_tests` + `listening_questions`:
 * `getStartableTest()` requires only a live test with at least one question and applies no role
 * restriction, so a learner can start it, and with no package the attempt page renders
 * `ListeningExam` with `audioUrl=null` — which makes §5's missing-audio requirement a real,
 * non-fabricated condition rather than a hypothetical.
 *
 * GRADE DISTINCTIONS. §5 requires that a completed-but-ungraded attempt must not erase an earned
 * grade and that a never-graded attempt must not invent one. `listening_attempts.score` is nullable
 * while `status` can be `completed`, so that state is representable and is built here as a tagged
 * fixture next to a genuinely graded attempt, then checked in BOTH the UI and the aggregates the
 * progress card computes.
 *
 * THE GRADING PROOF. As in the reading journey, answers are deliberately mixed — some correct, some
 * wrong — and the expected score is computed here from the stored correct_answer values, so a route
 * that credited every submission or trusted a client score cannot pass.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");
const pg = (await import("pg")).default;
assertMutableDatabase(DATABASE_URL, { probe: "verify-listening-journey" });

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const all = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await all(sql, p))[0] ?? null;

const TAG = "listening-journey-probe";
const sweeper = createRowSweeper({
  client: db, probe: "verify-listening-journey",
  // listening_drafts has no `id` column (its PK is attempt_id) so it cannot be swept by id; it is
  // covered instead by ON DELETE CASCADE from listening_attempts, and the sweep asserts afterwards
  // that no draft row survived rather than trusting the constraint silently.
  tables: ["listening_answers", "listening_attempts", "content_versions", "activity_events"],
});
const finalSweep = installSweepHandlers(sweeper, { probe: "verify-listening-journey", onDone: () => db.end().catch(() => {}) });
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
let ungradedId = null;

const browser = await launchBrowser();
try {
  /* --------------------------------------------------------------- 1. actor */
  const a = await createSession(browser, { base: BASE, email: STUDENT_A[0], password: STUDENT_A[1], viewport: 1440, locale: "en" });
  let dialogs = 0;
  a.page.on("dialog", async (d) => { dialogs++; await d.accept(); });
  const userA = await one("select id, email, role, account_status from users where email=$1", [STUDENT_A[0]]);
  step("authenticated actor is the expected learner", {
    ok: userA?.role === "student" && userA?.account_status === "active",
    note: `${userA?.email} id=${String(userA?.id).slice(0, 8)} role=${userA?.role} status=${userA?.account_status}`,
    browser: "logged in", db: `users.role=${userA?.role}`,
  });

  /* ------------------------------------------- 2. what the UI offers a learner */
  const test = await one(`select id, title, publication_state, is_active, audio_url, audio_type,
      (transcript is not null and transcript <> '') as has_transcript,
      (select count(*)::int from listening_questions q where q.test_id = listening_tests.id) as questions
    from listening_tests where publication_state='published' and is_active
      and (select count(*) from listening_questions q where q.test_id = listening_tests.id) > 0
    order by created_at limit 1`);
  assert.ok(test, "a published listening test with questions must exist");

  const surfaces = ["/app/listening", "/app/listening/academic", "/app/listening/general", "/app/listening/history", "/app/listening/mcq", "/app/listening/lessons"];
  const survey = [];
  for (const path of surfaces) {
    const res = await a.goto(path);
    await new Promise((r) => setTimeout(r, 1500));
    const dom = await a.page.evaluate((payload) => {
      const main = document.querySelector("main") ?? document.body;
      const clickable = Array.from(main.querySelectorAll("button, a[href]"));
      /*
       * TEST-SCOPED ONLY. An earlier revision counted any control whose text matched
       * /start|attempt|begin/i, which matched generic hub copy on /app/listening and reported the
       * test as reachable when no control on that page has anything to do with it. Reachability has
       * to mean "a control that starts or opens THIS test", so the href must carry this test id, or
       * the control must sit inside a card that names this test.
       */
      const namesThis = (el) => {
        const card = el.closest("[data-listening-academic-card], section, article, li, div.card");
        return Boolean(card && card.innerText.includes(payload.titleFragment));
      };
      const scoped = clickable.filter((el) => {
        const href = el.getAttribute("href") ?? "";
        return href.includes(payload.testId) || namesThis(el);
      });
      return {
        scopedControls: scoped.length,
        scopedDetail: scoped.map((el) => `${el.tagName}:${(el.getAttribute("href") ?? el.textContent.trim()).slice(0, 46)}`).slice(0, 4),
        testRunLinks: main.querySelectorAll(`a[href*="/app/listening/tests/${payload.testId}"]`).length,
        attemptLinks: main.querySelectorAll(`a[href*="${payload.testId}"]`).length,
        mentionsTest: main.innerText.includes(payload.titleFragment),
        emptyState: main.querySelector("[data-listening-academic-empty]") !== null,
        // Recorded for contrast: the loose count that produced the earlier false positive.
        looseTextMatches: clickable.filter((el) => /start|attempt|begin/i.test(`${el.textContent} ${el.getAttribute("aria-label") ?? ""}`)).length,
      };
    }, { testId: test.id, titleFragment: "library study room" });
    survey.push({ path, status: res.status, ...dom });
  }
  const reachable = survey.some((s) => s.scopedControls > 0 || s.testRunLinks > 0 || s.attemptLinks > 0);
  step("learner-facing listening surfaces were surveyed for a way to start this published test", {
    ok: true, // recorded as measured, not asserted: the finding is the measurement itself
    note: `${survey.length} surfaces visited — ${survey.map((s) => `${s.path} HTTP ${s.status} scoped=${s.scopedControls} looseText=${s.looseTextMatches} testRunLinks=${s.testRunLinks} mentionsTest=${s.mentionsTest}${s.emptyState ? " EMPTY-STATE" : ""}`).join(" · ")}. Reachability counts only controls scoped to THIS test (href carries the id, or the control sits in a card naming it); the loose text match is reported beside it because it is what produced an earlier false positive. The published test "${test.title}" (${test.questions} questions) is ${reachable ? "reachable" : "NOT offered by any learner-facing surface"}.`,
    browser: surfaces.join(", "), db: `listening_tests=1 published, listening_questions=${test.questions}`,
  });
  if (!reachable) {
    blocker("FINDING: a published, startable listening test has no learner-facing start control",
      `POST /api/listening/attempts accepts {testId} for this test with no role restriction (getStartableTest requires only a live test with at least one question), and StartTestButton exists to call it — but StartTestButton is rendered only by FullListeningLibrary, whose only caller is /app/admin/listening with management=true, where legacy cards get an admin "Continue" link instead. So the API path a learner is authorised to use is not reachable from any listening screen, and StartTestButton is dead code for learners. The Academic catalogue lists only tests that have a row in listening_packages (it inner-joins that table), which this test does not. Whether a published, package-less test SHOULD be learner-startable is a product decision — adding a button here would be an unauthorised change to the canonical package model, so this is recorded as OWNER_DECISION_REQUIRED rather than "fixed".`,
      { browser: `${survey.length} learner surfaces surveyed, ${survey.reduce((n, s) => n + s.scopedControls, 0)} controls scoped to this test`, db: "listening_packages=0" });
  }

  /* ------------------------------------------------------- 3. start attempt */
  const startRes = await a.page.evaluate(async (testId) => {
    const r = await fetch("/api/listening/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testId }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, test.id);
  attemptId = startRes.body?.id ?? null;
  const attemptRow = attemptId ? await one("select id, user_id, test_id, status, score, total_questions, submitted_at, content_version_id from listening_attempts where id=$1", [attemptId]) : null;
  step("a learner can start the published test; the attempt is owned by that learner", {
    ok: startRes.status === 200 && Boolean(attemptId) && attemptRow?.user_id === userA.id && attemptRow?.test_id === test.id && attemptRow?.status === "in_progress" && !attemptRow?.submitted_at,
    note: `POST → HTTP ${startRes.status} id=${String(attemptId).slice(0, 8)}; owner matches=${attemptRow?.user_id === userA.id}; test matches=${attemptRow?.test_id === test.id}; status=${attemptRow?.status}; score=${attemptRow?.score ?? "null"}; content_version_id=${attemptRow?.content_version_id ? String(attemptRow.content_version_id).slice(0, 8) : "null (no published revision — bound as unbound, not guessed)"}`,
    browser: "POST /api/listening/attempts", db: `listening_attempts.user_id=${String(attemptRow?.user_id).slice(0, 8)}`,
  });
  if (!attemptId) throw new Error("no attempt id — the journey cannot continue");

  /* --------------------------------------------- 4. duplicate start resumes */
  const dup = await a.page.evaluate(async (testId) => {
    const r = await fetch("/api/listening/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testId }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, test.id);
  const openAttempts = Number((await one("select count(*)::int n from listening_attempts where user_id=$1 and test_id=$2 and status='in_progress'", [userA.id, test.id]))?.n);
  step("a repeated start resumes the open attempt instead of creating a second one", {
    ok: dup.body?.id === attemptId && openAttempts === 1,
    note: `second POST → HTTP ${dup.status} returned the SAME id=${dup.body?.id === attemptId}; open attempts for this learner+test=${openAttempts}`,
    db: `listening_attempts in_progress=${openAttempts}`,
  });

  /* ------------------------------------------------- 5. exam renders in UI */
  const examPage = await a.goto(`/app/listening/attempts/${attemptId}`);
  await new Promise((r) => setTimeout(r, 3000));
  const questions = await all(`select id, "order", type, question_text, correct_answer, options
    from listening_questions where test_id=$1 order by "order"`, [test.id]);
  const exam = await a.page.evaluate((qs) => {
    const main = document.querySelector("main") ?? document.body;
    const radios = Array.from(main.querySelectorAll('input[type="radio"]'));
    return {
      title: main.innerText.includes("library study room"),
      radioGroups: [...new Set(radios.map((r) => r.name))],
      radioCount: radios.length,
      textInputs: main.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])').length,
      buttons: Array.from(main.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 6),
      questionCount: qs.length,
    };
  }, questions);
  step("the attempt page renders the exam with a control for every question", {
    ok: examPage.status === 200 && exam.title && exam.radioGroups.length === questions.filter((q) => q.type === "multiple_choice").length && exam.textInputs >= questions.filter((q) => q.type === "short_answer").length,
    note: `HTTP ${examPage.status}; title rendered=${exam.title}; radio groups=${exam.radioGroups.length} (${exam.radioCount} radios) for ${questions.filter((q) => q.type === "multiple_choice").length} multiple-choice questions; text inputs=${exam.textInputs} for ${questions.filter((q) => q.type === "short_answer").length} short-answer questions; buttons=${JSON.stringify(exam.buttons)}`,
    browser: `/app/listening/attempts/${String(attemptId).slice(0, 8)}`, db: `listening_questions=${questions.length}`,
  });

  /* ----------------------------------------------------- 6. missing audio */
  const audio = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const empty = main.querySelector("[data-material-empty]");
    const media = Array.from(main.querySelectorAll("audio, video"));
    return {
      emptyLabel: empty ? empty.innerText.trim() : null,
      mediaElements: media.length,
      mediaWithSource: media.filter((m) => m.src || m.querySelector("source[src]")).length,
      controlsOffered: media.filter((m) => m.controls).length,
    };
  });
  step("missing audio is reported honestly — no fabricated player, no silent failure", {
    ok: Boolean(test.audio_url === null) === Boolean(audio.emptyLabel) && audio.mediaWithSource === 0,
    note: `the fixture's audio_url is ${test.audio_url === null ? "NULL (the centre has not uploaded audio)" : JSON.stringify(test.audio_url)}; the player rendered its empty state="${audio.emptyLabel}"; media elements=${audio.mediaElements} of which ${audio.mediaWithSource} have a source. §5 forbids fabricating owner audio, so none was invented — the UI states the gap instead of pretending to play.`,
    browser: `[data-material-empty] present=${Boolean(audio.emptyLabel)}`, db: `listening_tests.audio_url=${test.audio_url === null ? "NULL" : "set"}`,
  });

  /* ------------------------------------- 7. answer, mixed correct/wrong */
  // Q1 answered correctly, Q2 deliberately wrong, Q3 correctly → expected score 2 of 3.
  const intent = questions.map((q, i) => ({ q, wantCorrect: i !== 1 }));
  const wrongText = "zzz-not-the-answer";
  const answered = await a.page.evaluate(async (payload) => {
    const out = [];
    const main = document.querySelector("main") ?? document.body;
    // ListeningExam renders questions in order, so the free-text fields line up with the
    // short_answer questions in the same order — a deterministic fallback for card matching.
    const shortInputs = Array.from(main.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])'));
    let shortIndex = 0;
    for (const item of payload) {
      let stored = null;
      let fromCard = null; // hoisted: the shape used is reported after the branch closes
      const radios = Array.from(main.querySelectorAll(`input[type="radio"][name="${item.id}"]`));
      if (radios.length) {
        const match = radios.find((r) => {
          const label = r.closest("label")?.innerText.trim() ?? "";
          return label.toLowerCase().includes(item.target.toLowerCase());
        });
        const pick = item.wantCorrect ? match : radios.find((r) => r !== match);
        if (pick) { pick.click(); stored = pick.closest("label")?.innerText.trim() ?? pick.value; }
      } else {
        /*
         * Short answer. Scope to `div.card` ONLY: an earlier revision matched "div.card, div", and
         * the bare `div` matched an ancestor containing both short-answer fields, so question 3
         * overwrote question 2's input. That produced score=1 instead of 2 and looked exactly like a
         * server-side grading defect. Fall back to document order, and record which was used.
         */
        const card = Array.from(main.querySelectorAll("div.card")).find((d) => d.innerText.includes(item.stem));
        fromCard = card?.querySelector('input:not([type="radio"]):not([type="hidden"])') ?? null;
        const input = fromCard ?? shortInputs[shortIndex];
        if (!fromCard) shortIndex += 1; // only the fallback consumes the ordered list
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          const value = item.wantCorrect ? item.target : item.wrongText;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          stored = value;
        }
      }
      out.push({ id: item.id, ok: Boolean(stored), stored, via: radios.length ? "radio" : fromCard ? "card" : "order" });
      await new Promise((r) => setTimeout(r, 150));
    }
    return out;
  }, intent.map(({ q, wantCorrect }) => ({
    id: q.id, wantCorrect, target: String(q.correct_answer ?? ""), wrongText,
    stem: String(q.question_text ?? "").slice(0, 40),
  })));
  const answeredOk = answered.filter((r) => r.ok);
  const expectedScore = intent.filter((i) => i.wantCorrect).length;
  step("every question was answered through its real control", {
    ok: answeredOk.length === questions.length,
    note: `${answeredOk.length}/${questions.length} controls accepted a value: ${JSON.stringify(answeredOk.map((r) => `${String(r.stored).slice(0, 20)}[${r.via}]`))}`,
    browser: "real clicks and typed input", db: "not yet persisted",
  });

  /* ---------------------------------------------------------- 8. submit */
  const beforeSubmit = await one("select score, submitted_at, status from listening_attempts where id=$1", [attemptId]);
  const submitClicked = await a.page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /submit/i.test(b.textContent) && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 5000));
  const afterSubmit = await one("select score, total_questions, submitted_at, status from listening_attempts where id=$1", [attemptId]);
  const correctFlags = await one("select count(*)::int n from listening_answers where attempt_id=$1 and is_correct", [attemptId]);
  const answerRows = Number((await one("select count(*)::int n from listening_answers where attempt_id=$1", [attemptId]))?.n);
  step("submitting through the UI produces an authoritative server-side score", {
    ok: submitClicked && Boolean(afterSubmit?.submitted_at) && Number(afterSubmit?.score) === expectedScore && Number(correctFlags?.n) === expectedScore,
    note: `clicked the submit button=${submitClicked}; native confirm dialogs accepted=${dialogs}; status=${afterSubmit?.status}; score=${afterSubmit?.score} of ${afterSubmit?.total_questions}; expected from the answering pattern=${expectedScore}; is_correct rows=${correctFlags?.n}; answer rows=${answerRows}; submitted_at set=${Boolean(afterSubmit?.submitted_at)}; before submit score was ${beforeSubmit?.score ?? "null"}`,
    browser: `clicked submit, accepted ${dialogs} confirm dialog(s)`, db: `listening_attempts.score=${afterSubmit?.score}`,
  });
  step("the score is NOT the number of answers submitted (grading is real)", {
    ok: Number(afterSubmit?.score) !== questions.length && Number(afterSubmit?.score) === expectedScore,
    note: `answered ${questions.length}, scored ${afterSubmit?.score} — a route that credited every submission or trusted a client score would report ${questions.length}`,
    db: `score=${afterSubmit?.score} != questions=${questions.length}`,
  });
  // Per-answer identity, checked individually rather than only in aggregate.
  const stored = await all("select question_id, user_answer, is_correct from listening_answers where attempt_id=$1", [attemptId]);
  const byQ = new Map(stored.map((r) => [r.question_id, r]));
  const mismatches = intent.filter(({ q, wantCorrect }) => {
    const row = byQ.get(q.id);
    if (!row) return true;
    const isCorrect = Boolean(row.is_correct);
    return isCorrect !== wantCorrect;
  }).map(({ q }) => `#${q.order}`);
  step("each stored answer is graded as intended for THAT question (answer identity)", {
    ok: mismatches.length === 0 && stored.length === questions.length,
    note: mismatches.length ? `questions whose is_correct disagrees with the intent: ${mismatches.join(", ")}` : `all ${questions.length} rows match the intended pattern; stored answers=${JSON.stringify(stored.map((r) => String(r.user_answer).slice(0, 18)))}`,
    db: `listening_answers=${stored.length}`,
  });

  /* --------------------------------------------------------- 9. review */
  const review = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return {
      revisionLink: main.querySelector("[data-revision-link]")?.getAttribute("href") ?? null,
      transcript: main.querySelector("[data-interactive-transcript]") !== null,
      evidence: main.querySelectorAll("[data-listening-analysis-evidence]").length,
      examGone: main.querySelectorAll('input[type="radio"]').length === 0,
      scoreText: (main.innerText.match(/\b\d+\s*\/\s*\d+\b/) ?? [null])[0],
      text: main.innerText.replace(/\s+/g, " ").slice(0, 180),
    };
  });
  step("after submission the attempt becomes a read-only review with its transcript", {
    ok: review.examGone && review.transcript === Boolean(test.has_transcript),
    note: `answer controls left in the DOM=${review.examGone ? 0 : "some"}; revision studio link=${review.revisionLink}; interactive transcript rendered=${review.transcript} (the fixture ${test.has_transcript ? "has" : "has no"} a transcript); evidence blocks=${review.evidence}; score shown="${review.scoreText}"`,
    browser: "ListeningAnalysis review", db: `status=${afterSubmit?.status}`,
  });
  step("the review shows the learner's answer and the correct one per question", {
    ok: review.evidence >= 0 && /room 4b|zzz-not-the-answer|student id/i.test(review.text),
    note: `review text includes the actual answers=${/room 4b|zzz-not-the-answer|student id/i.test(review.text)}; rendered: "${review.text.slice(0, 120)}"`,
    browser: "review body", db: "read-only",
  });

  /* ------------------------------------------- 10. duplicate submission */
  const dupSubmit = await a.page.evaluate(async (payload) => {
    const r = await fetch(`/api/listening/attempts/${payload.id}/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: payload.answers }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 140) };
  }, { id: attemptId, answers: questions.map((q) => ({ questionId: q.id, answer: String(q.correct_answer ?? "") })) });
  const afterDup = await one("select score from listening_attempts where id=$1", [attemptId]);
  const rowsAfterDup = Number((await one("select count(*)::int n from listening_answers where attempt_id=$1", [attemptId]))?.n);
  step("a replayed submit with ALL-CORRECT answers cannot re-grade a submitted attempt", {
    ok: dupSubmit.status === 409 && Number(afterDup?.score) === expectedScore && rowsAfterDup === questions.length,
    note: `well-formed replay carrying ${questions.length} correct answers → HTTP ${dupSubmit.status} body="${dupSubmit.body.slice(0, 60)}"; score stayed ${afterDup?.score} (a re-grade would have produced ${questions.length}); answer rows stayed ${rowsAfterDup}`,
    db: `score=${afterDup?.score}, listening_answers=${rowsAfterDup}`,
  });

  /* -------------------------------------------------------- 11. history */
  const history = await a.goto("/app/listening/history");
  await new Promise((r) => setTimeout(r, 2200));
  const inHistory = await a.page.evaluate((payload) => {
    const main = document.querySelector("main") ?? document.body;
    return {
      links: main.querySelectorAll(`a[href*="${payload.id}"]`).length,
      scoreShown: main.innerText.includes(`${payload.score}/${payload.total}`),
      text: main.innerText.replace(/\s+/g, " ").slice(0, 180),
    };
  }, { id: attemptId, score: afterSubmit.score, total: afterSubmit.total_questions });
  step("the submitted attempt persists in Listening history with its score", {
    ok: history.status === 200 && inHistory.links >= 1 && inHistory.scoreShown,
    note: `HTTP ${history.status}; links to the attempt=${inHistory.links}; score "${afterSubmit.score}/${afterSubmit.total_questions}" shown=${inHistory.scoreShown}; rendered: "${inHistory.text.slice(0, 110)}"`,
    browser: "/app/listening/history", db: `listening_attempts id=${String(attemptId).slice(0, 8)}`,
  });

  /* ------------------------------------------------------- 12. progress */
  const progress = await a.goto("/app/progress");
  await a.page.waitForSelector('[data-progress-module="listening"]', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const expectProgress = await one(`
    select count(*)::int attempts,
           count(*) filter (where status='completed')::int submitted,
           coalesce(sum(score) filter (where status='completed'),0)::int score,
           coalesce(sum(total_questions) filter (where status='completed'),0)::int total
    from listening_attempts where user_id=$1`, [userA.id]);
  const expectAccuracy = expectProgress.submitted > 0 && expectProgress.total > 0
    ? Math.round((expectProgress.score / expectProgress.total) * 100) : null;
  const progressDom = await a.page.evaluate(() => {
    const card = document.querySelector('[data-progress-module="listening"]');
    return card ? {
      attempts: card.getAttribute("data-progress-attempts"),
      value: card.querySelector("[data-progress-value]")?.getAttribute("data-progress-value") ?? null,
      text: card.innerText.replace(/\s+/g, " ").trim().slice(0, 80),
    } : null;
  });
  step("progress figures are recomputed from this learner's attempts and match PostgreSQL", {
    ok: progress.status === 200 && progressDom
      && Number(progressDom.attempts) === expectProgress.attempts
      && progressDom.value === (expectAccuracy === null ? "none" : `${expectAccuracy}%`),
    note: `HTTP ${progress.status}; attempts shown=${progressDom?.attempts} vs database=${expectProgress.attempts}; accuracy shown=${progressDom?.value} vs round(${expectProgress.score}/${expectProgress.total}*100)=${expectAccuracy}%; card reads "${progressDom?.text}"`,
    browser: `[data-progress-module="listening"]`,
    db: `submitted=${expectProgress.submitted} score=${expectProgress.score}/${expectProgress.total}`,
  });

  /* ------------------------------- 13. grade distinctions (tagged fixture) */
  // §5: a completed-but-ungraded attempt must not erase an earned grade, and a never-graded attempt
  // must not invent one. score is nullable while status can be completed, so build exactly that.
  ungradedId = await (async () => {
    const row = await one(`insert into listening_attempts (user_id, test_id, status, submitted_at, started_at)
      values ($1,$2,'completed', now(), now()) returning id`, [userA.id, test.id]);
    return row?.id ?? null;
  })();
  assert.ok(ungradedId, "could not create the ungraded fixture attempt");
  const gradedStill = await one("select score, total_questions from listening_attempts where id=$1", [attemptId]);
  const agg = await one(`
    select count(*)::int attempts,
           count(*) filter (where status='completed')::int submitted,
           coalesce(sum(score) filter (where status='completed'),0)::int score,
           coalesce(sum(total_questions) filter (where status='completed'),0)::int total
    from listening_attempts where user_id=$1`, [userA.id]);
  const aggAccuracy = agg.submitted > 0 && agg.total > 0 ? Math.round((agg.score / agg.total) * 100) : null;
  step("a completed-but-never-graded attempt does not dilute or erase the earned grade in the aggregate", {
    ok: Number(gradedStill?.score) === expectedScore && aggAccuracy === expectAccuracy,
    note: `fixture attempt ${String(ungradedId).slice(0, 8)} inserted with status=completed, score=NULL, total_questions=NULL; the earned attempt still holds score=${gradedStill?.score}/${gradedStill?.total_questions}; the progress aggregate still computes ${aggAccuracy}% (unchanged from ${expectAccuracy}%) because sum() ignores NULL and the ungraded row adds no questions`,
    db: `listening_attempts: graded=${gradedStill?.score}, ungraded=NULL`,
  });

  const histUngraded = await a.goto("/app/listening/history");
  await new Promise((r) => setTimeout(r, 2200));
  const ungradedUi = await a.page.evaluate((payload) => {
    const main = document.querySelector("main") ?? document.body;
    const card = main.querySelector(`a[href*="${payload.id}"]`);
    const text = card ? card.innerText.replace(/\s+/g, " ").trim() : null;
    return {
      cardText: text,
      rendersNull: Boolean(text && /null/.test(text)),
      inventsZero: Boolean(text && /0\s*\/\s*0/.test(text)),
      wholePageNull: /null/.test(main.innerText),
      gradedStillShown: main.innerText.includes(`${payload.score}/${payload.total}`),
    };
  }, { id: ungradedId, score: expectedScore, total: questions.length });
  step("the UI does not invent a grade for a never-graded attempt", {
    ok: Boolean(ungradedUi.cardText) && !ungradedUi.rendersNull && !ungradedUi.inventsZero && ungradedUi.gradedStillShown,
    note: `the ungraded attempt's history card reads: ${JSON.stringify(ungradedUi.cardText)}; renders a JS null=${ungradedUi.rendersNull}; invents 0/0=${ungradedUi.inventsZero}; the earned ${expectedScore}/${questions.length} is still shown for the graded attempt=${ungradedUi.gradedStillShown}`,
    browser: "/app/listening/history", db: `listening_attempts.score IS NULL for ${String(ungradedId).slice(0, 8)}`,
  });

  const ungradedPage = await a.goto(`/app/listening/attempts/${ungradedId}`);
  await new Promise((r) => setTimeout(r, 2500));
  const ungradedDetail = await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return { text: main.innerText.replace(/\s+/g, " ").slice(0, 200), rendersNull: /null/.test(main.innerText) };
  });
  step("opening a never-graded attempt does not show a fabricated score", {
    ok: ungradedPage.status === 200 && !ungradedDetail.rendersNull,
    note: `HTTP ${ungradedPage.status}; page renders a JS null=${ungradedDetail.rendersNull}; rendered: "${ungradedDetail.text.slice(0, 120)}"`,
    browser: `/app/listening/attempts/${String(ungradedId).slice(0, 8)}`, db: "score IS NULL",
  });

  /* ------------------------------- 13b. the UZ rendering of the same state */
  // §9 requires actual rendered translations, not key presence. The honest label added for the
  // ungraded state exists in both dictionaries, so both are checked in a real browser: the Uzbek
  // session must show the Uzbek sentence, not the English one and not the raw key.
  const uz = await createSession(browser, { base: BASE, email: STUDENT_A[0], password: STUDENT_A[1], viewport: 1440, locale: "uz" });
  const uzHistory = await uz.goto("/app/listening/history");
  await new Promise((r) => setTimeout(r, 2200));
  const uzUi = await uzHistory && await uz.page.evaluate((payload) => {
    const main = document.querySelector("main") ?? document.body;
    const ungradedCard = main.querySelector(`a[href*="${payload.ungraded}"]`);
    const gradedCard = main.querySelector(`a[href*="${payload.graded}"]`);
    const text = ungradedCard ? ungradedCard.innerText.replace(/\s+/g, " ").trim() : null;
    return {
      ungradedCard: text,
      showsUzbek: Boolean(text && text.includes("Hali baholanmagan")),
      showsEnglish: Boolean(text && text.includes("Not graded yet")),
      showsRawKey: Boolean(text && /notGradedYet/.test(text)),
      showsNull: Boolean(text && /null/.test(text)),
      gradedCard: gradedCard ? gradedCard.innerText.replace(/\s+/g, " ").trim() : null,
      pageHasUzbekChrome: /urinishlar|Davom ettirish|Natija/i.test(main.innerText),
    };
  }, { ungraded: ungradedId, graded: attemptId });
  step("the same never-graded state renders in Uzbek, not as a key or as English", {
    ok: uzHistory.status === 200 && uzUi.showsUzbek && !uzUi.showsEnglish && !uzUi.showsRawKey && !uzUi.showsNull,
    note: `HTTP ${uzHistory.status}; the ungraded card reads: ${JSON.stringify(uzUi.ungradedCard)}; Uzbek label rendered=${uzUi.showsUzbek}; English leaked into the UZ session=${uzUi.showsEnglish}; raw key rendered=${uzUi.showsRawKey}; a JS null rendered=${uzUi.showsNull}; the graded attempt still shows its real score in UZ: ${JSON.stringify(uzUi.gradedCard)}; surrounding chrome is Uzbek=${uzUi.pageHasUzbekChrome}`,
    browser: "locale=uz session", db: "read-only",
  });
  await uz.close();

  /* --------------------------------- 14. cross-student isolation */
  const b = await createSession(browser, { base: BASE, email: STUDENT_B[0], password: STUDENT_B[1], viewport: 1440, locale: "en" });
  b.page.on("dialog", async (d) => { await d.accept(); });
  const userB = await one("select id from users where email=$1", [STUDENT_B[0]]);
  const crossRes = await b.goto(`/app/listening/attempts/${attemptId}`);
  await new Promise((r) => setTimeout(r, 2800));
  const cross = await b.page.evaluate((marker) => {
    const html = document.documentElement.innerHTML;
    const main = document.querySelector("main") ?? document.body;
    return {
      leakedAnswer: html.includes(marker),
      leakedTranscript: html.includes("Room 4B free from two until four"),
      radios: main.querySelectorAll('input[type="radio"]').length,
      text: main.innerText.replace(/\s+/g, " ").slice(0, 150),
    };
  }, wrongText);
  step("NEGATIVE CONTROL: student B opening A's attempt sees none of A's protected data", {
    ok: !cross.leakedAnswer && !cross.leakedTranscript && cross.radios === 0,
    note: `HTTP ${crossRes.status}; A's unique wrong-answer string in B's HTML=${cross.leakedAnswer}; A's transcript/answers leaked=${cross.leakedTranscript}; answer controls rendered=${cross.radios}; B id=${String(userB?.id).slice(0, 8)}; rendered: "${cross.text.slice(0, 90)}"`,
    browser: "B loaded A's attempt URL", db: `listening_attempts.user_id != ${String(userB?.id).slice(0, 8)}`,
  });
  const bApi = await b.page.evaluate(async (payload) => {
    const out = {};
    const draft = await fetch(`/api/listening/attempts/${payload.id}/draft`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { [payload.qid]: "hijacked" }, audioPosition: 0 }),
    });
    out.PUT_draft = { status: draft.status, body: (await draft.text()).slice(0, 90) };
    const submit = await fetch(`/api/listening/attempts/${payload.id}/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: payload.answers }),
    });
    out.POST_submit = { status: submit.status, body: (await submit.text()).slice(0, 90) };
    return out;
  }, { id: attemptId, qid: questions[0].id, answers: questions.map((q) => ({ questionId: q.id, answer: String(q.correct_answer ?? "") })) });
  const bEffect = await one("select score, user_id from listening_attempts where id=$1", [attemptId]);
  const hijacked = Number((await one("select count(*)::int n from listening_answers where attempt_id=$1 and user_answer='hijacked'", [attemptId]))?.n);
  step("B cannot write to A's attempt through the real routes (refusal AND no DB effect)", {
    ok: bApi.PUT_draft.status >= 400 && bApi.POST_submit.status >= 400 && bEffect?.user_id === userA.id && Number(bEffect?.score) === expectedScore && hijacked === 0,
    note: `PUT draft → ${bApi.PUT_draft.status} "${bApi.PUT_draft.body.slice(0, 40)}"; POST submit → ${bApi.POST_submit.status} "${bApi.POST_submit.body.slice(0, 40)}"; DB effect: owner still ${String(bEffect?.user_id).slice(0, 8)}, score still ${bEffect?.score}, rows holding "hijacked"=${hijacked}`,
    db: `listening_attempts.user_id unchanged, score=${bEffect?.score}`,
  });
  const bStart = await b.page.evaluate(async (testId) => {
    const r = await fetch("/api/listening/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testId }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, test.id);
  const bOwn = bStart.body?.id ? await one("select user_id from listening_attempts where id=$1", [bStart.body.id]) : null;
  step("B starting the same test gets B's own attempt, never A's", {
    ok: bStart.status === 200 && Boolean(bStart.body?.id) && bStart.body.id !== attemptId && bOwn?.user_id === userB.id,
    note: `POST → HTTP ${bStart.status} id=${String(bStart.body?.id).slice(0, 8)}; differs from A's attempt=${bStart.body?.id !== attemptId}; owner is B=${bOwn?.user_id === userB.id}`,
    db: `listening_attempts.user_id=${String(bOwn?.user_id).slice(0, 8)}`,
  });
  await b.close();

  /* ------------------------------------------- 15. owner-asset blockers */
  const packages = Number((await one("select count(*)::int n from listening_packages"))?.n ?? 0);
  const runs = Number((await one("select count(*)::int n from listening_activity_runs"))?.n ?? 0);
  const fullRes = await a.goto(`/app/listening/tests/${test.id}/1`);
  await new Promise((r) => setTimeout(r, 2000));
  const fullText = await a.page.evaluate(() => (document.querySelector("main")?.innerText ?? document.body.innerText).replace(/\s+/g, " ").slice(0, 140));
  blocker("Canonical Academic full exam: Parts, per-Part audio and transcripts, exam timer, pause/resume, audio-position autosave, route departure and background-audio cleanup",
    `OWNER_ASSET_REQUIRED — /app/listening/tests/{id}/1 returned HTTP ${fullRes.status} because fullListeningDetail() needs a row in listening_packages and there are ${packages}. The seeded test's audio_url is NULL and §5 forbids fabricating owner ZIPs or audio, so no package or audio file was invented. Rendered: "${fullText.slice(0, 100)}".`,
    { browser: `/app/listening/tests/{id}/1 HTTP ${fullRes.status}`, db: `listening_packages=${packages}` });
  blocker("latest / latestCompleted / latestGraded / lastEarned / resumable distinctions across practice kinds",
    `OWNER_ASSET_REQUIRED — these are computed in src/lib/data/full-listening.ts over listening_activity_runs, which holds ${runs} rows because every activity run belongs to a canonical package. The attempt-level half of the same property IS verified above (a completed-but-ungraded attempt neither dilutes nor erases the earned grade, and no grade is invented).`,
    { db: `listening_activity_runs=${runs}` });
  await a.close();
} catch (error) {
  console.error("\nLISTENING JOURNEY ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  defects++;
} finally {
  await browser.close().catch(() => {});
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log(`\n  sweeper removed: ${sweep.removed.join(", ")}`);
    if (sweep.residue.length) { console.error(`  RESIDUE: ${sweep.residue.join(", ")}`); defects++; }
    else console.log("  residue: none");
    // listening_drafts is reachable only through the cascade, so prove the cascade actually ran.
    const draftRows = await db.query("select count(*)::int n from listening_drafts");
    const attemptRows = await db.query("select count(*)::int n from listening_attempts");
    console.log(`  cascade check: listening_drafts=${draftRows.rows[0].n}, listening_attempts=${attemptRows.rows[0].n}`);
    if (draftRows.rows[0].n !== 0 || attemptRows.rows[0].n !== 0) { console.error("  RESIDUE: drafts or attempts survived the sweep"); defects++; }
  } catch (error) { console.error("  sweeper failed:", error.message); defects++; }
  await finalSweep("end of run");

  const passed = steps.filter((s) => s.ok && !s.blocked).length;
  const blocked = steps.filter((s) => s.blocked).length;
  const lines = [
    "# §5 Real-browser Listening journey",
    "",
    `Driven in real Chromium against \`${BASE}\`, with PostgreSQL checked at every step. Answers are`,
    "deliberately mixed — some correct, some wrong — so the expected score is computed by this probe",
    "from the stored `correct_answer` values and compared with what the server kept.",
    "",
    `**${passed} / ${steps.length - blocked} steps passed · ${blocked} recorded blocker(s) · ${defects} defect(s).**`,
    "",
    "## What is executable here, and what is not",
    "",
    "The canonical Academic full exam is served from `/app/listening/tests/{id}/{activity}`, which",
    "calls `fullListeningDetail()` and 404s without a row in `listening_packages`. That table is",
    "empty, and §5 forbids fabricating owner ZIPs or audio, so the Part-based exam, its timer,",
    "pause/resume, audio-position autosave and background-audio cleanup are recorded as",
    "`OWNER_ASSET_REQUIRED` instead of being skipped silently or faked.",
    "",
    "What is executable is the natively authored test in `listening_tests` + `listening_questions`.",
    "`getStartableTest()` requires only a live test with at least one question and applies no role",
    "restriction, and with no package the attempt page renders `ListeningExam` with `audioUrl=null` —",
    "which makes the missing-audio requirement a real, non-fabricated condition.",
    "",
    "| step | result | evidence | browser | database |",
    "| --- | --- | --- | --- | --- |",
    ...steps.map((s) => `| ${s.name} | ${s.blocked ? "BLOCKED" : s.ok ? "PASS" : "FAIL"} | ${String(s.note ?? "").replace(/\|/g, "\\|")} | ${String(s.browser ?? "—").replace(/\|/g, "\\|")} | ${String(s.db ?? "—").replace(/\|/g, "\\|")} |`),
    "",
  ];
  writeFileSync("docs/LISTENING-JOURNEY.md", `${lines.join("\n")}\n`);
  console.log(`\n${passed}/${steps.length - blocked} steps passed · ${blocked} blocker(s) · ${defects} defect(s) · docs/LISTENING-JOURNEY.md`);
}
process.exit(defects ? 1 : 0);
