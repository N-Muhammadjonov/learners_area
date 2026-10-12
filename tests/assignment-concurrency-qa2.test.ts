import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

/**
 * B3-05 / B3-07 — ASSIGNMENT CREATION UNDER GENUINE CONCURRENCY, and cross-student isolation.
 *
 * WHAT WAS ALREADY PROVEN, and is not repeated here: tests/assignment-atomicity-qa2.test.ts injects
 * a real PostgreSQL BEFORE INSERT trigger on `activity_events` and shows that a failed event write
 * rolls back the assignment and its target, and that a retry creates exactly one (B3-02, B3-03,
 * B3-04). That covers the failure path of a SINGLE request.
 *
 * WHAT THIS ADDS is the case a sequential test cannot reach. Two requests in flight at the same time
 * exercise interleaving that no ordering of one-at-a-time calls can produce: torn writes where an
 * assignment lands without its target or its event, attribution bleed where one request's row picks
 * up another's teacher or learner, and the uniqueness contract on
 * `assignment_targets (assignment_id, student_user_id)` — a UNIQUE index whose whole purpose is to
 * arbitrate a race, and which a sequential test never asks to arbitrate anything.
 *
 * THE IDEMPOTENCY CONTRACT, taken from the code rather than assumed. src/app/api/assignments/route.ts
 * says explicitly: "Assigned work is not idempotent under a client-generated key". There is no
 * idempotency-key column and no uniqueness constraint on `assignments` beyond its primary key. So six
 * concurrent identical POSTs are six distinct teacher intents and MUST create six assignments — a
 * test that demanded one would be asserting a dedupe feature the product does not have and quietly
 * inviting somebody to build one. What concurrency must not produce is inconsistency BETWEEN the
 * three rows each request writes, and that is what is asserted here: 1:1:1 across assignments,
 * targets and events, every target pointing at the intended learner, every assignment attributed to
 * the requesting teacher.
 *
 * CONCURRENCY IS MEASURED, NOT CLAIMED. Firing requests through Promise.all is not evidence that
 * they overlapped; a serialized server would produce the same calls. Each request records the
 * instants it went out and came back, and the test asserts that the maximum number simultaneously in
 * flight exceeded one. Without that, "concurrent" in the test name would be decoration.
 */

import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("assignment-concurrency-qa2");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("assignment-concurrency-qa2", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const GATED = process.env.QA2_DATABASE_TESTS !== "1";

test("concurrent assignment creation stays internally consistent, the target uniqueness index arbitrates a real race, and an assignment for one learner is invisible to another", { skip: GATED }, async (t) => {
  const target = new URL(DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/learners_qa2",
    `refusing to run against ${target.hostname}${target.pathname}: this test writes fixtures`,
  );

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  // A second, independent connection: a uniqueness race has to be raced by two real backends, and
  // one client would serialize the two inserts behind its own protocol.
  const db2 = new pg.Client({ connectionString: DATABASE_URL });
  await db2.connect();

  const created = { assignments: [] as string[], targets: [] as string[], events: [] as string[] };
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

  async function cleanup() {
    // Child first: assignment_targets references assignments.
    for (const id of created.assignments) {
      await db.query("delete from assignment_targets where assignment_id = $1", [id]).catch(() => {});
      await db.query("delete from activity_events where type='ASSIGNMENT_CREATED' and payload->>'assignmentId' = $1", [id]).catch(() => {});
      await db.query("delete from assignments where id = $1", [id]).catch(() => {});
    }
    for (const id of created.targets) await db.query("delete from assignment_targets where id = $1", [id]).catch(() => {});
  }

  try {
    // ---------------------------------------------------------------- fixtures
    const login = async (email: string, password: string) => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.243" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200, `login ${email} -> ${res.status}`);
      return (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().map((c) => c.split(";")[0]).join("; ");
    };
    const teacherCookie = await login("teacher@learnersarea.uz", "Teacher12345!");
    const studentACookie = await login("demo.student@learnersarea.uz", "Student12345!");
    const studentBCookie = await login("new.student@learnersarea.uz", "Student12345!");

    const { rows: teachers } = await db.query("select id from users where email = 'teacher@learnersarea.uz'");
    const { rows: students } = await db.query("select id, email from users where email in ('demo.student@learnersarea.uz','new.student@learnersarea.uz') order by email");
    const teacherId = teachers[0]!.id as string;
    // Sorted by email: demo.student@ (A) then new.student@ (B).
    const studentA = students[0]!.id as string;
    const studentB = students[1]!.id as string;
    assert.notEqual(studentA, studentB, "need two distinct learners");
    const promptId = (await db.query("select id from writing_prompts order by created_at limit 1")).rows[0]?.id as string;
    assert.ok(promptId, "no writing prompt to assign — the legacy assignment path needs one");

    const post = async (cookie: string, body: Record<string, unknown>) => {
      const res = await fetch(`${BASE_URL}/api/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    // ------------------------------------------------- B3-05 concurrent creation
    const CONCURRENCY = 6;
    const title = `QA2 concurrent assignment ${Date.now().toString(36)}`;
    const payload = { title, targetUserId: studentA, relatedWritingPromptId: promptId };

    const before = {
      assignments: await count("select count(*)::int n from assignments"),
      targets: await count("select count(*)::int n from assignment_targets"),
      events: await count("select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED'"),
    };

    // Record the in-flight window of each request so overlap can be proved afterwards.
    const windows: Array<{ start: number; end: number }> = [];
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const start = Date.now();
        const res = await post(teacherCookie, payload);
        windows.push({ start, end: Date.now() });
        return res;
      }),
    );

    // Genuine overlap: reconstruct the maximum number of requests in flight at any instant.
    const events = windows.flatMap((w) => [{ at: w.start, delta: 1 }, { at: w.end, delta: -1 }]).sort((a, b) => a.at - b.at || a.delta - b.delta);
    let inFlight = 0;
    let peak = 0;
    for (const e of events) { inFlight += e.delta; peak = Math.max(peak, inFlight); }
    await t.test(`B3-05a the ${CONCURRENCY} requests really were concurrent (peak in flight ${peak})`, () => {
      assert.ok(peak > 1, `peak simultaneous in-flight requests was ${peak}; a serialized run cannot prove a race`);
    });

    const okResponses = responses.filter((r) => r.status >= 200 && r.status < 300);
    const returnedIds = okResponses.map((r) => (r.body as { assignment?: { id?: string } })?.assignment?.id).filter((id): id is string => Boolean(id));
    await t.test("B3-05b every concurrent request succeeded and returned its own assignment id", () => {
      assert.equal(okResponses.length, CONCURRENCY, `statuses: ${responses.map((r) => r.status).join(",")}`);
      assert.equal(new Set(returnedIds).size, CONCURRENCY, `ids were not distinct: ${returnedIds.join(",")}`);
    });

    const after = {
      assignments: await count("select count(*)::int n from assignments"),
      targets: await count("select count(*)::int n from assignment_targets"),
      events: await count("select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED'"),
    };
    created.assignments.push(...returnedIds);
    const made = {
      assignments: after.assignments - before.assignments,
      targets: after.targets - before.targets,
      events: after.events - before.events,
    };

    // The product is documented as NOT idempotent per request, so N concurrent intents create N
    // assignments. The invariant is that the three rows each request writes stay in step.
    await t.test("B3-05c no torn write: assignments, targets and events were created 1:1:1", () => {
      assert.equal(made.assignments, CONCURRENCY, `${made.assignments} assignments for ${CONCURRENCY} requests`);
      assert.equal(made.targets, made.assignments, `${made.targets} targets for ${made.assignments} assignments — an assignment without its target is invisible to the learner`);
      assert.equal(made.events, made.assignments, `${made.events} ASSIGNMENT_CREATED events for ${made.assignments} assignments`);
    });

    const { rows: linked } = await db.query(
      `select a.id, a.created_by_user_id, a.title, t.student_user_id
         from assignments a
         left join assignment_targets t on t.assignment_id = a.id
        where a.id = any($1::uuid[])`,
      [returnedIds],
    );
    await t.test("B3-05d no attribution bleed: every row carries this teacher and this learner", () => {
      assert.equal(linked.length, CONCURRENCY);
      for (const row of linked) {
        assert.equal(row.title, title, "a concurrent request wrote a different title");
        assert.equal(row.created_by_user_id, teacherId, `assignment ${row.id} attributed to ${row.created_by_user_id}, not the requesting teacher`);
        assert.equal(row.student_user_id, studentA, `assignment ${row.id} targeted ${row.student_user_id}, not the intended learner`);
      }
    });

    const dupPairs = await count(
      `select count(*)::int n from (
         select assignment_id, student_user_id from assignment_targets
          where assignment_id = any($1::uuid[])
          group by 1,2 having count(*) > 1) d`,
      [returnedIds],
    );
    await t.test("B3-05e the unique (assignment_id, student_user_id) pair was not violated", () => {
      assert.equal(dupPairs, 0, `${dupPairs} duplicated target pair(s)`);
    });

    // ------------------------------- B3-05f the uniqueness index arbitrates a race
    // Two independent backends inserting the SAME pair at the same instant. This is the only place
    // in assignment creation where the contract demands uniqueness rather than N independent rows,
    // so it is the race worth forcing.
    const [raceRow] = (await db.query(
      `insert into assignments (title, created_by_user_id, target_user_id, related_writing_prompt_id)
       values ($1,$2,$3,$4) returning id`,
      [`QA2 uniqueness race ${Date.now().toString(36)}`, teacherId, studentA, promptId],
    )).rows;
    const raceAssignment = raceRow!.id as string;
    created.assignments.push(raceAssignment);

    const insertTarget = (client: pg.Client, tag: string) =>
      client.query(
        `insert into assignment_targets (assignment_id, student_user_id) values ($1,$2) returning id`,
        [raceAssignment, studentA],
      ).then((r) => ({ tag, ok: true as const, id: r.rows[0]!.id as string }))
        .catch((e: { code?: string; message?: string }) => ({ tag, ok: false as const, code: e.code ?? "", message: e.message ?? "" }));

    const [first, second] = await Promise.all([insertTarget(db, "backend-1"), insertTarget(db2, "backend-2")]);
    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);
    for (const w of winners) created.targets.push((w as { id: string }).id);

    await t.test("B3-05f two concurrent inserts of the same target pair: exactly one wins, the other is a unique violation", () => {
      assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}: ${JSON.stringify([first, second]).slice(0, 200)}`);
      assert.equal(losers.length, 1);
      assert.equal((losers[0] as { code: string }).code, "23505", `loser failed with ${(losers[0] as { code: string; message: string }).code} / ${(losers[0] as { message: string }).message.slice(0, 90)}, not a unique violation`);
    });
    const pairRows = await count("select count(*)::int n from assignment_targets where assignment_id = $1", [raceAssignment]);
    await t.test("and the table holds exactly one target row for that pair", () => {
      assert.equal(pairRows, 1, `${pairRows} rows survived the race`);
    });

    // ------------------------------------------- B3-07 cross-student isolation
    const listFor = async (cookie: string) => {
      const res = await fetch(`${BASE_URL}/api/assignments`, { headers: { cookie } });
      return { status: res.status, text: await res.text() };
    };
    const asA = await listFor(studentACookie);
    const asB = await listFor(studentBCookie);
    const bRowsForA = await count("select count(*)::int n from assignment_targets where student_user_id = $1 and assignment_id = any($2::uuid[])", [studentB, returnedIds]);

    await t.test("B3-07 the targeted learner sees the assignment and the other learner does not", () => {
      assert.equal(asA.status, 200, `student A list -> ${asA.status}`);
      assert.equal(asB.status, 200, `student B list -> ${asB.status}`);
      assert.ok(asA.text.includes(title), "student A's own assignment list does not contain the assignment they were given");
      assert.ok(!asB.text.includes(title), "student B can see an assignment targeted at student A");
    });
    await t.test("B3-07 and the database agrees: zero target rows point at the other learner", () => {
      assert.equal(bRowsForA, 0, `${bRowsForA} assignment_targets row(s) link student B to student A's assignments`);
    });
  } finally {
    await cleanup();
    // Cleanup failure must fail the run rather than hide behind a green test.
    const leftAssignments = await count("select count(*)::int n from assignments where title like 'QA2 concurrent assignment%' or title like 'QA2 uniqueness race%'");
    const leftTargets = await count("select count(*)::int n from assignment_targets t where not exists (select 1 from assignments a where a.id = t.assignment_id)");
    await db2.end().catch(() => {});
    await db.end().catch(() => {});
    assert.equal(leftAssignments, 0, `cleanup left ${leftAssignments} QA2 assignment row(s) behind`);
    assert.equal(leftTargets, 0, `cleanup left ${leftTargets} orphaned assignment_targets row(s) behind`);
  }
});
