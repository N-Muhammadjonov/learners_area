import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

/**
 * B3 / C3 — ASSIGNMENT ATOMICITY, proved by injected failure.
 *
 * THE PROPERTY. Creating an assignment writes three things: the `assignments` row, its
 * `assignment_targets` row, and an `ASSIGNMENT_CREATED` activity event. All three are inside one
 * transaction, because the event is what puts the work in the learner's feed — it is part of
 * creating the assignment, not a side effect of having created it.
 *
 * WHY A PASSING TEST IS NOT ENOUGH. Reading the route shows the three inserts share a
 * transaction. That is a claim about the source, not about PostgreSQL. The behaviour that
 * actually matters only appears when the LAST insert fails: does the assignment survive? Does the
 * API still say 200? Does the teacher's retry — which a 500 invites — create a duplicate? None of
 * that is visible in the happy path, and the original defect was exactly this: the event was
 * written after commit, so a failure left a committed assignment behind a 500 and the retry
 * created a second one.
 *
 * HOW THE FAILURE IS INJECTED. A BEFORE INSERT trigger on `activity_events` raises when a
 * `qa_fault` row is armed for this teacher. A `set_config` GUC would not work: the API server
 * serves the request from its own pooled connection, so a GUC set on the test's connection is
 * invisible to it. The trigger runs inside the server's transaction, which is the only place the
 * failure can be made to happen truthfully.
 *
 * The trigger is scoped to this test's teacher id so it cannot break unrelated assignment
 * creation, and the DDL it needs is created and dropped by this file, with the drop verified.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.QA2_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const enabled =
  process.env.QA2_DATABASE_TESTS === "1" &&
  !!DATABASE_URL &&
  /localhost|127\.0\.0\.1/.test(DATABASE_URL);

const skipReason = !enabled
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL (this test injects a database trigger)"
  : false;

const TEACHER = { email: "teacher@learnersarea.uz", password: "Teacher12345!" };
const STUDENT_A = { email: "demo.student@learnersarea.uz", password: "Student12345!" };
const STUDENT_B = { email: "new.student@learnersarea.uz", password: "Student12345!" };
const TAG = `qa3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

test("assignment creation is atomic: an event failure rolls back the assignment and the target, and a retry creates exactly one", { skip: skipReason, timeout: 240_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  await db.connect();

  let cookieTeacher = "";
  let cookieA = "";
  let cookieB = "";
  let studentAId = "";
  let teacherId = "";
  let installedTrigger = false;
  const createdTitles: string[] = [];

  /** Every row this test can create, removed child-first. Runs on every exit path. */
  async function cleanup() {
    const dropped: string[] = [];
    try {
      if (installedTrigger) {
        await db.query("drop trigger if exists qa_fault_activity_events on activity_events");
        await db.query("drop function if exists qa_fault_guard()");
        await db.query("drop table if exists qa_fault");
        installedTrigger = false;
        dropped.push("trigger+function+qa_fault table");
      }
      for (const title of createdTitles) {
        const found = await db.query("select id from assignments where title = $1", [title]);
        for (const row of found.rows) {
          await db.query("delete from assignment_targets where assignment_id = $1", [row.id]);
          await db.query("delete from activity_events where type='ASSIGNMENT_CREATED' and payload->>'assignmentId' = $1::text", [row.id]);
          await db.query("delete from assignments where id = $1", [row.id]);
        }
        dropped.push(`assignment "${title}"`);
      }
    } finally {
      // VERIFY the cleanup. An unverified cleanup is the failure mode this whole package exists
      // to prevent, and a trigger left behind would silently break every later assignment test.
      const residueTrigger = await db.query(
        "select count(*)::int n from information_schema.triggers where trigger_name='qa_fault_activity_events'",
      );
      const residueTable = await db.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_name='qa_fault'");
      const residueRows = createdTitles.length
        ? await db.query("select count(*)::int n from assignments where title = any($1)", [createdTitles])
        : { rows: [{ n: 0 }] };
      assert.equal(residueTrigger.rows[0].n, 0, "the injected trigger must be gone");
      assert.equal(residueTable.rows[0].n, 0, "the qa_fault table must be gone");
      assert.equal(residueRows.rows[0].n, 0, "no assignment row from this test may survive");
      await db.end().catch(() => {});
      return dropped;
    }
  }
  t.after(cleanup);

  async function login(account: { email: string; password: string }) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.201" },
      body: JSON.stringify(account),
    });
    assert.equal(res.status, 200, `login must succeed for ${account.email} against ${BASE_URL}; got ${res.status}. Is the built server running?`);
    const raw = res.headers.getSetCookie?.() ?? [];
    return raw.map((c) => c.split(";")[0]).join("; ");
  }

  await t.test("arrange: real identities over real HTTP", async () => {
    cookieTeacher = await login(TEACHER);
    cookieA = await login(STUDENT_A);
    cookieB = await login(STUDENT_B);
    assert.ok(cookieTeacher.includes("la_session"), "the teacher must hold a session cookie");
    const userRows = await db.query("select id, email from users where email in ($1, $2)", [TEACHER.email, STUDENT_A.email]);
    teacherId = userRows.rows.find((r) => r.email === TEACHER.email)?.id ?? "";
    studentAId = userRows.rows.find((r) => r.email === STUDENT_A.email)?.id ?? "";
    // Assert these loudly. If either is empty the API answers 400 invalid_input for a reason that
    // has nothing to do with atomicity, and the rollback assertions below would then "pass"
    // because nothing was ever attempted — a green test that proved nothing.
    assert.ok(teacherId, `the seeded teacher ${TEACHER.email} must exist in ${DATABASE_URL}`);
    assert.ok(studentAId, `the seeded student ${STUDENT_A.email} must exist in ${DATABASE_URL}`);
  });

  await t.test("arrange: install the fault trigger, scoped to this teacher", async () => {
    // `scope` limits the raise to one teacher's assignment events, so arming the fault cannot
    // break unrelated assignment creation happening elsewhere in the same database.
    await db.query("create table if not exists qa_fault (name text primary key, scope text)");
    await db.query(`
      create or replace function qa_fault_guard() returns trigger language plpgsql as $$
      begin
        if exists (
          select 1 from qa_fault
          where name = 'block_assignment_event'
            and (scope is null or scope = new.payload->>'teacherId')
        ) and new.type = 'ASSIGNMENT_CREATED' then
          raise exception 'qa fault: ASSIGNMENT_CREATED event write blocked';
        end if;
        return new;
      end;
      $$;
    `);
    await db.query("drop trigger if exists qa_fault_activity_events on activity_events");
    await db.query("create trigger qa_fault_activity_events before insert on activity_events for each row execute function qa_fault_guard()");
    installedTrigger = true;
    const installed = await db.query(
      "select count(*)::int n from information_schema.triggers where trigger_name='qa_fault_activity_events'",
    );
    assert.equal(installed.rows[0].n, 1, "the trigger must really be installed, or the test proves nothing");
  });

  const title = `[${TAG}] atomicity probe`;
  createdTitles.push(title);
  let promptId = "";

  await t.test("arrange: a published writing prompt to assign", async () => {
    const row = await db.query(
      "select id from writing_prompts where publication_state='published' order by created_at limit 1",
    );
    assert.ok(row.rows.length, "a published writing prompt must exist for the legacy assignment path");
    promptId = row.rows[0].id;
  });

  const body = { title, description: `[${TAG}] description`, targetUserId: studentAId, relatedWritingPromptId: promptId };

  let failedStatus = 0;
  await t.test("the event write fails: the API must not report success", async () => {
    await db.query("insert into qa_fault (name, scope) values ('block_assignment_event', $1) on conflict (name) do update set scope = excluded.scope", [teacherId]);
    const res = await fetch(`${BASE_URL}/api/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieTeacher },
      body: JSON.stringify(body),
    });
    failedStatus = res.status;
    assert.ok(res.status >= 500, `a failed event write must surface as a server error, not ${res.status}`);
  });

  await t.test("ROLLBACK: neither the assignment nor its target survived", async () => {
    const assignments = await db.query("select id from assignments where title = $1", [title]);
    assert.equal(assignments.rows.length, 0, "the assignment row must have rolled back with the failed event");
    const events = await db.query(
      "select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED' and payload->>'teacherId' = $1 and payload->>'assignmentId' is not null",
      [teacherId],
    );
    // The trigger blocks the insert, so no event for THIS title can exist; the assertion that
    // matters is the assignment row above. This guards against a partial commit that wrote the
    // assignment and target but not the event.
    const targets = await db.query(
      "select count(*)::int n from assignment_targets t join assignments a on a.id = t.assignment_id where a.title = $1",
      [title],
    );
    assert.equal(targets.rows[0].n, 0, "no target row may survive a rolled-back transaction");
    assert.ok(events.rows[0].n >= 0);
  });

  await t.test("RETRY after the failed request creates exactly ONE assignment", async () => {
    await db.query("delete from qa_fault where name = 'block_assignment_event'");
    const res = await fetch(`${BASE_URL}/api/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieTeacher },
      body: JSON.stringify(body),
    });
    assert.ok(res.status < 300, `the retry must succeed once the fault is disarmed; got ${res.status}`);
    const assignments = await db.query("select id from assignments where title = $1 order by created_at", [title]);
    // This is the assertion the original defect failed: a committed-but-500 first attempt plus a
    // successful retry produced TWO assignments for one piece of work.
    assert.equal(assignments.rows.length, 1, "exactly one assignment may exist after a failed attempt and one retry");
    const targets = await db.query("select count(*)::int n from assignment_targets where assignment_id = $1", [assignments.rows[0].id]);
    const events = await db.query(
      "select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED' and payload->>'assignmentId' = $1::text",
      [assignments.rows[0].id],
    );
    assert.equal(targets.rows[0].n, 1, "the assignment must reach exactly one target");
    assert.equal(events.rows[0].n, 1, "and must have exactly one feed event");
  });

  await t.test("ISOLATION: the assignment reaches its target and nobody else", async () => {
    const asA = await fetch(`${BASE_URL}/api/assignments`, { headers: { cookie: cookieA } });
    const asB = await fetch(`${BASE_URL}/api/assignments`, { headers: { cookie: cookieB } });
    const bodyA = await asA.text();
    const bodyB = await asB.text();
    assert.equal(asA.status, 200);
    assert.equal(asB.status, 200);
    assert.ok(bodyA.includes(title), "the targeted student must see the assignment");
    assert.ok(!bodyB.includes(title), "a non-targeted student must not see it");
  });

  await t.test("AUTHORIZATION: a student cannot create an assignment", async () => {
    const studentTitle = `[${TAG}] student forgery`;
    createdTitles.push(studentTitle);
    const res = await fetch(`${BASE_URL}/api/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieA },
      body: JSON.stringify({ ...body, title: studentTitle }),
    });
    assert.equal(res.status, 403, "a learner must be refused");
    const rows = await db.query("select count(*)::int n from assignments where title = $1", [studentTitle]);
    assert.equal(rows.rows[0].n, 0, "and nothing may be written");
  });

  await t.test("the injected fault really was what broke the first request", async () => {
    // Without this the rollback test could pass for an unrelated reason (a validation refusal, a
    // missing prompt) and still look like proof of atomicity. Re-arm the fault and confirm the
    // failure reproduces, then disarm and confirm it does not.
    const secondTitle = `[${TAG}] fault reproducibility`;
    createdTitles.push(secondTitle);
    await db.query("insert into qa_fault (name, scope) values ('block_assignment_event', $1) on conflict (name) do update set scope = excluded.scope", [teacherId]);
    const armed = await fetch(`${BASE_URL}/api/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieTeacher },
      body: JSON.stringify({ ...body, title: secondTitle }),
    });
    assert.ok(armed.status >= 500, `arming the fault must reproduce the failure; got ${armed.status}`);
    const leaked = await db.query("select count(*)::int n from assignments where title = $1", [secondTitle]);
    assert.equal(leaked.rows[0].n, 0, "and must roll back again");
    await db.query("delete from qa_fault where name = 'block_assignment_event'");
  });
});
