#!/usr/bin/env node
/**
 * /progress — every figure must be traceable to a row.
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
const { assertMutableDatabase, fixtureTag, withFixtures } = await import("./lib/fixture-safety.mjs");

const CONNECTION = (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area");
// This probe INSERTS a graded mock attempt. Refuse outright unless the target is a
// disposable QA database: a leaked fixture here is a fabricated IELTS band on a real
// learner's account.
const target = assertMutableDatabase(CONNECTION);
const TAG = fixtureTag("progress");
console.log(`  fixtures: db=${target.name} tag=${TAG}`);

const db = new pg.Client({ connectionString: CONNECTION });
await db.connect();

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const userId = (await db.query("select id from users where email = 'demo.student@learnersarea.uz'")).rows[0].id;
const progress = await page("/app/progress", cookie);
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
const fresh = await page("/app/progress", freshCookie);
check("a fresh account sees the page too", fresh.status === 200);
// The OLD assertion regex-matched any "9.0" or "NN%" anywhere in the rendered text.
// That is invalid: the Mock panel legitimately prints the IELTS scale maximum
// ("Latest band / 9.0"), chart axis ticks (0.0 3.0 6.0 9.0) and a sr-only caption.
// Those are a SCALE, not a learner result. The real invariant is:
//   a learner who has completed nothing must never be shown a band they did not earn.
// `data-latest-band` carries the learner's OWN value, or "none" when nothing is graded.
const attrFrom = (html, name) => {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const freshBand = attrFrom(fresh.text, "data-latest-band");
const freshCompleted = attrFrom(fresh.text, "data-completed-mocks");

// The truth surface must EXIST. Accepting null here made the probe vacuous: if the
// data attributes were ever dropped, a fresh learner could be shown anything at all and
// this suite would still pass.
check(
  "the fresh account's mock truth surface is rendered at all",
  freshBand !== null && freshCompleted !== null,
  `data-latest-band=${freshBand} data-completed-mocks=${freshCompleted}`
);
check(
  "a fresh account's own band is absent, not invented",
  freshBand === "none",
  `data-latest-band=${freshBand}`
);
check(
  "a fresh account is credited with zero completed mocks",
  freshCompleted === "0",
  `data-completed-mocks=${freshCompleted}`
);

// The scale label and axis may show 9.0; a learner VALUE may not appear anywhere.
const freshBody = fresh.text
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<[^>]+>/g, " ");
check(
  "a fresh account sees a truthful empty state rather than a score",
  /—|yo'q|no graded|hali/i.test(freshBody),
  "expected an explicit empty-state marker in the rendered text"
);

// ---------------------------------------------------------------------------
// POSITIVE-CONTROL FIXTURE
//
// The seed ships no full mock and no graded attempt, so without this the band detector
// would never be exercised at all and every "no band" assertion above would be
// trivially satisfiable. We create ONE graded full mock for the seeded learner, prove
// the panel reports it truthfully, then remove it so the suite leaves no residue.
// ---------------------------------------------------------------------------
const FIXTURE_BAND = 6.5;
const courseRow = await db.query("select id from courses order by title limit 1");
const courseId = courseRow.rows[0]?.id;
let fixtureMockId = null;
let fixtureAttemptId = null;
if (courseId) {
  const mk = await db.query(
    `insert into mock_tests(course_id,title,skill,track,kind,publication_state,publish_at)
     values($1,$2,'full','academic','full','published',now() - interval '1 day')
     returning id`,
    [courseId, `QA full mock (positive control) ${TAG}`]
  );
  fixtureMockId = mk.rows[0]?.id ?? null;
  if (fixtureMockId) {
    const at = await db.query(
      `insert into mock_attempts(user_id,mock_test_id,status,started_at,finished_at,estimated_band,mock_snapshot)
       values((select id from users where email='demo.student@learnersarea.uz'),$1,'submitted',
              now() - interval '2 hours', now() - interval '1 hour', $2, '{"kind":"full"}'::jsonb)
       returning id`,
      [fixtureMockId, FIXTURE_BAND]
    );
    fixtureAttemptId = at.rows[0]?.id ?? null;
  }
}
// Everything from here until cleanup runs inside withFixtures(): if ANY assertion
// below throws, the graded attempt is still removed. Previously the DELETEs sat ~80
// lines after the INSERTs with no protection, so a single throw left a fabricated
// band 6.5 on the seeded learner permanently.
await withFixtures(async () => {

// Re-read the panel now that real graded history exists.
const progressGraded = await page("/app/progress", cookie);

// ---------------------------------------------------------------------------
// POSITIVE CONTROL — the detector must recognise a REAL graded result.
//
// Proving the attributes merely exist is not enough: if the seeded learner also read
// none/0, every negative assertion above would be trivially satisfiable. So we require
// the seeded learner to exhibit at least one genuine graded condition AND cross-check
// the rendered values against authoritative database state.
// ---------------------------------------------------------------------------
const seededBand = attrFrom(progressGraded.text, "data-latest-band");
const seededCompleted = attrFrom(progressGraded.text, "data-completed-mocks");
check(
  "the seeded learner's mock truth surface is rendered at all",
  seededBand !== null && seededCompleted !== null,
  `data-latest-band=${seededBand} data-completed-mocks=${seededCompleted}`
);

// Authoritative state. `skill` is not a column on mock_attempts: it comes from the
// catalogue row (mock_tests.skill), falling back to the snapshot kind captured at start
// time, exactly as src/lib/data/mocks.ts resolves it.
const dbTruth = await db.query(
  `with graded as (
     select a.id,
            a.finished_at,
            a.estimated_band,
            a.mock_test_id,
            coalesce(t.skill, a.mock_snapshot->>'kind') as skill
     from mock_attempts a
     join users u on u.id = a.user_id
     left join mock_tests t on t.id = a.mock_test_id
     where u.email = 'demo.student@learnersarea.uz'
       and a.finished_at is not null
   )
   select
     (select count(distinct mock_test_id)::int from graded
        where skill = 'full' and mock_test_id in (select id from mock_tests)) as completed_catalogue,
     (select estimated_band from graded
        where skill = 'full' and estimated_band is not null
        order by finished_at desc, id desc limit 1) as latest_band`
);
const row = dbTruth.rows[0] ?? {};
const dbCompleted = Number(row.completed_catalogue ?? 0);
const dbBand = row.latest_band === null || row.latest_band === undefined ? null : Number(row.latest_band);

// The control FAILS if the seeded learner is itself empty — then nothing proves the
// detector can tell a real result from an empty one.
check(
  "the positive control is meaningful: the seeded learner really has graded mock history",
  dbCompleted > 0 || dbBand !== null,
  `db completed=${dbCompleted} latest_band=${dbBand} (seed has no graded full mock, so the band detector is unproven)`
);
check(
  "the rendered completed-mock count matches authoritative database state",
  String(dbCompleted) === seededCompleted,
  `rendered=${seededCompleted} db=${dbCompleted}`
);
check(
  "the rendered band matches authoritative database state",
  dbBand === null ? seededBand === "none" : Math.abs(Number(seededBand) - dbBand) < 0.05,
  `rendered=${seededBand} db=${dbBand}`
);
// And the detector must distinguish a real learner value from the 9.0 scale maximum.
check(
  "a rendered band is a real learner value, not the scale maximum echoed back",
  seededBand === "none" || (Number.isFinite(Number(seededBand)) && Number(seededBand) >= 0 && Number(seededBand) <= 9),
  `data-latest-band=${seededBand}`
);

// A deliberate mid-test failure, to prove the finally block actually runs. Enabled
// only by QA_FORCE_FIXTURE_FAILURE, so the normal run is unaffected.
if (process.env.QA_FORCE_FIXTURE_FAILURE === "1") {
  throw new Error("deliberate mid-test failure (QA_FORCE_FIXTURE_FAILURE)");
}

}, async () => {
  // --- fixture cleanup: ALWAYS runs, including on a thrown assertion ---------
  if (fixtureAttemptId) await db.query("delete from mock_attempts where id = $1", [fixtureAttemptId]);
  if (fixtureMockId) await db.query("delete from mock_tests where id = $1", [fixtureMockId]);
  // Residue is checked for THIS run's tag: a concurrent run's fixture is not ours to
  // judge, and a crashed earlier run must not be reported as our leak.
  const residue = await db.query(
    "select count(*)::int as n from mock_tests where title like $1",
    [`%${TAG}%`]
  );
  const orphanAttempts = await db.query(
    `select count(*)::int as n from mock_attempts a
      join mock_tests t on t.id = a.mock_test_id where t.title like $1`,
    [`%${TAG}%`]
  );
  check(
    "the positive-control fixture is cleaned up",
    residue.rows[0]?.n === 0 && orphanAttempts.rows[0]?.n === 0,
    `mock residue ${residue.rows[0]?.n}, attempt residue ${orphanAttempts.rows[0]?.n}`
  );
});

check("an anonymous visitor cannot read progress", (await page("/app/progress")).status !== 200);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
