#!/usr/bin/env node
/**
 * Listening — Exam → Revision studio → keywords → speed training → MCQ Mastery.
 *
 * The two things worth guarding here are the ones a browser cannot be trusted
 * with: the MCQ drill must not receive the options before the student has
 * committed, and the drill must never be able to skip a stage.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

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
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, headers: res.headers };
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
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Listening upgrades against ${BASE}\n`);

const ownerCookie = await login("owner@learnersarea.uz", "Owner12345!");
check("the owner can sign in", Boolean(ownerCookie), "no session cookie");

const studentCookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(studentCookie), "no session cookie");

// --- the test list and a fresh attempt ------------------------------------
const list = await page("/listening", studentCookie);
check("the listening page renders", list.status === 200, `status ${list.status}`);

// The answer key lives in the database, never in the page: the exam HTML must
// not contain `correctAnswer` at all.
const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const testRow = await db.query("select id, title, transcript from listening_tests where is_active = true order by created_at limit 1");
check("a listening test exists in the database", testRow.rows.length > 0);
const testId = testRow.rows[0]?.id;

const started = await api("/api/listening/attempts", {
  method: "POST",
  cookie: studentCookie,
  body: { testId },
});
const attemptId = started.json?.id ?? null;
check("an attempt can be started", Boolean(attemptId), started.text.slice(0, 120));

const attemptPage = await page(`/listening/attempts/${attemptId}`, studentCookie);
check("the exam renders", attemptPage.status === 200, `status ${attemptPage.status}`);
check("the exam shows the audio", /audio|iframe|material/i.test(attemptPage.text));
// A multiple-choice key is also one of its options, so the bare string is
// legitimately on screen — and the dictionary shipped to the client contains the
// *label* "correctAnswer" too. What must never appear is a key bound to that
// field, or the explanation that gives the answer away.
const everyKey = await db.query("select correct_answer from listening_questions where test_id = $1", [testId]);
const leakedKey = everyKey.rows.find((row) =>
  attemptPage.text.includes(`"correctAnswer":${JSON.stringify(row.correct_answer)}`)
);
check(
  "the exam never binds a key to the correctAnswer field",
  !leakedKey,
  `leaked ${JSON.stringify(leakedKey?.correct_answer)}`
);

const explanationRow = await db.query(
  "select explanation from listening_questions where test_id = $1 and type = 'short_answer' limit 1",
  [testId]
);
const explanation = explanationRow.rows[0]?.explanation ?? "";
check(
  "the exam never ships the explanation",
  explanation.length > 10 && !attemptPage.text.includes(explanation.slice(0, 40)),
  "the explanation leaked into the exam HTML"
);
check(
  "the exam never ships the transcript",
  !attemptPage.text.includes((testRow.rows[0]?.transcript ?? "").slice(0, 40)) ||
    (testRow.rows[0]?.transcript ?? "").length < 40
);

const questionRows = await db.query(
  'select id, type, correct_answer from listening_questions where test_id = $1 order by "order"',
  [testId]
);
const questions = questionRows.rows;
check("the test has questions to grade", questions.length > 0);

const answers = questions.map((q, i) => ({
  questionId: q.id,
  answer: i === 0 ? "definitely not the key" : q.correct_answer,
}));
const submitted = await api(`/api/listening/attempts/${attemptId}/submit`, {
  method: "POST",
  cookie: studentCookie,
  body: { answers },
});
check("the attempt can be submitted", submitted.status === 200, submitted.text.slice(0, 120));

const analysis = await page(`/listening/attempts/${attemptId}`, studentCookie);
check("the analysis renders after submitting", analysis.status === 200);
check("the analysis offers the revision studio", analysis.text.includes("data-revision-link"));
check("the transcript is interactive in the analysis", analysis.text.includes("data-clickable-text"));

const revision = await page(`/listening/attempts/${attemptId}/revision`, studentCookie);
check("the revision studio renders", revision.status === 200, `status ${revision.status}`);
check("the revision studio shows the mistake map", revision.text.includes("data-mistake-map"));
check("the mistake map names the weakest type", revision.text.includes("data-weakest-type"));
check("the mistake map lists the real miss", revision.text.includes("data-mistake="));
check("the keyword table is present", revision.text.includes("data-keyword-table"));
check("authored keywords are rendered", revision.text.includes("data-keyword-row="));
check("the paraphrase column shows what was said", revision.text.includes("Room 4B free from two until four"));
check("speed training is gated by real attempts", revision.text.includes("data-speed-"));
check("the MCQ drill is present", revision.text.includes("data-mcq-question="));
check(
  "the MCQ drill is practice only",
  revision.text.includes("Practice only") || revision.text.includes("Faqat mashq")
);

// --- MCQ Mastery: the options must not exist before the reveal ------------
// A drill that reached `reasoned` is finished for good, so a re-run has to start
// from a clean slate; the deletion is test-side setup, not application logic.
await db.query("delete from listening_mcq_sessions where test_id = $1", [testId]);

const mcqQuestionId = (revision.text.match(/data-mcq-question="([0-9a-f-]{36})"/) ?? [])[1];
check("an MCQ question is addressable", Boolean(mcqQuestionId));

const opened = await api("/api/listening/mcq", {
  method: "POST",
  cookie: studentCookie,
  body: { questionId: mcqQuestionId },
});
const sessionId = opened.json?.session?.id;
check("an MCQ session opens", Boolean(sessionId), opened.text.slice(0, 140));
check(
  "the options are withheld before the reveal",
  opened.json?.options === null && opened.json?.correctAnswer === null,
  JSON.stringify(opened.json?.options)
);

// stages cannot be skipped: reveal straight from `listen` is refused
const skipped = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "revealed" },
});
check("a stage cannot be skipped", skipped.status === 409, `status ${skipped.status}`);

const notes = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "notes", text: "student wants a room on Thursday" },
});
check("notes advance the drill", notes.json?.session?.stage === "notes", notes.text.slice(0, 120));
check("the options are still withheld after notes", notes.json?.options === null);

const empty = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "committed", text: "   " },
});
check("an empty commitment is refused", empty.status === 409, `status ${empty.status}`);

const committed = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "committed", text: "Room 4B" },
});
check("the own answer is committed", committed.json?.session?.stage === "committed");

const revealed = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "revealed" },
});
check("the reveal step exposes the options", Array.isArray(revealed.json?.options) && revealed.json.options.length > 0);
check("the key is exposed only now", typeof revealed.json?.correctAnswer === "string");

const badChoice = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "chosen", text: "Room 9Z" },
});
check("a choice outside the options is refused", badChoice.status === 400, `status ${badChoice.status}`);

const chosen = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "chosen", text: revealed.json.options[0] },
});
check("a real option can be chosen", chosen.json?.session?.stage === "chosen");
check("the outcome is judged after the choice", ["correct", "incorrect"].includes(chosen.json?.outcome));

const reasoned = await api(`/api/listening/mcq/${sessionId}`, {
  method: "PATCH",
  cookie: studentCookie,
  body: { step: "reasoned", text: "Because the student says Room 4B in the recording." },
});
check("reasoning closes the drill", reasoned.json?.session?.stage === "reasoned");
check("the drill ends with no next step", reasoned.json?.next === null);

// --- ownership and score integrity ---------------------------------------
const otherLogin = await login("new.student@learnersarea.uz", "Student12345!");
if (otherLogin) {
  const foreign = await page(`/listening/attempts/${attemptId}/revision`, otherLogin);
  check(
    "another student cannot open this revision studio",
    foreign.status === 404 || foreign.status === 307 || foreign.status === 302,
    `status ${foreign.status}`
  );
  const foreignSession = await api(`/api/listening/mcq/${sessionId}`, { cookie: otherLogin });
  check("another student cannot read this drill", foreignSession.status === 404, `status ${foreignSession.status}`);
}

const anonDrill = await api("/api/listening/mcq", {
  method: "POST",
  body: { questionId: mcqQuestionId },
});
check("an anonymous caller cannot open a drill", anonDrill.status === 401, `status ${anonDrill.status}`);

const scoreRow = await db.query("select score, total_questions from listening_attempts where id = $1", [attemptId]);
check(
  "the drill never rewrote the exam score",
  scoreRow.rows[0]?.score === submitted.json?.score,
  `${scoreRow.rows[0]?.score} vs ${submitted.json?.score}`
);

const drillRows = await db.query(
  "select count(*)::int as n from listening_mcq_sessions where test_id = $1",
  [testId]
);
check("the drill persisted its stages", drillRows.rows[0]?.n >= 1, `rows ${drillRows.rows[0]?.n}`);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
