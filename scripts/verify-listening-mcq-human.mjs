#!/usr/bin/env node
/**
 * THE DEDICATED LISTENING MCQ PROGRAMME — the owner's human journey, end to end.
 *
 *   AUTH_SECRET=<the server's own secret> BASE_URL=http://127.0.0.1:3100 \
 *   DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   node scripts/verify-listening-mcq-human.mjs
 *
 * Run against a BUILT server (`npx next start`) and real PostgreSQL (QA2). Every step is real
 * HTTP with a real session, over fixtures that are written, walked and then DELETED, with the
 * cleanup asserted at the end.
 *
 * The journey the owner described, in order:
 *
 *   1. Listening (the hub) → the fourth destination, Listening MCQ.
 *   2. The programme home: only the days the centre published, with this learner's own status.
 *   3. DAY 1: five questions, "Question 1 of 5", one at a time.
 *   4. The staged drill over the API: notes → own answer → reveal → choose → reason. At no stage
 *      does the payload carry a question's options before `revealed` or its key before `chosen`,
 *      and no rendered page carries either.
 *   5. Four questions finished, the fifth committed → the home page says "In progress 4/5" and
 *      the day resumes on question 5 at the stage it was left at.
 *   6. All five finished → the day is Completed, and the home page says so.
 *   7. Day 2 is still Not started; a draft day is invisible to a learner.
 *   8. Academic Listening and General Listening are exactly as they were.
 *   9. ANOTHER learner opens the same day fresh — no leaked notes, no inherited progress.
 *
 * What this script does NOT claim: pointer gestures, audio decoding and visual paint are not
 * measurable through HTTP. Those remain EXTERNALLY UNVERIFIED here.
 */
import pg from "pg";
import { SignJWT } from "jose";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set to the server's own secret");
assertIsolatedTarget(DATABASE_URL);

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(name);
};
const step = (n, text) => console.log(`\n— step ${n}: ${text}`);

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

/**
 * The scenario's own namespace. Everything it writes carries this prefix so the cleanup can prove
 * it removed every row it wrote — and nothing that was already there.
 */
const PREFIX = "qa2-mcqhuman-";
const PROGRAMME = "listening-mcq-program";
const OWNER_EMAIL = `${PREFIX}owner@learners-qa.invalid`;
const LEARNER_EMAIL = `${PREFIX}learner@learners-qa.invalid`;
const OTHER_EMAIL = `${PREFIX}other@learners-qa.invalid`;

/** Five authored MCQs per day: the owner's material, here plainly QA material. */
const QUESTIONS = [
  { text: "Which platform does the train leave from?", options: ["A) Platform 2", "B) Platform 7"], key: "B", why: "The announcement names platform seven." },
  { text: "How long is the delay?", options: ["A) Ten minutes", "B) Twenty minutes"], key: "A", why: "Ten minutes is stated twice." },
  { text: "What is the passenger asked to do?", options: ["A) Keep the ticket", "B) Move to coach C"], key: "B", why: "The guard asks passengers to move." },
  { text: "Which day is the ticket valid?", options: ["A) Today", "B) Tomorrow"], key: "A", why: "The ticket is for the same day." },
  { text: "Where is the lost property office?", options: ["A) By the entrance", "B) On platform 7"], key: "A", why: "It is beside the main entrance." },
];

const HIDDEN_NOTE = "QA-NOTE-KEEP-PRIVATE";
const HIDDEN_REASON = "QA-REASONING-KEEP-PRIVATE";

async function cookieFor(user) {
  const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `la_session=${token}; la_locale=en`;
}
const get = async (path, cookie) => {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
};
const send = async (method, path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** The learner's card for one day, cut out of the rendered home page so status can be read. */
const cardOf = (html, day) => {
  const start = html.indexOf(`data-listening-mcq-card="${day}"`);
  return start === -1 ? null : html.slice(start, start + 900);
};

/**
 * One authored DAY: a programme row with its explicit ordinal, five `mcq_single` questions in
 * authored order, a live revision and an audio address. This is the shape the import door writes,
 * stated here so the journey does not depend on the door's own convenience.
 */
async function createDay({ day, state = "published", title }) {
  const [test] = await q(
    `insert into listening_tests (created_by_user_id, title, audio_type, audio_url, source_ref, publication_state, publish_at, program_ref, program_ordinal)
     values ($1, $2, 'audio', $3, $4, $5::publication_state, now(), $6, $7) returning id`,
    [ownerId, title, `qa2/${PREFIX}day-${day}.mp3`, `${PREFIX}day-${day}`, state, PROGRAMME, day],
  );
  const questionIds = [];
  for (const [index, question] of QUESTIONS.entries()) {
    const [row] = await q(
      `insert into listening_questions (test_id, "order", question_text, correct_answer, explanation, type, options, type_code)
       values ($1, $2, $3, $4, $5, 'multiple_choice', $6::jsonb, 'mcq_single') returning id`,
      [test.id, index + 1, question.text, question.key, question.why, JSON.stringify(question.options)],
    );
    questionIds.push(row.id);
  }
  await q(
    `insert into content_versions (module, content_type, source_ref, version_no, status, title, content_snapshot, content_hash, semantic_hash, answer_key_hash, target_type, target_id, created_by_user_id)
     values ('listening', 'full_test', $1, 1, 'published', $2, $3::jsonb, $4, $4, $4, 'listening_test', $5, $6)`,
    [`${PREFIX}day-${day}`, title, JSON.stringify({ questions: QUESTIONS.length }), "0".repeat(64), test.id, ownerId],
  );
  return { testId: test.id, questionIds };
}

/**
 * Walk ONE question through the whole drill, exactly one legal step at a time, and assert the
 * server's own secrecy at every stage. Returns the question's final stage.
 */
async function drill(question, cookie, { stopAt = "reasoned", from = "listen" } = {}) {
  const opened = await send("POST", "/api/listening/mcq", { questionId: question.id }, cookie);
  if (opened.status !== 200 || !opened.body?.session?.id) {
    check(`drill ${question.order} opens a session`, false, `status ${opened.status} ${JSON.stringify(opened.body)}`);
    return null;
  }
  const sessionId = opened.body.session.id;
  check(`drill ${question.order} resumes at expected stage with nothing shown yet`, opened.body.session.stage === from && (from === "reasoned" || (opened.body.options === null && opened.body.correctAnswer === null && opened.body.explanation === null && opened.body.outcome === null)), JSON.stringify({ stage: opened.body.session.stage, options: opened.body.options, key: opened.body.correctAnswer }));

  let payload = opened.body;
  const steps = [
    { step: "notes", text: HIDDEN_NOTE },
    { step: "committed", text: "my own answer, from what I heard" },
    { step: "revealed", text: undefined },
    { step: "chosen", text: question.options.find(option => option === question.key || option.startsWith(`${question.key})`)) },
    { step: "reasoned", text: HIDDEN_REASON },
  ];
  for (const [index, move] of steps.entries()) {
    if (index <= steps.findIndex(candidate => candidate.step === from)) continue;
    // Stop before the last step when the scenario wants the question left mid-drill.
    if (stopAt !== "reasoned" && index >= steps.findIndex((candidate) => candidate.step === stopAt) + 1) break;
    const body = move.text === undefined ? { step: move.step } : { step: move.step, text: move.text };
    const res = await send("PATCH", `/api/listening/mcq/${sessionId}`, body, cookie);
    if (res.status !== 200) {
      check(`drill ${question.order} step '${move.step}' is accepted`, false, `status ${res.status} ${JSON.stringify(res.body)}`);
      return null;
    }
    payload = res.body;
    check(`drill ${question.order} step '${move.step}' lands on stage '${move.step}'`, payload.session.stage === move.step, `stage ${payload.session.stage}`);

    // THE STAGED SECRECY, from the server's own answer rather than from the page's markup.
    if (move.step === "notes" || move.step === "committed") {
      check(`drill ${question.order} hides the options until the reveal`, payload.options === null && payload.correctAnswer === null, JSON.stringify({ options: payload.options, key: payload.correctAnswer }));
      check(`drill ${question.order} hides the outcome until a choice is made`, payload.outcome === null && payload.explanation === null);
    }
    if (move.step === "revealed") {
      check(`drill ${question.order} reveals the real options at the reveal`, Array.isArray(payload.options) && payload.options.length === 2 && payload.correctAnswer === null, JSON.stringify({ options: payload.options, key: payload.correctAnswer }));
    }
    if (move.step === "chosen") {
      check(`drill ${question.order} judges the choice against the authored key`, payload.outcome === "correct" && payload.correctAnswer === question.key && typeof payload.explanation === "string", JSON.stringify({ outcome: payload.outcome, key: payload.correctAnswer }));
    }
    if (move.step === "reasoned") check(`drill ${question.order} closes with no further step`, payload.next === null);
  }
  return { sessionId, stage: payload.session.stage };
}

let ownerId = null;
let learnerId = null;
let otherId = null;
let learnerCookie = null;
let otherCookie = null;
let dayOne = null;
let dayTwo = null;
let dayThree = null;

async function cleanup() {
  // FK order: staged work, then the questions and their revisions, then the days themselves.
  await q(`delete from listening_mcq_sessions where user_id = any($1::uuid[]) or test_id = any($2::uuid[])`, [[learnerId, otherId].filter(Boolean), [dayOne?.testId, dayTwo?.testId, dayThree?.testId].filter(Boolean)]);
  await q(`delete from listening_questions where test_id = any($1::uuid[])`, [[dayOne?.testId, dayTwo?.testId, dayThree?.testId].filter(Boolean)]);
  await q(`delete from content_versions where source_ref like $1`, [`${PREFIX}%`]);
  await q(`delete from listening_tests where source_ref like $1`, [`${PREFIX}%`]);
  await q(`delete from users where email like $1`, [`${PREFIX}%@learners-qa.invalid`]);
}

try {
  console.log("=== THE MCQ PROGRAMME — the human journey, on the built server ===");

  step(1, "the fixtures: two published days of five authored MCQs, one draft day, three accounts");
  const [owner] = await q(
    `insert into users (name, email, role, account_status) values ('QA MCQ owner', $1, 'owner', 'active') returning id`,
    [OWNER_EMAIL],
  );
  const [learner] = await q(
    `insert into users (name, email, role, account_status) values ('QA MCQ learner', $1, 'student', 'active') returning id`,
    [LEARNER_EMAIL],
  );
  const [other] = await q(
    `insert into users (name, email, role, account_status) values ('QA MCQ other learner', $1, 'student', 'active') returning id`,
    [OTHER_EMAIL],
  );
  ownerId = owner.id;
  learnerId = learner.id;
  otherId = other.id;
  learnerCookie = await cookieFor({ id: learner.id, role: "student", name: "QA MCQ learner" });
  otherCookie = await cookieFor({ id: other.id, role: "student", name: "QA MCQ other learner" });
  dayOne = await createDay({ day: 1, title: `${PREFIX}Day 1 — station announcements` });
  dayTwo = await createDay({ day: 2, title: `${PREFIX}Day 2 — travel plans` });
  dayThree = await createDay({ day: 3, title: `${PREFIX}Day 3 — not published yet`, state: "draft" });
  check("F1 two published days carry five questions each", dayOne.questionIds.length === 5 && dayTwo.questionIds.length === 5);
  check("F2 the days are in the programme by authored ordinal", (await q(`select count(*)::int n from listening_tests where program_ref = $1 and program_ordinal in (1,2,3)`, [PROGRAMME]))[0].n === 3);

  step(2, "Listening → the fourth destination");
  const hub = await get("/app/listening", learnerCookie);
  check("J1 the Listening hub offers the owner's four destinations", hub.status === 200 && ["lessons", "academic", "general", "mcq"].every((key) => hub.text.includes(`data-listening-destination="${key}"`)), `status ${hub.status}`);
  check("J2 the hub lists no content of its own", !hub.text.includes(`${PREFIX}Day 1`), "the hub rendered a day card");
  const mcqHome = await get("/app/listening/mcq", learnerCookie);
  check("J3 the MCQ destination opens the programme home", mcqHome.status === 200 && mcqHome.text.includes('data-route-usable="listening-mcq"'));

  step(3, "the programme home states only what is true");
  check("J4 the home lists the published days", Boolean(cardOf(mcqHome.text, 1) && cardOf(mcqHome.text, 2)));
  check("J5 the draft day is not rendered as a card", !mcqHome.text.includes('data-listening-mcq-card="3"'), "a draft day reached a learner");
  check("J6 the home never claims thirty days of content", !/Day (9|1[0-9]|2[0-9]|30)\b/.test(mcqHome.text.replace(/30 days|thirty/gi, "")), "a day nobody authored was rendered");
  check("J7 a day nobody has opened is honestly 'Not started'", cardOf(mcqHome.text, 2)?.includes("Not started"), "the card guesses a status");
  check("J8 each card states the authored day and its real question count", /Day 1/.test(cardOf(mcqHome.text, 1) ?? "") && /5 questions/.test(cardOf(mcqHome.text, 1) ?? ""), cardOf(mcqHome.text, 1)?.slice(0, 200));

  step(4, "open DAY 1 — five questions, one at a time");
  const dayPage = await get("/app/listening/mcq/day/1", learnerCookie);
  check("J9 the day page opens DAY 1", dayPage.status === 200 && dayPage.text.includes('data-listening-mcq-day="1"'), `status ${dayPage.status}`);
  check("J10 the day starts at 0/5", dayPage.text.includes('data-listening-mcq-day-progress="0/5"') && dayPage.text.includes("Question 1 of 5"), "the day did not start honestly");
  check("J11 the day's own navigation offers positions 1…5", [1, 2, 3, 4, 5].every((position) => dayPage.text.includes(`data-listening-mcq-day-step="${position}"`)));
  check("J12 the navigation states positions, never the questions behind them", !dayPage.text.includes(QUESTIONS[1].text) && !dayPage.text.includes(QUESTIONS[4].text), "a question leaked from the day's navigation");
  check("J13 the page carries no option and no key", QUESTIONS.every((question) => question.options.every((option) => !dayPage.text.includes(option))) && !dayPage.text.includes("The announcement names platform seven"), "the rendered page leaked an option or a key");
  check("J14 the authored audio address reaches the drill (player opens with the session)", dayPage.text.includes(`qa2/${PREFIX}day-1.mp3`));

  // The exact owner resume scenario: two reasoned, third committed, fourth/fifth untouched.
  for (let index = 0; index < 3; index++) {
    await drill({id: dayOne.questionIds[index], order: index+1, ...QUESTIONS[index]}, learnerCookie, {stopAt: index === 2 ? "committed" : "reasoned"});
  }
  const atThree = await get("/app/listening/mcq/day/1", learnerCookie);
  check("R1 two finished; Q3 resumes committed; Q4/Q5 untouched", atThree.text.includes('data-listening-mcq-day-progress="2/5"') && atThree.text.includes("Question 3 of 5") && (await q(`select stage from listening_mcq_sessions where user_id=$1 order by (select \"order\" from listening_questions q where q.id=question_id)`,[learnerId])).map(r=>r.stage).join(",") === "reasoned,reasoned,committed");
  step(5, "walk four questions through the drill, leave the fifth committed mid-drill");
  const stages = [];
  for (const [index, questionId] of dayOne.questionIds.entries()) {
    const question = { id: questionId, order: index + 1, options: QUESTIONS[index].options, key: QUESTIONS[index].key };
    const result = await drill(question, learnerCookie, { stopAt: index === 4 ? "committed" : "reasoned", from: index < 2 ? "reasoned" : index === 2 ? "committed" : "listen" });
    if (result) stages.push(result.stage);
  }
  check("J15 four questions reached 'reasoned' and the fifth stopped at 'committed'", JSON.stringify(stages) === JSON.stringify(["reasoned", "reasoned", "reasoned", "reasoned", "committed"]), JSON.stringify(stages));
  const stored = await q(`select stage from listening_mcq_sessions where user_id = $1 and test_id = $2 order by (select "order" from listening_questions q where q.id = question_id)`, [learnerId, dayOne.testId]);
  check("J16 the stages are in the SERVER's own rows", stored.map((row) => row.stage).join(",") === "reasoned,reasoned,reasoned,reasoned,committed", stored.map((row) => row.stage).join(","));

  step(6, "the home page follows, and the day resumes where it stopped");
  const homeAfterFour = await get("/app/listening/mcq", learnerCookie);
  const cardOne = cardOf(homeAfterFour.text, 1);
  check("J17 the card says 'In progress' with the truthful 4/5", Boolean(cardOne && /In progress/.test(cardOne) && /4\s*\/\s*5/.test(cardOne)), cardOne?.slice(0, 220));
  check("J18 the card's action is 'Continue', not 'Start'", Boolean(cardOne && /data-listening-mcq-action="continue"/.test(cardOne)), cardOne?.slice(0, 220));
  const resumed = await get("/app/listening/mcq/day/1", learnerCookie);
  check("J19 the day resumes on question 5", resumed.text.includes("Question 5 of 5"), "the day restarted at question 1");
  check("J20 the resumed day still carries no option and no key", !resumed.text.includes("Which day is the ticket valid") && !resumed.text.includes("The ticket is for the same day."), "the resumed page leaked the next question's material");
  check("J21 the navigation marks the four finished questions and the one in progress", /data-listening-mcq-day-step-state="completed"/.test(resumed.text) && /data-listening-mcq-day-step-state="in_progress"/.test(resumed.text));

  step(7, "finish the fifth question");
  const fifthQuestion = await q(`select id from listening_questions where test_id = $1 and "order" = 5`, [dayOne.testId]);
  const finish = await drill({ id: fifthQuestion[0].id, order: 5, options: QUESTIONS[4].options, key: QUESTIONS[4].key }, learnerCookie, {from: "committed"});
  check("J22 the fifth question closes the drill", finish?.stage === "reasoned", JSON.stringify(finish));
  const completedHome = await get("/app/listening/mcq", learnerCookie);
  const completedCard = cardOf(completedHome.text, 1);
  check("J23 DAY 1 is Completed", Boolean(completedCard && /data-listening-mcq-card-status="completed"/.test(completedCard) && /Completed/.test(completedCard)), completedCard?.slice(0, 220));
  check("J24 completion is the day's own, not a percentage or a band", !/%/.test(completedCard ?? "") && !/\b(band|score)\b/i.test(completedCard ?? ""), completedCard?.slice(0, 220));
  const completedPage = await get("/app/listening/mcq/day/1", learnerCookie);
  check("J25 the day page reads 5/5 with 'Practice complete'", completedPage.text.includes('data-listening-mcq-day-progress="5/5"') && completedPage.text.includes("Practice complete"));
  check("J26 reviewing the finished day does not destroy the work", (await q(`select count(*)::int n from listening_mcq_sessions where user_id = $1 and test_id = $2 and stage = 'reasoned'`, [learnerId, dayOne.testId]))[0].n === 5);
  check("J27 DAY 2 is still 'Not started'", Boolean(cardOf(completedHome.text, 2)?.includes("Not started")));

  step(8, "Academic Listening and General Listening are exactly as they were");
  const academic = await get("/app/listening/academic", learnerCookie);
  const general = await get("/app/listening/general", learnerCookie);
  check("J28 the Academic catalogue still opens", academic.status === 200 && academic.text.includes('data-route-usable="listening-academic"'), `status ${academic.status}`);
  check("J29 an MCQ day is not filed as an Academic test", !academic.text.includes(`${PREFIX}Day 1`));
  check("J30 the General catalogue still opens", general.status === 200 && general.text.includes('data-route-usable="listening-general"'), `status ${general.status}`);
  check("J31 an MCQ day is not offered as a General section", !general.text.includes(`${PREFIX}Day 1`));
  check("J32 the day page stays inside the programme", !dayPage.text.includes('data-listening-academic-activity') && !dayPage.text.includes("data-listening-exam-sections") && !dayPage.text.includes("data-part-"), "a day was presented as an exam");

  step(9, "another learner opens the same day fresh");
  const otherHome = await get("/app/listening/mcq", otherCookie);
  check("J33 the other learner's card is 'Not started', not this learner's 5/5", Boolean(cardOf(otherHome.text, 1)?.includes("Not started") && !cardOf(otherHome.text, 1)?.includes("5/5")), cardOf(otherHome.text, 1)?.slice(0, 200));
  const otherDay = await get("/app/listening/mcq/day/1", otherCookie);
  check("J34 their day starts at 0/5", otherDay.text.includes('data-listening-mcq-day-progress="0/5"'));
  check("J35 the first learner's private notes and reasoning are nowhere in their page", !otherDay.text.includes(HIDDEN_NOTE) && !otherDay.text.includes(HIDDEN_REASON) && !otherHome.text.includes(HIDDEN_NOTE), "one learner's private work leaked into another's page");
  const otherSessions = await q(`select id from listening_mcq_sessions where user_id = $1 and question_id = $2`, [otherId, dayOne.questionIds[0]]);
  check("J36 they have no session yet of their own", otherSessions.length === 0);
  const stranger = await send("GET", `/api/listening/mcq/${(await q(`select id from listening_mcq_sessions where user_id = $1 limit 1`, [learnerId]))[0].id}`, undefined, otherCookie);
  check("J37 another account cannot open a session that is not theirs", stranger.status === 404, `status ${stranger.status}`);
  const foreignQuestion = await send("POST", "/api/listening/mcq", { questionId: fifthQuestion[0].id }, otherCookie);
  check("J38 the other learner may start their OWN session on the same question", foreignQuestion.status === 200 && foreignQuestion.body?.session?.stage === "listen" && foreignQuestion.body?.options === null, `status ${foreignQuestion.status} ${JSON.stringify(foreignQuestion.body?.session)}`);

  step(10, "a day the centre has not published stays invisible to a learner");
  const draftForLearner = await get("/app/listening/mcq/day/3", learnerCookie);
  check("J39 a draft day is not a learner's page (404)", (draftForLearner.status === 404 || (draftForLearner.text.includes("NEXT_HTTP_ERROR_FALLBACK;404") && !draftForLearner.text.includes('data-listening-mcq-day="3"'))), `status ${draftForLearner.status}`);
  const draftResponse = await send("POST", "/api/listening/mcq", { questionId: dayThree.questionIds[0] }, learnerCookie);
  check("J40 a draft day's question cannot be drilled", draftResponse.status === 404, `status ${draftResponse.status}`);
} finally {
  await cleanup();
  const residueTests = await q(`select count(*)::int n from listening_tests where source_ref like $1`, [`${PREFIX}%`]);
  const residueRevisions = await q(`select count(*)::int n from content_versions where source_ref like $1`, [`${PREFIX}%`]);
  const residueUsers = await q(`select count(*)::int n from users where email like $1`, [`${PREFIX}%@learners-qa.invalid`]);
  const residueSessions = await q(`select count(*)::int n from listening_mcq_sessions s join users u on u.id = s.user_id where u.email like $1`, [`${PREFIX}%@learners-qa.invalid`]);
  check("Z1 every fixture day is deleted", Number(residueTests[0].n) === 0, `${residueTests[0].n} days remain`);
  check("Z2 every fixture revision is deleted", Number(residueRevisions[0].n) === 0, `${residueRevisions[0].n} revisions remain`);
  check("Z3 the scenario's own accounts are deleted", Number(residueUsers[0].n) === 0, `${residueUsers[0].n} accounts remain`);
  check("Z4 the staged work went with them", Number(residueSessions[0].n) === 0, `${residueSessions[0].n} sessions remain`);
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
