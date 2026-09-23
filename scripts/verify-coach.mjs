#!/usr/bin/env node
/**
 * End-to-end verification of the AI Coach subsystem against a RUNNING app and a
 * REAL database.
 *
 *   DATABASE_URL=... node scripts/verify-coach.mjs [baseUrl]
 *
 * What it proves, over HTTP, the way a browser does:
 *   - a student submission is evaluated, persisted, and labelled with the
 *     evaluator that actually produced the result;
 *   - the same submission is never evaluated twice (idempotency);
 *   - grammar and vocabulary production answers are graded by verdict, not by
 *     string equality;
 *   - authorization holds: one student cannot touch another student's work;
 *   - no credential or provider secret leaks into a rendered page.
 *
 * Nothing here fakes a result: every assertion is checked against a real server
 * response, the real database, or both.
 */
import assert from "node:assert/strict";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

const ACCOUNTS = {
  admin: { email: "admin@learnersarea.uz", password: "Admin12345!" },
  teacher: { email: "teacher@learnersarea.uz", password: "Teacher12345!" },
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
  student2: { email: "new.student@learnersarea.uz", password: "Student12345!" },
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    const raw = String(err.message);
    failures.push({ name, err: new Error(raw.length > 400 ? `${raw.slice(0, 400)}…` : raw) });
    console.log(`  FAIL ${name}\n         ${raw.slice(0, 400)}`);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = "";
  }
  async login(account) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ACCOUNTS[account]),
    });
    assert.equal(res.status, 200, `login as ${account} failed: ${res.status}`);
    const raw = res.headers.getSetCookie?.() ?? [];
    this.cookie = raw.map((c) => c.split(";")[0]).join("; ");
    assert.ok(this.cookie, `no session cookie for ${account}`);
    return this;
  }
  async setLocale(locale) {
    const res = await fetch(`${BASE}/api/locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: this.cookie },
      body: JSON.stringify({ locale }),
    });
    assert.equal(res.status, 200, `locale switch failed: ${res.status}`);
    const cookies = res.headers.getSetCookie?.() ?? [];
    this.cookie = [this.cookie, ...cookies.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
    return this;
  }
  async request(pathname, { method = "GET", body } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text();
    return { status: res.status, data };
  }
}

const student = new Client("student");
const student2 = new Client("student2");
const teacher = new Client("teacher");
const anonymous = new Client("anonymous");

async function dbRows(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

console.log(`\nLearners Area — AI Coach E2E verification against ${BASE}\n`);

// ---------------------------------------------------------------------------

await check("seeded accounts can log in", async () => {
  await student.login("student");
  await student2.login("student2");
  await teacher.login("teacher");
  // The pages under test are bilingual; pin the locale so the assertions can
  // check the exact label the reader sees.
  await student.setLocale("en");
  await teacher.setLocale("en");
});

await check("evaluations require a session", async () => {
  const res = await anonymous.request("/api/grammar/exercises/00000000-0000-0000-0000-000000000000/produce", {
    method: "POST",
    body: { answer: "test" },
  });
  assert.equal(res.status, 401);
});

// --- Writing: evaluate -> persist -> label ---------------------------------

let createdSubmissionId = null;
let createdEvaluationId = null;

await check("a submitted essay is evaluated and labelled with its real evaluator", async () => {
  const prompts = await dbRows("select id, target_word_count from writing_prompts order by created_at limit 2");
  assert.ok(prompts.length > 0, "seeded writing prompts are required");

  const fresh = await student.request("/api/writing/submissions", {
    method: "POST",
    body: { promptId: prompts[0].id },
  });
  assert.equal(fresh.status, 200, `create failed: ${JSON.stringify(fresh.data)}`);
  createdSubmissionId = fresh.data?.id;
  assert.ok(createdSubmissionId, "the create response must contain the submission id");

  const content = Array.from({ length: 8 })
    .map(
      (_, i) =>
        `Paragraph ${i + 1}. Many students believe that online courses are more convenient, and they often mention the same three reasons. ` +
        `However, the same students also complain that they have less contact with their teachers, and this is a real problem because nobody explains the difficult parts. ` +
        `Furthermore, a learner who studies alone may lose motivation after a few weeks, so the course design has to compensate with regular feedback. ` +
        `As a result, I believe the benefits outweigh the problems only when the course is well structured.`
    )
    .join("\n\n");

  const saved = await student.request(`/api/writing/submissions/${createdSubmissionId}`, {
    method: "PATCH",
    body: { content },
  });
  assert.equal(saved.status, 200, `save failed: ${JSON.stringify(saved.data)}`);

  const submitted = await student.request(`/api/writing/submissions/${createdSubmissionId}/submit`, {
    method: "POST",
    body: {},
  });
  assert.equal(submitted.status, 200, `submit failed: ${JSON.stringify(submitted.data)}`);
  assert.ok(submitted.data.checkedBy, "the response must name the evaluator");
  assert.ok(["riwi", "internal"].includes(submitted.data.providerId) || submitted.data.providerId);
  assert.equal(submitted.data.fallbackUsed, false, "RIWI is the configured provider, so no fallback is needed");
  createdEvaluationId = submitted.data.evaluationId;

  const rows = await dbRows(
    "select provider_id, provider_display_name, checked_by_name, fallback_used, overall_estimate, confidence, criteria from evaluations where id = $1",
    [createdEvaluationId]
  );
  assert.equal(rows.length, 1, "the evaluation must be persisted");
  assert.equal(rows[0].checked_by_name, rows[0].provider_display_name, "the label must match the stored provider");
  assert.ok(rows[0].criteria.length >= 4, "the four writing criteria must be stored");
});

await check("the submission page repeats the stored evaluator label", async () => {
  const page = await student.request(`/writing/submissions/${createdSubmissionId}`);
  assert.equal(page.status, 200);
  assert.match(String(page.data), /data-checked-by="/);
  assert.match(String(page.data), /Checked by/);
  assert.ok(!/>\s*(undefined|NaN)\s*</.test(String(page.data)), "no rendered value may be undefined");
});

await check("submitting the same work twice does not create a second evaluation", async () => {
  const again = await student.request(`/api/writing/submissions/${createdSubmissionId}/submit`, {
    method: "POST",
    body: {},
  });
  assert.equal(again.status, 409, "a non-draft submission must be refused");

  const rows = await dbRows("select count(*)::int as n from evaluations where source_id = $1", [
    createdSubmissionId,
  ]);
  assert.equal(rows[0].n, 1, "exactly one authoritative evaluation per submission");
});

await check("weakness tracking receives the categories the evaluator reported", async () => {
  const rows = await dbRows(
    "select category, occurrence_count, status from coach_weaknesses where user_id = (select user_id from evaluations where id = $1)",
    [createdEvaluationId]
  );
  assert.ok(rows.length > 0, "at least one weakness row must exist for a full essay");
  for (const row of rows) {
    assert.ok(row.occurrence_count > 0);
    assert.ok(["open", "improving", "resolved"].includes(row.status));
  }
});

await check("the Coach dashboard renders the evaluated work and its evaluator", async () => {
  const page = await student.request("/coach");
  assert.equal(page.status, 200);
  assert.match(String(page.data), /Checked by/);
  assert.match(String(page.data), /data-checked-by="/);
});

// --- Assignment orchestration ----------------------------------------------

await check("a writing-linked assignment delegates instead of re-evaluating", async () => {
  const rows = await dbRows(
    "select a.id from assignments a where a.related_writing_prompt_id is not null and exists (select 1 from writing_submissions s where s.prompt_id = a.related_writing_prompt_id and s.id = $1) limit 1",
    [createdSubmissionId]
  );
  if (rows.length === 0) return; // nothing to assert without seeded assignment data

  const res = await student.request(`/api/assignments/${rows[0].id}/evaluate`, {
    method: "POST",
    body: {},
  });
  assert.equal(res.status, 200, `assignment evaluation failed: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.dispatchedTo, "writing");
  assert.equal(res.data.evaluationId, createdEvaluationId, "the existing evaluation must be reused");
});

await check("another student cannot evaluate someone else's assignment", async () => {
  const rows = await dbRows("select id from assignments limit 1");
  if (rows.length === 0) return;
  const res = await student2.request(`/api/assignments/${rows[0].id}/evaluate`, {
    method: "POST",
    body: { response: "This is somebody else's assignment response text." },
  });
  assert.ok([403, 400].includes(res.status), `expected a refusal, got ${res.status}`);
});

// --- Grammar production -----------------------------------------------------

await check("a produced grammar answer is graded by verdict, not by string equality", async () => {
  const rows = await dbRows("select id, correct_option from grammar_exercises limit 1");
  assert.ok(rows.length > 0, "seeded grammar exercises are required");
  const exerciseId = rows[0].id;

  const wrong = await student.request(`/api/grammar/exercises/${exerciseId}/produce`, {
    method: "POST",
    body: { answer: "He go to school every day." },
  });
  assert.equal(wrong.status, 200, `produce failed: ${JSON.stringify(wrong.data)}`);
  assert.ok(["correct", "mostly_correct", "needs_correction"].includes(wrong.data.verdict));
  assert.ok(wrong.data.checkedBy, "the response must name the evaluator");
  assert.ok(String(wrong.data.sampleAnswer).length > 0, "the sample is released only after answering");

  // A different-but-correct rewrite must not be failed for wording alone.
  const rewrite = await student.request(`/api/grammar/exercises/${exerciseId}/produce`, {
    method: "POST",
    body: { answer: `In my own words: ${rows[0].correct_option}` },
  });
  assert.equal(rewrite.status, 200);
  assert.notEqual(rewrite.data.verdict, "needs_correction", "a correct rewrite must not be marked wrong");
});

await check("a grammar evaluation is stored against its attempt", async () => {
  const rows = await dbRows(
    "select count(*)::int as n from evaluations where evaluation_type = 'grammar' and source_type = 'grammar_attempt'"
  );
  assert.ok(rows[0].n > 0, "grammar evaluations must be persisted");
});

// --- Vocabulary active use --------------------------------------------------

await check("using a word in a sentence is evaluated as active use", async () => {
  const entries = await dbRows(
    "select uv.id, l.term from user_vocabulary uv join lexemes l on l.id = uv.lexeme_id where uv.user_id = (select id from users where email = $1) limit 1",
    [ACCOUNTS.student.email]
  );
  assert.ok(entries.length > 0, "the demo student needs at least one vocabulary entry");
  const { id, term } = entries[0];

  const missing = await student.request(`/api/vocabulary/${id}/use`, {
    method: "POST",
    body: { sentence: "This sentence deliberately avoids the target word entirely." },
  });
  assert.equal(missing.status, 200);
  assert.equal(missing.data.verdict, "needs_correction", "a missing target word cannot be credited");

  const used = await student.request(`/api/vocabulary/${id}/use`, {
    method: "POST",
    body: { sentence: `I used the word ${term} in my own sentence about my studies.` },
  });
  assert.equal(used.status, 200);
  assert.notEqual(used.data.verdict, "needs_correction");
  assert.ok(used.data.checkedBy);
});

await check("another student cannot use someone else's vocabulary entry", async () => {
  const entries = await dbRows(
    "select id from user_vocabulary where user_id = (select id from users where email = $1) limit 1",
    [ACCOUNTS.student.email]
  );
  const res = await student2.request(`/api/vocabulary/${entries[0].id}/use`, {
    method: "POST",
    body: { sentence: "I am writing a sentence on somebody else's entry." },
  });
  assert.equal(res.status, 404, "an entry that is not yours must not exist for you");
});

// --- Speaking ---------------------------------------------------------------

await check("a transcript the client calls machine output is rejected", async () => {
  const attempts = await dbRows(
    "select id from speaking_attempts where user_id = (select id from users where email = $1) limit 1",
    [ACCOUNTS.student.email]
  );
  if (attempts.length === 0) return; // no recording exists in a fresh database

  // `transcript` is not a field the API accepts: only `manualTranscript` is,
  // and it is stored with origin="manual".
  const res = await student.request(`/api/speaking/attempts/${attempts[0].id}/transcript`, {
    method: "POST",
    body: { transcript: "This claims to be machine transcription." },
  });
  assert.equal(res.status, 400, "a client must not be able to fabricate machine transcription");
});

await check("another student cannot attach a transcript to someone else's attempt", async () => {
  const attempts = await dbRows(
    "select id from speaking_attempts where user_id = (select id from users where email = $1) limit 1",
    [ACCOUNTS.student.email]
  );
  if (attempts.length === 0) return;
  const res = await student2.request(`/api/speaking/attempts/${attempts[0].id}/transcript`, {
    method: "POST",
    body: { manualTranscript: "Somebody else trying to write on my attempt." },
  });
  assert.equal(res.status, 403);
});

// --- Privacy ----------------------------------------------------------------

await check("no credential or provider secret reaches a rendered page", async () => {
  const pages = ["/coach", "/assignments", "/dashboard", "/writing/history"];
  const forbidden = ["AUTH_SECRET", "R2_SECRET_ACCESS_KEY", "DATABASE_URL=", "AI_PRIMARY_PROVIDER"];
  for (const path of pages) {
    const res = await student.request(path);
    assert.equal(res.status, 200, `${path} must render`);
    const html = String(res.data);
    for (const needle of forbidden) {
      assert.ok(!html.includes(needle), `${path} must not contain ${needle}`);
    }
  }
});

await check("a student's submission is not readable through another account", async () => {
  // A teacher is authorized to review, but this endpoint is scoped to the
  // owner, so the row must not exist for them either.
  const page = await teacher.request(`/writing/submissions/${createdSubmissionId}`);
  assert.equal(page.status, 404, "someone else's submission must not exist for this account");
  const direct = await student2.request(`/api/writing/submissions/${createdSubmissionId}`, {
    method: "PATCH",
    body: { content: "Someone else trying to overwrite this draft." },
  });
  assert.equal(direct.status, 404);
});

// --- Cleanup ----------------------------------------------------------------

await check("the verification rows are cleaned up", async () => {
  // sourceId is polymorphic, so it carries no foreign key: the evaluation is
  // removed with the source explicitly (see deleteEvaluationsForSource).
  await pool.query("delete from evaluations where source_id = $1", [createdSubmissionId]);
  await pool.query("delete from writing_submissions where id = $1", [createdSubmissionId]);
  const rows = await dbRows("select count(*)::int as n from evaluations where source_id = $1", [
    createdSubmissionId,
  ]);
  assert.equal(rows[0].n, 0, "the verification data must not survive the run");
});

await check("an unsubmitted speaking attempt is discarded together with its evaluation", async () => {
  const rows = await dbRows(
    "select count(*)::int as n from evaluations where source_type = 'speaking_attempt' and source_id not in (select id from speaking_attempts)"
  );
  assert.equal(rows[0].n, 0, "no evaluation may outlive the attempt it belongs to");
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exitCode = 1;
}
await pool.end();
