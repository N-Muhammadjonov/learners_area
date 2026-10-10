#!/usr/bin/env node
/**
 * PRIORITY E — a question that was never graded must not be presented as a wrong answer.
 *
 *   node scripts/verify-listening-verdicts.mjs [base]
 *
 * `listening_answers.is_correct` is a NULLABLE boolean, so the database distinguishes three facts:
 * graded wrong (false), no verdict reached (NULL), and — by the absence of a row — never answered.
 * ListeningAnalysis tested `a?.isCorrect` for truthiness in three places at once (card border, badge,
 * answer-key reveal), and NULL, false and "no row" are all falsy. A completed-but-ungraded attempt
 * therefore painted EVERY question red with an "Incorrect" badge: a grading verdict nobody had
 * reached, implying the learner earned zero, while the header directly above correctly said
 * "Not graded yet". The same screen contradicted itself.
 *
 * This probe builds the five states the database can actually hold and reads what the browser
 * renders, in English and in Uzbek. The verdict sequence asserted in the DOM is recomputed from the
 * rows in PostgreSQL rather than hardcoded beside them, so "the UI agrees with the database" is the
 * claim being tested and not an assumption both sides share.
 */
import pg from "pg";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }
const { assertMutableDatabase, createRowSweeper } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-listening-verdicts" });
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const sweeper = createRowSweeper({
  client, probe: "listening-verdicts",
  tables: ["listening_answers", "listening_attempts", "activity_events"],
});
await sweeper.capture();

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** The verdict the DATABASE says this question has — the oracle the DOM is compared against. */
const verdictFromRow = (row) => row === undefined ? "unanswered" : row.is_correct === null ? "notGraded" : row.is_correct ? "correct" : "incorrect";

const browser = await launchBrowser();
const attemptIds = [];
try {
  const student = (await q("select id from users where email='demo.student@learnersarea.uz'"))[0].id;
  const test = (await q("select id from listening_tests order by created_at limit 1"))[0].id;
  const questions = await q('select id, "order", correct_answer from listening_questions where test_id=$1 order by "order"', [test]);
  if (questions.length < 3) throw new Error(`need at least 3 questions to build the mixed state, found ${questions.length}`);

  /** Create one finished attempt with the given per-question answer rows. */
  async function attempt(label, { score, total, answers }) {
    const [row] = await q(
      `insert into listening_attempts (user_id, test_id, status, score, total_questions, submitted_at)
       values ($1,$2,'completed',$3,$4, now()) returning id`,
      [student, test, score, total],
    );
    for (const [index, spec] of answers.entries()) {
      if (spec === null) continue; // no row at all: the learner never answered this question
      await q(
        `insert into listening_answers (attempt_id, question_id, user_answer, is_correct) values ($1,$2,$3,$4)`,
        [row.id, questions[index].id, spec.userAnswer, spec.isCorrect],
      );
    }
    attemptIds.push(row.id);
    return row.id;
  }

  const GRADED = await attempt("graded", {
    score: 2, total: 3,
    answers: [
      { userAnswer: "Room 4B", isCorrect: true },
      { userAnswer: "Room 5A", isCorrect: false },
      { userAnswer: "student id", isCorrect: true },
    ],
  });
  const UNGRADED = await attempt("ungraded", {
    score: null, total: null,
    answers: [
      { userAnswer: "Room 4B", isCorrect: null },
      { userAnswer: "7", isCorrect: null },
      { userAnswer: "library card", isCorrect: null },
    ],
  });
  const PARTIAL = await attempt("partial", {
    score: 1, total: 3,
    // A historical attempt: one graded right, one answered but never graded, one never answered.
    answers: [{ userAnswer: "Room 4B", isCorrect: true }, { userAnswer: "9", isCorrect: null }, null],
  });

  const LABELS = {
    en: { correct: "Correct", incorrect: "Incorrect", notGraded: "Not graded", unanswered: "Not answered", notGradedYet: "Not graded yet" },
    uz: { correct: "To'g'ri", incorrect: "Noto'g'ri", notGraded: "Baholanmagan", unanswered: "Javob berilmagan", notGradedYet: "Hali baholanmagan" },
  };

  for (const locale of ["en", "uz"]) {
    const session = await createSession(browser, {
      base: BASE, email: "demo.student@learnersarea.uz", password: "Student12345!", viewport: 390, locale,
    });
    console.log(`\n  ── locale ${locale.toUpperCase()} ──`);

    for (const [name, id] of [["GRADED", GRADED], ["UNGRADED", UNGRADED], ["PARTIAL/HISTORICAL", PARTIAL]]) {
      await session.goto(`/app/listening/attempts/${id}`);
      await session.page.waitForSelector("[data-listening-verdict]", { timeout: 20000 }).catch(() => {});

      const dom = await session.page.evaluate(() => {
        const cards = [...document.querySelectorAll("[data-listening-verdict]")];
        return {
          verdicts: cards.map((c) => c.getAttribute("data-listening-verdict")),
          borders: cards.map((c) => c.className),
          badges: cards.map((c) => c.querySelector("[data-listening-verdict-label]")?.textContent?.trim() ?? ""),
          /*
           * Whether the answer key is shown for each question, read from the element that renders it
           * rather than from its text. Matching on text was wrong twice over: an anchored pattern
           * could never match a key inside "Correct answer: 3", and excluding the learner's own
           * answer by the English phrase silently stopped working in Uzbek — which is how one
           * detector reported the same "y n y" for three attempts with three different answer sets.
           */
          keys: cards.map((c) => c.querySelector("[data-listening-answer-key]") !== null),
          bodyText: document.body.innerText,
        };
      });

      // Recompute the expected verdicts FROM THE DATABASE, in question order.
      const rows = await q("select question_id, is_correct from listening_answers where attempt_id=$1", [id]);
      const byQuestion = new Map(rows.map((r) => [r.question_id, r]));
      const expected = questions.map((question) => verdictFromRow(byQuestion.get(question.id)));
      const [dbScore] = await q("select score, total_questions from listening_attempts where id=$1", [id]);
      const expectedHeader = dbScore.score === null || dbScore.total_questions === null
        ? LABELS[locale].notGradedYet
        : `${dbScore.score}/${dbScore.total_questions}`;

      check(`${name}: the rendered verdicts match the database rows`,
        JSON.stringify(dom.verdicts) === JSON.stringify(expected),
        `db=${expected.join(",")} · dom=${dom.verdicts.join(",") || "(none rendered)"}`);

      check(`${name}: the header shows the database score, not an invented one`,
        dom.bodyText.includes(expectedHeader),
        `expected "${expectedHeader}" (score=${dbScore.score}, total=${dbScore.total_questions})`);

      const labelOk = dom.verdicts.every((v, i) => dom.badges[i] === LABELS[locale][v]);
      check(`${name}: every badge carries the ${locale.toUpperCase()} label for its own verdict`,
        labelOk, dom.badges.map((b, i) => `${dom.verdicts[i]}="${b}"`).join(" "));

      // The defect itself: a state with no verdict must not wear the failure colours.
      const ungradedIdx = dom.verdicts.map((v, i) => ({ v, i })).filter((x) => x.v === "notGraded" || x.v === "unanswered");
      const wronglyRed = ungradedIdx.filter((x) => /band-bad/.test(dom.borders[x.i]) || dom.badges[x.i] === LABELS[locale].incorrect);
      check(`${name}: no ungraded or unanswered question is painted as a failure`,
        wronglyRed.length === 0,
        ungradedIdx.length === 0 ? "no such question in this attempt"
          : wronglyRed.length ? `${wronglyRed.length} question(s) still rendered with the bad band or the "${LABELS[locale].incorrect}" label`
          : `${ungradedIdx.length} ungraded/unanswered question(s) all rendered neutral`);

      const neutralOk = ungradedIdx.every((x) => /border-ink-100/.test(dom.borders[x.i]));
      check(`${name}: ungraded and unanswered questions use the neutral token, not a band colour`,
        ungradedIdx.length === 0 || neutralOk,
        ungradedIdx.length === 0 ? "n/a" : neutralOk ? "border-ink-100 on all of them" : dom.borders.filter((_, i) => ungradedIdx.some((u) => u.i === i)).join(" | ").slice(0, 120));

      // Answer-key visibility is preserved for a finished attempt: shown unless graded correct.
      const keyExpected = dom.verdicts.map((v) => v !== "correct");
      check(`${name}: the authorized answer key is shown for every question that is not graded correct`,
        JSON.stringify(dom.keys) === JSON.stringify(keyExpected),
        `shown=${dom.keys.map((k) => (k ? "y" : "n")).join("")} expected=${keyExpected.map((k) => (k ? "y" : "n")).join("")}`);
    }

    // The specific contradiction that was reported: the ungraded attempt must not say "Incorrect"
    // anywhere while its header says the work has not been graded.
    await session.goto(`/app/listening/attempts/${UNGRADED}`);
    await session.page.waitForSelector("[data-listening-verdict]", { timeout: 20000 }).catch(() => {});
    const ungradedText = await session.page.evaluate(() => document.body.innerText);
    check(`UNGRADED: the page never claims a wrong answer while saying it is not graded (${locale.toUpperCase()})`,
      ungradedText.includes(LABELS[locale].notGradedYet) && !ungradedText.includes(LABELS[locale].incorrect),
      `header "${LABELS[locale].notGradedYet}" present=${ungradedText.includes(LABELS[locale].notGradedYet)}; "${LABELS[locale].incorrect}" present=${ungradedText.includes(LABELS[locale].incorrect)}`);

    check(`${locale.toUpperCase()}: no console errors while reviewing any of the three attempts`,
      session.consoleErrors.length === 0,
      session.consoleErrors.length ? session.consoleErrors.slice(0, 2).join(" | ") : "0 errors");
    await session.close();
  }
} catch (error) {
  console.error("\nABORTED:", error?.message ?? error);
  failures.push("aborted");
} finally {
  const { removed, residue } = await sweeper.sweep();
  console.log(`\n  sweeper removed: ${removed.join(", ") || "nothing"}`);
  console.log(`  residue: ${residue.length ? residue.join(", ") : "none"}`);
  if (residue.length) failures.push("residue");
  const orphaned = await q("select count(*)::int n from listening_answers a where not exists (select 1 from listening_attempts t where t.id = a.attempt_id)").catch(() => [{ n: -1 }]);
  console.log(`  orphaned answer rows: ${orphaned[0].n}`);
  await client.end().catch(() => {});
  await browser.close().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
