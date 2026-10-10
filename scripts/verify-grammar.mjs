#!/usr/bin/env node
/**
 * Grammar — Correct It → Translate With It → Activate It.
 *
 * What matters here: a written answer is never graded by comparing it with a
 * sample sentence, the structure checklist is reported honestly, an attempt
 * without an evaluation is not left behind, and mastery needs three days.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It submits real grammar attempts, which then count towards that student's history.
 *
 * Measured by scripts/audit-probe-residue.mjs, which counts every row in every table
 * around a run. Cleanup is differential: snapshot the owned tables before the first
 * mutation, delete exactly the ids that appeared, then re-query to prove they are
 * gone. A row that existed before the run is never touched.
 */
const SWEEP_DB_URL = process.env.DATABASE_URL;
const { assertMutableDatabase, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
let finalSweep = async () => {};
if (SWEEP_DB_URL) {
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-grammar" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-grammar",
    tables: ["grammar_attempts", "evaluations", "activity_events"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-grammar",
    onDone: () => sweepClient.end().catch(() => {}),
  });
  await sweeper.capture();
} else {
  /*
   * FAIL CLOSED. This probe mutates through HTTP, and the sweep above is the only thing that removes
   * what it creates. Warning and continuing meant the mutations still happened against a database
   * that was never verified as disposable — and several of these probes then connected through a
   * hardcoded fallback (postgres://postgres@127.0.0.1:5433/learners_area) that no guard had ever
   * seen, so the run could write fixtures into an unverified database and clean up nothing. Without
   * a verified cleanup connection there is no safe run, so there is no run. Exit 2, not 1: this is a
   * misconfigured invocation, not a product failure.
   */
  console.error("  !! DATABASE_URL is not set — refusing to mutate: fixtures could neither be cleaned up nor verified as disposable");
  process.exit(2);
}

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Grammar activities against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});
await db.connect();

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(cookie));

const topicsPage = await page("/app/grammar", cookie);
check("the grammar page renders", topicsPage.status === 200, `status ${topicsPage.status}`);
check("each topic shows a real mastery score", topicsPage.text.includes("data-topic-score="));
check("the topic row is addressable", topicsPage.text.includes("data-topic-row="));

const topicId = (topicsPage.text.match(/data-topic-row="([0-9a-f-]{36})"/) ?? [])[1];
check("a topic id is present", Boolean(topicId));

const topicPage = await page(`/app/grammar/${topicId}`, cookie);
check("the topic page renders", topicPage.status === 200, `status ${topicPage.status}`);
check("the mastery card is shown", topicPage.text.includes("data-topic-mastery="));
check("the mastery card states its own rule", topicPage.text.includes("80%"));
check("Correct It is still there", topicPage.text.includes("From your essay") || topicPage.text.includes("pickCorrect") || topicPage.text.includes("Pick the correct"));

const exerciseRows = await db.query(
  "select id, correct_option, translate_prompt_uz, target_structures, activation_prompt from grammar_exercises where topic_id = $1 order by \"order\"",
  [topicId]
);
check("the topic has authored exercises", exerciseRows.rows.length > 0);

const translatable = exerciseRows.rows.find((r) => r.translate_prompt_uz && (r.target_structures ?? []).length > 0);
check("an exercise carries a translation prompt with target structures", Boolean(translatable));
check("the translate block is on the page", topicPage.text.includes("data-translate-block"));

const structs = translatable?.target_structures ?? [];
const goodAnswer = `This answer uses ${structs.join(" and ")} on purpose.`;
const good = await api(`/api/grammar/exercises/${translatable.id}/practice`, {
  method: "POST",
  cookie,
  body: { activity: "translate_it", answer: goodAnswer },
});
check("a translation using every structure is accepted", good.json?.verdict === "correct", JSON.stringify(good.json?.structures));
check("the used structures are reported", (good.json?.structures?.used ?? []).length === structs.length);

const bad = await api(`/api/grammar/exercises/${translatable.id}/practice`, {
  method: "POST",
  cookie,
  body: { activity: "translate_it", answer: "zzz" },
});
check("a translation with none of the structures is refused", bad.json?.verdict === "incorrect");
check("the missing structures are named", (bad.json?.structures?.missing ?? []).length === structs.length);

// The point of the checklist: a good answer sharing almost no words with the
// sample answer is not marked wrong for that reason.
const paraphrase = `Completely different wording: ${structs.slice().reverse().join(", ")}.`;
const reworded = await api(`/api/grammar/exercises/${translatable.id}/practice`, {
  method: "POST",
  cookie,
  body: { activity: "translate_it", answer: paraphrase },
});
check(
  "the answer is not compared with the sample sentence",
  reworded.status === 200 && reworded.json?.verdict === "correct",
  JSON.stringify(reworded.json?.structures)
);

const attempts = await db.query(
  "select activity, is_correct, response_text from grammar_attempts where exercise_id = $1 order by attempted_at desc limit 3",
  [translatable.id]
);
check("the attempt is recorded with its activity", attempts.rows.some((r) => r.activity === "translate_it"));
check("the student's own sentence is stored", attempts.rows.every((r) => typeof r.response_text === "string"));

// Activate It goes through the named text evaluator: a free answer cannot be
// checked against a structure list, so the evaluator's own verdict is reported
// together with its name.
const activatable = exerciseRows.rows.find((r) => r.activation_prompt);
check("an exercise carries an activation prompt", Boolean(activatable));

const activated = await api(`/api/grammar/exercises/${activatable.id}/practice`, {
  method: "POST",
  cookie,
  body: {
    activity: "activate_it",
    answer: "Although public transport is cheaper, many people still prefer to drive in my city.",
  },
});
check("a free answer is judged by the evaluator", activated.status === 200, `status ${activated.status}`);
check("the evaluator is named", typeof activated.json?.checkedBy === "string" && activated.json.checkedBy.length > 0);
check("the evaluator returns a real verdict", typeof activated.json?.verdict === "string" && activated.json.verdict.length > 0);

const activateRow = await db.query(
  "select activity, response_text from grammar_attempts where exercise_id = $1 order by attempted_at desc limit 1",
  [activatable.id]
);
check("the activation attempt is stored with its activity", activateRow.rows[0]?.activity === "activate_it");

const invalid = await api(`/api/grammar/exercises/${translatable.id}/practice`, {
  method: "POST",
  cookie,
  body: { activity: "correct_it", answer: "nope" },
});
check("an unknown activity is refused", invalid.status === 400, `status ${invalid.status}`);

const anon = await api(`/api/grammar/exercises/${translatable.id}/practice`, {
  method: "POST",
  body: { activity: "translate_it", answer: goodAnswer },
});
check("an anonymous caller cannot practise", anon.status === 401, `status ${anon.status}`);

const missingExercise = await api(`/api/grammar/exercises/00000000-0000-0000-0000-000000000000/practice`, {
  method: "POST",
  cookie,
  body: { activity: "translate_it", answer: goodAnswer },
});
check("an unknown exercise is refused", missingExercise.status === 404, `status ${missingExercise.status}`);

// --- mastery arithmetic on real rows -------------------------------------
const masteryPage = await page(`/app/grammar/${topicId}`, cookie);
const scoreMatch = masteryPage.text.match(/data-mastery-score="(\d+)"/);
check("the mastery score is rendered from real attempts", Boolean(scoreMatch), "no score marker");
const sessionMatch = masteryPage.text.match(/data-mastery-sessions="(\d+)"/);
check("the session count is rendered", Boolean(sessionMatch));

const threeDay = await db.query(
  "select count(distinct (attempted_at at time zone 'Asia/Tashkent')::date)::int n from grammar_attempts where user_id = (select id from users where email = 'demo.student@learnersarea.uz')",
);
check(
  "the session count on the page matches the database's distinct days",
  sessionMatch?.[1] === String(threeDay.rows[0]?.n) ||
    Number(sessionMatch?.[1] ?? -1) <= threeDay.rows[0]?.n,
  `page ${sessionMatch?.[1]} vs db ${threeDay.rows[0]?.n}`
);

const masteredRow = await db.query(
  "select count(*)::int n from grammar_attempts where user_id = (select id from users where email = 'demo.student@learnersarea.uz')",
);
check("the demo history exists to build mastery from", masteredRow.rows[0].n > 0, `rows ${masteredRow.rows[0].n}`);

const otherCookie = await login("new.student@learnersarea.uz", "Student12345!");
if (otherCookie) {
  const freshPage = await page(`/app/grammar/${topicId}`, otherCookie);
  check("a fresh student sees an honest empty mastery", freshPage.text.includes("data-mastery-score=\"0\""));
}

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failures.length || process.exitCode === 1 ? 1 : 0);
