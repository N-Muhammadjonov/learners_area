#!/usr/bin/env node
/*
 * §04 — BROWSER/HTTP CHECK for the three remaining write units.
 *
 * WHY AN HTTP PROBE AND NOT A UNIT TEST. All three write units live inside Next.js route handlers
 * that gate on `requireActiveUser()`, which reads the request's cookies. No test in this repository
 * imports a route handler directly — they assert on source instead — so there is no seam to call
 * these with a fabricated identity. Driving the real route through a real logged-in Chromium session
 * tests the actual path, including authentication, which a mocked handler would not.
 *
 * THE FAULT IS REAL. For each unit a PostgreSQL BEFORE INSERT trigger on `activity_events`, scoped to
 * this one learner and this one event type, is armed while the production server runs against the
 * same database. The assertion is always the same shape: when the event write fails, the write it is
 * paired with must NOT survive.
 *
 *   A  POST /api/vocabulary/:id/use        VOCABULARY_USED          pairs with the usage confirmation
 *   B  POST /api/live-classes/:id/join     LIVE_CLASS_ATTENDED      pairs with the attendance row
 *   C  POST /api/grammar/exercises/:id/practice  GRAMMAR_PRACTICE_SUBMITTED  pairs with the attempt row
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. In A the sentence row itself is written BEFORE the evaluation and
 * is meant to survive a later failure — the route's own 502 branch documents that the sentence stays
 * in the bank, labelled unevaluated, worth nothing. So A asserts the CONFIRMATION rolls back
 * (evaluation_id, points), not the sentence row. That distinction is the difference between testing
 * the product and testing a misunderstanding of it.
 *
 * NOTHING IS LEFT BEHIND. The trigger and scratch table are dropped and the drops verified; the live
 * class status this probe changes is restored; the rows it creates are deleted; and the whole-database
 * row total is asserted back to the value measured before the probe started.
 */
import { createSession, launchBrowser } from "./lib/browser-qa.mjs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const EMAIL = "demo.student@learnersarea.uz";
const PASSWORD = "Student12345!";
const FAULT_TABLE = "qa_fault_units_tbl";
const TRIGGER = "qa_fault_units_events";
const FN = "qa_fault_units_guard";

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

const client = new pg.Client({ connectionString: DATABASE_URL });
client.on("error", () => {});
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0]?.n ?? 0;
const wholeDbTotal = async () => {
  const tables = (
    await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    )
  ).rows.map((row) => row.table_name);
  let total = 0;
  for (const table of tables) total += await one(`select count(*)::int n from "${table}"`);
  return total;
};

let installed = false;
let armedType = null;
let browser = null;
let session = null;
let userId = "";
let restoreClassId = null;
let restoreClassStatus = null;
const startedAt = new Date();
let baselineTotal = -1;

/** Arm the fault for exactly one event type, scoped to this learner. */
const arm = async (eventType) => {
  await client.query(
    `insert into ${FAULT_TABLE} (name, scope) values ($1, $2) on conflict (name) do update set scope = excluded.scope`,
    [eventType, userId],
  );
  armedType = eventType;
};
const disarm = async () => {
  await client.query(`delete from ${FAULT_TABLE}`).catch(() => {});
  armedType = null;
};

try {
  await client.connect();
  baselineTotal = await wholeDbTotal();

  const learner = (await client.query("select id from users where email = $1", [EMAIL])).rows[0];
  if (!learner) throw new Error(`no seeded learner at ${EMAIL} — seed the QA database first`);
  userId = learner.id;

  // Fixtures the three routes need, resolved from the seeded data rather than invented.
  const vocabEntry = (
    await client.query(
      `select uv.id, l.term from user_vocabulary uv join lexemes l on l.id = uv.lexeme_id
        where uv.user_id = $1 order by l.term limit 1`,
      [userId],
    )
  ).rows[0];
  const liveClass = (await client.query("select id, status from live_classes limit 1")).rows[0];
  const grammarExercise = (
    await client.query(
      `select e.id, e.target_structures from grammar_exercises e
        where jsonb_array_length(coalesce(e.target_structures, '[]'::jsonb)) > 0
        order by e."order" limit 1`,
    )
  ).rows[0];
  check("fixtures exist for all three routes", !!vocabEntry && !!liveClass && !!grammarExercise,
    `vocab=${!!vocabEntry} class=${!!liveClass} grammar=${!!grammarExercise}`);
  if (!vocabEntry || !liveClass || !grammarExercise) throw new Error("missing fixtures");

  browser = await launchBrowser();
  session = await createSession(browser, { base: BASE, email: EMAIL, password: PASSWORD, viewport: 1440 });
  const home = await session.goto("/app");
  check("the learner session is real and not bounced to login", home.status === 200 && !home.url.includes("/login"), `HTTP ${home.status} ${home.url}`);

  const post = async (path, body) =>
    session.page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        return { status: response.status, body: (await response.text()).slice(0, 300) };
      },
      { path, body },
    );

  // Install one trigger covering every event type this probe faults.
  await client.query(`create table if not exists ${FAULT_TABLE} (name text primary key, scope text)`);
  await client.query(`
    create or replace function ${FN}() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from ${FAULT_TABLE} where name = new.type and scope = new.user_id::text) then
        raise exception 'qa fault: % event write blocked', new.type;
      end if;
      return new;
    end;
    $$;
  `);
  await client.query(`drop trigger if exists ${TRIGGER} on activity_events`);
  await client.query(`create trigger ${TRIGGER} before insert on activity_events for each row execute function ${FN}()`);
  installed = true;
  check("the fault trigger is really installed",
    (await one("select count(distinct trigger_name)::int n from information_schema.triggers where trigger_name = $1", [TRIGGER])) === 1);

  const eventCount = (type) =>
    one("select count(*)::int n from activity_events where user_id = $1 and type = $2", [userId, type]);

  // ══ A — vocabulary use: the confirmation and its event ══════════════════════════════════════
  {
    const TYPE = "VOCABULARY_USED";
    const sentence = `Mitigation matters, so ${vocabEntry.term} belongs in this sentence written for the probe.`;
    const beforeEvents = await eventCount(TYPE);
    const beforePoints = await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);

    await arm(TYPE);
    const errorsBefore = session.consoleErrors.length;
    const failed = await post(`/api/vocabulary/${vocabEntry.id}/use`, { sentence });
    check("A: a failing event answers 5xx, never a fake success", failed.status >= 500, `HTTP ${failed.status} ${failed.body}`);
    // The sentence row is written before the evaluation and is MEANT to survive; the confirmation is not.
    const unconfirmed = await one(
      `select count(*)::int n from vocabulary_usages
        where user_id = $1 and created_at >= $2 and evaluation_id is null`,
      [userId, startedAt],
    );
    const confirmed = await one(
      `select count(*)::int n from vocabulary_usages
        where user_id = $1 and created_at >= $2 and evaluation_id is not null`,
      [userId, startedAt],
    );
    check("A: no usage was confirmed by the rolled-back call", confirmed === 0, `${confirmed} confirmed row(s) survived`);
    check("A: the sentence itself survives, unevaluated, exactly as the 502 contract states", unconfirmed >= 1, `${unconfirmed} unconfirmed row(s)`);
    check("A: no points were awarded", (await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId])) === beforePoints);
    check("A: no event survived", (await eventCount(TYPE)) === beforeEvents, `${beforeEvents} -> ${await eventCount(TYPE)}`);
    check("A: the only console errors are the probe's own deliberate 5xx",
      session.consoleErrors.slice(errorsBefore).every((text) => /50\d|Internal Server Error|failed/.test(text)),
      session.consoleErrors.slice(errorsBefore).join(" | "));

    await disarm();
    const retried = await post(`/api/vocabulary/${vocabEntry.id}/use`, { sentence: `${sentence} Retried once.` });
    check("A: the retry is accepted", retried.status === 200, `HTTP ${retried.status} ${retried.body}`);
    check("A: the retry confirmed exactly one usage",
      (await one(`select count(*)::int n from vocabulary_usages where user_id = $1 and created_at >= $2 and evaluation_id is not null`, [userId, startedAt])) === 1);
    check("A: the retry wrote exactly one event", (await eventCount(TYPE)) === beforeEvents + 1, `${beforeEvents} -> ${await eventCount(TYPE)}`);
  }

  // ══ B — live class join: attendance and its event ═══════════════════════════════════════════
  {
    const TYPE = "LIVE_CLASS_ATTENDED";
    // joinState() opens the room immediately when status is 'live'. Restored in the finally block.
    restoreClassId = liveClass.id;
    restoreClassStatus = liveClass.status;
    await client.query("update live_classes set status = 'live' where id = $1", [liveClass.id]);

    const attendance = () =>
      one("select count(*)::int n from live_class_attendance where live_class_id = $1 and user_id = $2", [liveClass.id, userId]);
    const beforeEvents = await eventCount(TYPE);
    const beforeAttendance = await attendance();

    await arm(TYPE);
    const failed = await post(`/api/live-classes/${liveClass.id}/join`, {});
    check("B: a failing event answers 5xx", failed.status >= 500, `HTTP ${failed.status} ${failed.body}`);
    check("B: no attendance row survived the rolled-back event", (await attendance()) === beforeAttendance,
      `${beforeAttendance} -> ${await attendance()}`);
    check("B: no event survived", (await eventCount(TYPE)) === beforeEvents);

    await disarm();
    const retried = await post(`/api/live-classes/${liveClass.id}/join`, {});
    check("B: the retry joins successfully", retried.status === 200, `HTTP ${retried.status} ${retried.body}`);
    check("B: the retry wrote exactly one attendance row", (await attendance()) === beforeAttendance + 1);
    check("B: the retry wrote exactly one event", (await eventCount(TYPE)) === beforeEvents + 1);
    // A second join must not duplicate either row.
    const again = await post(`/api/live-classes/${liveClass.id}/join`, {});
    check("B: a repeat join is accepted", again.status === 200, `HTTP ${again.status}`);
    check("B: a repeat join adds no second attendance row", (await attendance()) === beforeAttendance + 1);
    check("B: a repeat join adds no second event", (await eventCount(TYPE)) === beforeEvents + 1);
  }

  // ══ C — deterministic grammar practice: attempt and its event ═══════════════════════════════
  {
    const TYPE = "GRAMMAR_PRACTICE_SUBMITTED";
    const structures = grammarExercise.target_structures ?? [];
    // A translate_it answer containing every target structure is graded by the deterministic
    // checklist, so this exercises the branch with no external evaluator in it.
    const answer = `Regarding the city, ${structures.join(" and ")} together explain the situation clearly.`;
    const attempts = () =>
      one("select count(*)::int n from grammar_attempts where user_id = $1 and exercise_id = $2", [userId, grammarExercise.id]);
    const beforeEvents = await eventCount(TYPE);
    const beforeAttempts = await attempts();

    await arm(TYPE);
    const failed = await post(`/api/grammar/exercises/${grammarExercise.id}/practice`, { activity: "translate_it", answer });
    check("C: a failing event answers 5xx", failed.status >= 500, `HTTP ${failed.status} ${failed.body}`);
    check("C: no attempt row survived the rolled-back event", (await attempts()) === beforeAttempts,
      `${beforeAttempts} -> ${await attempts()}`);
    check("C: no event survived", (await eventCount(TYPE)) === beforeEvents);

    await disarm();
    const retried = await post(`/api/grammar/exercises/${grammarExercise.id}/practice`, { activity: "translate_it", answer });
    check("C: the retry is accepted", retried.status === 200, `HTTP ${retried.status} ${retried.body}`);
    check("C: the retry wrote exactly one attempt row", (await attempts()) === beforeAttempts + 1);
    check("C: the retry wrote exactly one event", (await eventCount(TYPE)) === beforeEvents + 1);
  }
} catch (error) {
  check("the probe ran to completion", false, String(error?.message ?? error));
} finally {
  await disarm();
  if (installed) await client.query(`drop trigger if exists ${TRIGGER} on activity_events`).catch(() => {});
  await client.query(`drop function if exists ${FN}()`).catch(() => {});
  await client.query(`drop table if exists ${FAULT_TABLE}`).catch(() => {});
  check("the injected trigger is gone",
    (await one("select count(distinct trigger_name)::int n from information_schema.triggers where trigger_name = $1", [TRIGGER]).catch(() => -1)) === 0);
  check("the scratch fault table is gone",
    (await one("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = $1", [FAULT_TABLE]).catch(() => -1)) === 0);

  // Restore the live class this probe put into the 'live' state.
  if (restoreClassId && restoreClassStatus) {
    await client.query("update live_classes set status = $1 where id = $2", [restoreClassStatus, restoreClassId]).catch(() => {});
    const now = (await client.query("select status from live_classes where id = $1", [restoreClassId])).rows[0]?.status;
    check("the live class status was restored", now === restoreClassStatus, `${now} !== ${restoreClassStatus}`);
  }

  // Remove what this probe wrote, so the seeded learner is exactly as it was found.
  if (userId) {
    for (const [sql, params] of [
      [`delete from vocabulary_usages where user_id = $1 and created_at >= $2`, [userId, startedAt]],
      [`delete from vocab_point_events where user_id = $1 and created_at >= $2`, [userId, startedAt]],
      [`delete from live_class_attendance where user_id = $1 and joined_at >= $2`, [userId, startedAt]],
      [`delete from grammar_attempts where user_id = $1 and attempted_at >= $2`, [userId, startedAt]],
      [`delete from activity_events where user_id = $1 and created_at >= $2`, [userId, startedAt]],
      [`delete from evaluations where user_id = $1 and created_at >= $2`, [userId, startedAt]],
    ]) {
      await client.query(sql, params).catch(() => {});
    }
  }
  const afterTotal = await wholeDbTotal().catch(() => -1);
  check("the whole database is back to its pre-probe row count",
    baselineTotal >= 0 && afterTotal === baselineTotal, `${baselineTotal} before, ${afterTotal} after`);

  if (session) await session.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  await client.end().catch(() => {});
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join("; ")}`);
  process.exit(1);
}
