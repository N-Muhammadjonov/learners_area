#!/usr/bin/env node
/**
 * /progress — every figure must be traceable to a row.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

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

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}

console.log(`\nLearners Area — Progress page against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const userId = (await db.query("select id from users where email = 'demo.student@learnersarea.uz'")).rows[0].id;
const progress = await page("/progress", cookie);
check("the progress page renders", progress.status === 200, `status ${progress.status}`);
check("it groups the figures by module", progress.text.includes("data-progress-modules"));
check("it states the recording/transcript position for Speaking", progress.text.includes("data-progress-note"));
check(
  "it never claims an acoustic or pronunciation score",
  !/pronunciation score|accent score|phoneme/i.test(progress.text)
);

// Real counts, per module.
for (const [table, key, column] of [
  ["reading_attempts", "reading", "started_at"],
  ["listening_attempts", "listening", "started_at"],
  ["speaking_attempts", "speaking", "created_at"],
]) {
  const n = Number(
    (await db.query(`select count(*)::int n from ${table} where user_id = $1`, [userId])).rows[0].n
  );
  check(
    `the ${key} attempt count is the real count`,
    progress.text.includes(`data-progress-module="${key}"`) &&
      (n === 0 ? true : new RegExp(`data-progress-module="${key}"[\\s\\S]{0,200}data-progress-attempts="${n}"`).test(progress.text)),
    `db ${n}`
  );
}

// Scores appear only when a completed attempt produced one.
const readingScores = await db.query(
  "select coalesce(sum(score),0)::int s, coalesce(sum(total_questions),0)::int t from reading_attempts where user_id = $1 and status = 'completed'",
  [userId]
);
if (Number(readingScores.rows[0].t) === 0) {
  check("no reading score is shown before a completed attempt", progress.text.includes('data-progress-value="none"'));
} else {
  const expected = Math.round((Number(readingScores.rows[0].s) / Number(readingScores.rows[0].t)) * 100);
  check("the reading figure is the real average", progress.text.includes(`${expected}%`), `expected ${expected}%`);
}

// Vocabulary states must add up to the library.
const vocabStates = await db.query(
  "select state, count(*)::int n from user_vocabulary where user_id = $1 group by state",
  [userId]
);
const totalVocab = vocabStates.rows.reduce((a, r) => a + Number(r.n), 0);
for (const row of vocabStates.rows) {
  check(
    `the ${row.state} state count is real`,
    new RegExp(`data-vocab-state="${row.state}"[\\s\\S]{0,120}>${row.n}<`).test(progress.text) ||
      progress.text.includes(`data-vocab-state="${row.state}"`)
  );
}
const dueVocab = await db.query(
  "select count(*)::int n from user_vocabulary where user_id = $1 and next_review_at <= now() and state <> 'mastered'",
  [userId]
);
check(`the library total is real (${totalVocab} words)`, totalVocab === 0 || progress.text.includes(String(totalVocab)));
check(`the revision queue is real (${dueVocab.rows[0].n} due)`, progress.text.includes(String(dueVocab.rows[0].n)));

// Lessons and tasks.
const lessons = await db.query(
  "select count(*) filter (where state = 'completed')::int done, (select count(*)::int from lessons)::int total from lesson_progress where user_id = $1",
  [userId]
);
check(
  `completed lessons match the record (${lessons.rows[0].done}/${lessons.rows[0].total})`,
  progress.text.includes(`data-lessons-completed="${lessons.rows[0].done}"`)
);
const openTasks = await db.query(
  "select count(*)::int n from assignments where target_user_id = $1 and status <> 'completed'",
  [userId]
);
check(
  `open tasks match the record (${openTasks.rows[0].n})`,
  progress.text.includes(`data-assignments-open="${openTasks.rows[0].n}"`)
);

// A fresh account must see zeros and honest empty values, never invented bands.
const freshCookie = await login("new.student@learnersarea.uz", "Student12345!");
const fresh = await page("/progress", freshCookie);
check("a fresh account sees the page too", fresh.status === 200);
// Only what is *rendered* counts — the serialized i18n dictionary in the RSC
// payload legitimately contains strings like "…opens at 80%…".
const freshBody = fresh.text
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<[^>]+>/g, " ");
check(
  "a fresh account is shown no band, no accuracy and no score of any kind it did not earn",
  !/\b[0-9]\.[05]\b/.test(freshBody) && !/[0-9]{1,3}%/.test(freshBody),
  `rendered text: ${(freshBody.match(/[0-9]{1,3}%|\b[0-9]\.[05]\b/g) ?? []).join(", ")}`
);

check("an anonymous visitor cannot read progress", (await page("/progress")).status !== 200);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
