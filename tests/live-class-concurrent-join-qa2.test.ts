/*
 * §04 — LIVE CLASS CONCURRENT FIRST JOIN.
 *
 * THE DEFECT. `POST /api/live-classes/:id/join` checked whether an attendance row already existed and,
 * if not, inserted one inside a transaction. The check was a READ performed OUTSIDE that transaction, and
 * `live_class_attendance` has only a primary key — no unique constraint on (live_class_id, user_id). So
 * two learners' requests are not the problem; one learner's TWO simultaneous requests are: both read
 * "absent" before either inserts, both insert, and the class ends up with two attendance rows and two
 * LIVE_CLASS_ATTENDED events for one person. A transaction does not help, because at READ COMMITTED each
 * transaction's snapshot simply does not see the other's uncommitted row.
 *
 * WHY THIS IS NOT A SEQUENTIAL-REQUEST QUESTION. Two requests one after the other behave correctly, so an
 * HTTP-level test that awaits the first before sending the second passes while the defect is live. The
 * reproduction here therefore uses TWO INDEPENDENT DATABASE CONNECTIONS held open at the same time, which
 * is the interleaving concurrency actually produces.
 *
 * The raw-SQL subtest is a positive control for overlap: it proves the database really permits two
 * simultaneous first joins. Without it, "the service produced one row" could mean the fix works OR that
 * the two calls never actually overlapped — and the second explanation is the one that produces a false
 * PASS.
 *
 * Synthetic live class in a disposable QA database, inserted and deleted here. Seeded rows are read, never
 * mutated: a class with status='live' is already `open` per joinState(), so no seeded status has to be
 * flipped and restored.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { recordLiveClassAttendance } from "../src/lib/services/live-classes/attendance";

const PROBE = "live-class-concurrent-join-qa2";
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard(PROBE);
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard(PROBE, qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = process.env.QA2_DATABASE_TESTS === "1" && !!DATABASE_URL && /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const skipReason = !enabled ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL" : false;
const MARKER = "QA-CONCJOIN-";

test("a concurrent first join records attendance exactly once", { skip: skipReason, timeout: 300_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();
  const one = async <T,>(sql: string, params: unknown[] = []): Promise<T> => (await db.query(sql, params)).rows[0] as T;
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);
  const createdClassIds: string[] = [];

  const attendanceRows = (classId: string, userId: string) =>
    count("select count(*)::int n from live_class_attendance where live_class_id = $1 and user_id = $2", [classId, userId]);
  const attendedEvents = (classId: string, userId: string) =>
    count("select count(*)::int n from activity_events where user_id = $1 and type = 'LIVE_CLASS_ATTENDED' and payload->>'liveClassId' = $2", [userId, classId]);

  /** A fresh synthetic class per trial, so trials cannot contaminate each other. */
  const makeClass = async (courseId: string, suffix: string) => {
    const row = await one<{ id: string }>(
      `insert into live_classes (course_id, title, scheduled_at, duration_minutes, status)
       values ($1, $2, now(), 60, 'live') returning id`,
      [courseId, `${MARKER}${suffix}`],
    );
    createdClassIds.push(row.id);
    return row.id;
  };

  try {
    const course = await one<{ id: string }>("select id from courses limit 1");
    assert.ok(course?.id, "a course must exist to hang a synthetic live class off");
    const students = (await db.query(
      `select id, email from users where role = 'student' and account_status = 'active' order by email limit 2`,
    )).rows as Array<{ id: string; email: string }>;
    assert.equal(students.length, 2, "two active students are required");
    const [studentA, studentB] = students as [{ id: string; email: string }, { id: string; email: string }];

    await t.test("arrange: the table has no unique constraint on (live_class_id, user_id)", async () => {
      const indexes = (await db.query(
        `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'live_class_attendance'`,
      )).rows.map((r) => r.indexdef as string);
      const uniqueOnPair = indexes.some((definition) => /unique/i.test(definition) && /live_class_id/.test(definition) && /user_id/.test(definition));
      console.log(`#   ${PROBE}: indexes on live_class_attendance -> ${indexes.length}`);
      for (const definition of indexes) console.log(`#     ${definition}`);
      // Recorded, not asserted as a failure: the schema fact is what makes the race possible, and the
      // fix below must not depend on a constraint that does not exist yet.
      assert.equal(uniqueOnPair, false, "the schema was expected to lack the unique constraint; if it now has one, this probe's premise has changed and must be re-read");
    });

    await t.test("POSITIVE CONTROL: two independent connections really can both perform a first join", async () => {
      /*
       * This is the overlap proof. Two separate clients, both transactions open at once, both reading
       * "no attendance yet", both inserting. Nothing in the database stops the second one, so two rows
       * appear for a single learner. If this ever produced one row, the concurrency reproduction below
       * would be meaningless — a green product test could simply mean the calls never overlapped.
       */
      const classId = await makeClass(course.id, "control");
      const c1 = new pg.Client({ connectionString: DATABASE_URL! });
      const c2 = new pg.Client({ connectionString: DATABASE_URL! });
      c1.on("error", () => {});
      c2.on("error", () => {});
      await c1.connect();
      await c2.connect();
      try {
        await c1.query("BEGIN");
        await c2.query("BEGIN");
        const check = (client: pg.Client) =>
          client.query("select count(*)::int n from live_class_attendance where live_class_id = $1 and user_id = $2", [classId, studentA.id]);
        const seen1 = await check(c1);
        const seen2 = await check(c2);
        assert.equal(Number(seen1.rows[0].n), 0, "connection 1 must see no attendance yet");
        assert.equal(Number(seen2.rows[0].n), 0, "connection 2 must ALSO see no attendance yet — this is the race");
        // Both insert while the other's transaction is still open.
        await c1.query("insert into live_class_attendance (live_class_id, user_id) values ($1, $2)", [classId, studentA.id]);
        await c2.query("insert into live_class_attendance (live_class_id, user_id) values ($1, $2)", [classId, studentA.id]);
        await c1.query("COMMIT");
        await c2.query("COMMIT");
        const rows = await attendanceRows(classId, studentA.id);
        console.log(`#   ${PROBE}: unguarded concurrent first join produced ${rows} attendance row(s) for one learner`);
        assert.equal(rows, 2, "expected the unguarded interleaving to duplicate the row; if it did not, the race is already prevented elsewhere and this probe must be re-read");
      } finally {
        await c1.query("ROLLBACK").catch(() => {});
        await c2.query("ROLLBACK").catch(() => {});
        await c1.end().catch(() => {});
        await c2.end().catch(() => {});
      }
    });

    await t.test("the product's join write records attendance and its event exactly once under concurrency", async () => {
      // Repeated because a single trial can pass by luck if the two calls happen not to overlap.
      const trials = 8;
      const duplicates: string[] = [];
      for (let trial = 0; trial < trials; trial += 1) {
        const classId = await makeClass(course.id, `trial${trial}`);
        const before = await attendedEvents(classId, studentA.id);
        // Two concurrent first joins for the SAME learner, through the real service the route calls.
        const results = await Promise.all([
          recordLiveClassAttendance(classId, studentA.id),
          recordLiveClassAttendance(classId, studentA.id),
        ]);
        const rows = await attendanceRows(classId, studentA.id);
        const events = (await attendedEvents(classId, studentA.id)) - before;
        if (rows !== 1 || events !== 1) duplicates.push(`trial ${trial}: ${rows} attendance row(s), ${events} event(s)`);
        // Both callers must be told they joined; the loser of the race is not an error.
        for (const result of results) {
          assert.equal(typeof result.created, "boolean", "each caller must get a definite result");
        }
        assert.equal(results.filter((r) => r.created).length <= 1, true, `at most one caller may report that it created the row, got ${results.filter((r) => r.created).length}`);
      }
      assert.deepEqual(duplicates, [],
        `a concurrent first join duplicated attendance: ${duplicates.join("; ")} — one learner must never be recorded twice for one class`);
    });

    await t.test("retrying a join after it succeeded stays idempotent", async () => {
      const classId = await makeClass(course.id, "retry");
      const first = await recordLiveClassAttendance(classId, studentA.id);
      assert.equal(first.created, true, "the first join must create the row");
      const second = await recordLiveClassAttendance(classId, studentA.id);
      const third = await recordLiveClassAttendance(classId, studentA.id);
      assert.equal(second.created, false, "a repeat join must not create a second row");
      assert.equal(third.created, false, "a third join must not create a row either");
      assert.ok(second.joinedAt instanceof Date, "a repeat join must report the ORIGINAL joinedAt, not a new one");
      assert.equal(second.joinedAt?.toISOString(), third.joinedAt?.toISOString(), "joinedAt must be stable across repeats");
      assert.equal(await attendanceRows(classId, studentA.id), 1, "exactly one attendance row after three joins");
      assert.equal(await attendedEvents(classId, studentA.id), 1, "exactly one LIVE_CLASS_ATTENDED event after three joins");
    });

    await t.test("one learner's race never affects another learner's attendance", async () => {
      const classId = await makeClass(course.id, "two-learners");
      // A races with itself while B joins once, all at the same time.
      const outcomes = await Promise.all([
        recordLiveClassAttendance(classId, studentA.id),
        recordLiveClassAttendance(classId, studentA.id),
        recordLiveClassAttendance(classId, studentB.id),
      ]);
      assert.equal(outcomes.length, 3);
      assert.equal(await attendanceRows(classId, studentA.id), 1, `learner A (${studentA.email}) must have exactly one row`);
      assert.equal(await attendanceRows(classId, studentB.id), 1, `learner B (${studentB.email}) must have exactly one row`);
      assert.equal(await attendedEvents(classId, studentA.id), 1, "learner A must have exactly one event");
      assert.equal(await attendedEvents(classId, studentB.id), 1, "learner B must have exactly one event");
      const total = await count("select count(*)::int n from live_class_attendance where live_class_id = $1", [classId]);
      assert.equal(total, 2, `the class must hold exactly two attendance rows, one per learner, got ${total}`);
    });
  } finally {
    /*
     * Nested finally on purpose. `db` is a raw pg.Client, not the application pool, so it has no
     * allowExitOnIdle: if a cleanup assertion throws before `db.end()` runs, the connection stays open and
     * the Node test runner never exits — one failing assertion then hangs the ENTIRE QA2 suite instead of
     * reporting itself. That is not hypothetical; a wrong cast in the cleanup query below did exactly
     * that, and the suite had to be killed at its timeout.
     */
    try {
    // Events reference the class only inside their payload, so they are removed explicitly; attendance
    // cascades from the class.
    for (const classId of createdClassIds) {
      await db.query("delete from activity_events where type = 'LIVE_CLASS_ATTENDED' and payload->>'liveClassId' = $1", [classId]).catch(() => {});
    }
    const removed = await db.query("delete from live_classes where title like $1 returning id", [`${MARKER}%`]);
    const leftClasses = await count("select count(*)::int n from live_classes where title like $1", [`${MARKER}%`]);
    const leftAttendance = await count(
      `select count(*)::int n from live_class_attendance a join live_classes c on c.id = a.live_class_id where c.title like $1`,
      [`${MARKER}%`],
    );
    /*
     * Matched against the actual class ids, not the marker: the event payload stores a UUID, so a
     * `payload->>'liveClassId' like 'QA-CONCJOIN-%'` predicate can never match and the assertion would
     * have passed no matter how many events were left behind. A cleanup check that cannot fail is worse
     * than no check, because it reads as verified.
     */
    const leftEvents = createdClassIds.length
      ? await count("select count(*)::int n from activity_events where type = 'LIVE_CLASS_ATTENDED' and payload->>'liveClassId' = any($1::text[])", [createdClassIds])
      : 0;
    assert.equal(leftClasses, 0, "every synthetic live class must be removed");
    assert.equal(leftAttendance, 0, "no synthetic attendance row may remain");
    assert.equal(leftEvents, 0, "no synthetic LIVE_CLASS_ATTENDED event may remain");
    console.log(`#   ${PROBE}: deleted ${removed.rows.length} synthetic class(es); attendance left ${leftAttendance}; events left ${leftEvents}`);
    } finally {
      await db.end().catch(() => {});
    }
  }
});
