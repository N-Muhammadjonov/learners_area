#!/usr/bin/env node
/**
 * Retention policy, against the real database, with controlled timestamps.
 *
 *   DATABASE_URL=... node scripts/verify-retention.mjs [baseUrl]
 *
 * Throwaway rows are written with three-year-old timestamps, so the real run
 * (which uses the real clock) has something to act on without touching a single
 * row of demo content. The checks that matter:
 *
 *   - a preview changes nothing, and reports what a real run would remove;
 *   - a real run removes only rows past their window;
 *   - recent data, a recently active student, and exercise/content rows survive;
 *   - a second run removes nothing (idempotent);
 *   - the inactivity rule reads real work, not sign-ins;
 *   - what an applicant wrote expires with the same window, while the decision
 *     about them stays.
 */
import assert from "node:assert/strict";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It already removed its temporary accounts, but the audit entries their lifecycle generated were left behind.
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
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-retention" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-retention",
    tables: ["audit_log", "activity_events", "notifications"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-retention",
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
// This probe writes fixtures. Refuse any database that is not disposable QA.
const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");
__assertMutableDb(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`not ok - ${name}\n         ${String(error.message).slice(0, 300)}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `${email} kira olmadi: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "owner@learnersarea.uz");
const OWNER_PASSWORD = (process.env.OWNER_PASSWORD || "Owner12345!");
const ownerCookie = await login(OWNER_EMAIL, OWNER_PASSWORD);

async function run(dryRun) {
  const res = await fetch(`${BASE}/api/owner/retention`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ dryRun }),
  });
  assert.equal(res.status, 200, `retention endpointi ${res.status} qaytardi`);
  return res.json();
}

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;
const old = new Date(Date.now() - THREE_YEARS_MS);
const recent = new Date();

// --- throwaway fixtures -----------------------------------------------------
// A previous interrupted run must not block this one: its fixtures go first, so
// the counts asserted below belong to this run alone.
await pool.query("delete from activity_events where type like 'RETENTION_FIXTURE%'");
await pool.query("delete from audit_log where action like 'retention.fixture%'");
await pool.query("delete from users where email in ('retention.dormant@example.test', 'retention.active@example.test')");

const { rows: dormant } = await pool.query(
  `insert into users (name, email, password_hash, role, account_status, created_at, last_active_at)
   values ('Retention Dormant', 'retention.dormant@example.test', 'x', 'student', 'active', $1, $2) returning id`,
  [old, old]
);
const { rows: active } = await pool.query(
  `insert into users (name, email, password_hash, role, account_status, created_at, last_active_at, last_meaningful_activity_at)
   values ('Retention Active', 'retention.active@example.test', 'x', 'student', 'active', $1, $2, $3) returning id`,
  [old, recent, recent]
);
const dormantId = dormant[0].id;
const activeId = active[0].id;

await pool.query(
  `insert into activity_events (user_id, type, payload, created_at) values ($1, 'RETENTION_FIXTURE_OLD', '{}'::jsonb, $2)`,
  [dormantId, old]
);
await pool.query(
  `insert into activity_events (user_id, type, payload, created_at) values ($1, 'RETENTION_FIXTURE_NEW', '{}'::jsonb, $2)`,
  [dormantId, recent]
);
await pool.query(
  `insert into notifications (user_id, type, title, body, read_at, created_at)
   values ($1, 'system', 'Eski', 'x', $2, $2)`,
  [dormantId, old]
);
await pool.query(
  `insert into audit_log (actor_user_id, action, metadata, created_at) values ($1, 'retention.fixture_old', '{}'::jsonb, $2)`,
  [dormantId, old]
);
await pool.query(
  `insert into audit_log (actor_user_id, action, metadata, created_at) values ($1, 'retention.fixture_new', '{}'::jsonb, $2)`,
  [dormantId, recent]
);
// Two decided applications: one decided long ago (its free text must be gone
// after a real run) and one decided yesterday (whose note must survive). The
// decision rows themselves must survive both.
const { rows: oldApplication } = await pool.query(
  `insert into access_requests (user_id, status, message, decision_note, decided_at, created_at)
   values ($1, 'rejected', 'Men shu kursga juda qiziqaman', 'Guruhda joy yo''q edi', $2, $2) returning id`,
  [dormantId, old]
);
const { rows: freshApplication } = await pool.query(
  `insert into access_requests (user_id, status, message, decision_note, decided_at, created_at)
   values ($1, 'approved', 'Kechqurun o''qiy olaman', 'Guruhga qo''shildi', $2, $2) returning id`,
  [activeId, recent]
);
const oldApplicationId = oldApplication[0].id;
const freshApplicationId = freshApplication[0].id;

const { rows: passage } = await pool.query("select id from reading_passages limit 1");
const { rows: oldAttempt } = await pool.query(
  `insert into reading_attempts (user_id, passage_id, status, started_at, submitted_at)
   values ($1, $2, 'completed', $3, $3) returning id`,
  [activeId, passage[0].id, old]
);
const { rows: freshAttempt } = await pool.query(
  `insert into reading_attempts (user_id, passage_id, status, started_at, submitted_at)
   values ($1, $2, 'completed', $3, $3) returning id`,
  [activeId, passage[0].id, recent]
);
const { rows: evaluatedAttempt } = await pool.query(
  `insert into reading_attempts (user_id, passage_id, status, started_at, submitted_at)
   values ($1, $2, 'completed', $3, $3) returning id`,
  [activeId, passage[0].id, old]
);
await pool.query(
  `insert into evaluations (user_id, evaluation_type, source_type, source_id, provider_id, provider_display_name,
                            provider_type, provider_version, prompt_version, rubric_version, checked_by_name,
                            overall_estimate, confidence, verdict, criteria, strengths, weaknesses, issues,
                            next_actions, created_at)
   values ($1, 'assignment', 'reading_attempt', $2, 'riwi-core', 'RIWI Core', 'internal', 'v1', 'v1', 'v1',
           'RIWI Core', 6.5, 0.7, 'mostly_correct', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $3)`,
  [activeId, evaluatedAttempt[0].id, recent]
);

const countsBefore = await pool.query(
  `select (select count(*)::int from courses) courses, (select count(*)::int from lessons) lessons,
          (select count(*)::int from speaking_materials) materials, (select count(*)::int from writing_prompts) prompts`
);

// --- checks -----------------------------------------------------------------
try {
  const preview = await run(true);
  const byRule = Object.fromEntries(preview.results.map((r) => [r.rule, r]));
  await check("preview rejimi hech narsani o'chirmaydi", async () => {
    assert.equal(preview.dryRun, true);
    const { rows } = await pool.query("select count(*)::int as c from activity_events where type = 'RETENTION_FIXTURE_OLD'");
    assert.equal(rows[0].c, 1, "preview o'chirib yubordi");
    const { rows: auditRows } = await pool.query(
      "select count(*)::int as c from audit_log where action = 'retention.fixture_old'"
    );
    assert.equal(auditRows[0].c, 1);
  });

  await check("preview oynadan oshgan qatorlarni ko'rsatadi", async () => {
    assert.ok(byRule.learning_history, "learning_history qoidasi yo'q");
    assert.ok(byRule.learning_history.affected >= 1, `learning_history=${byRule.learning_history.affected}`);
    assert.ok(byRule.audit_history.affected >= 1);
    assert.ok(byRule.inactive_student_accounts.affected >= 1);
    assert.ok(byRule.applicant_free_text, "applicant_free_text qoidasi yo'q");
    assert.ok(byRule.applicant_free_text.affected >= 1, `applicant_free_text=${byRule.applicant_free_text.affected}`);
  });

  const applied = await run(false);
  const appliedByRule = Object.fromEntries(applied.results.map((r) => [r.rule, r]));

  await check("haqiqiy run faqat oynadan oshganini o'chiradi", async () => {
    const stale = await pool.query("select count(*)::int as c from activity_events where type = 'RETENTION_FIXTURE_OLD'");
    assert.equal(stale.rows[0].c, 0, "eski hodisa qoldi");
    const fresh = await pool.query("select count(*)::int as c from activity_events where type = 'RETENTION_FIXTURE_NEW'");
    assert.equal(fresh.rows[0].c, 1, "yangi hodisa o'chib ketdi");
    const oldAudit = await pool.query("select count(*)::int as c from audit_log where action = 'retention.fixture_old'");
    assert.equal(oldAudit.rows[0].c, 0);
    const newAudit = await pool.query("select count(*)::int as c from audit_log where action = 'retention.fixture_new'");
    assert.equal(newAudit.rows[0].c, 1, "yangi audit yozuvi o'chib ketdi");
  });

  await check("eski topshiriq o'chadi, yaqindagisi qoladi", async () => {
    const gone = await pool.query("select count(*)::int as c from reading_attempts where id = $1", [oldAttempt[0].id]);
    assert.equal(gone.rows[0].c, 0, "eski reading attempt qoldi");
    const kept = await pool.query("select count(*)::int as c from reading_attempts where id = $1", [freshAttempt[0].id]);
    assert.equal(kept.rows[0].c, 1, "yangi reading attempt o'chib ketdi");
  });

  await check("bahosi bor ish himoyalanadi", async () => {
    const kept = await pool.query("select count(*)::int as c from reading_attempts where id = $1", [evaluatedAttempt[0].id]);
    assert.equal(kept.rows[0].c, 1, "evaluatsiya manbasi o'chib ketdi — hisobot tekshirib bo'lmaydigan holga tushdi");
  });

  await check("kurs/biznes kontenti tegilmaydi", async () => {
    const after = await pool.query(
      `select (select count(*)::int from courses) courses, (select count(*)::int from lessons) lessons,
              (select count(*)::int from speaking_materials) materials, (select count(*)::int from writing_prompts) prompts`
    );
    assert.deepEqual(after.rows[0], countsBefore.rows[0]);
  });

  await check("ariza matni tozalanadi, qaror yozuvi qoladi", async () => {
    const stale = await pool.query(
      "select status, message, decision_note, decided_at from access_requests where id = $1",
      [oldApplicationId]
    );
    assert.equal(stale.rows[0].message, null, "eski ariza matni qoldi");
    assert.equal(stale.rows[0].decision_note, null, "eski qaror izohi qoldi");
    assert.equal(stale.rows[0].status, "rejected", "qaror natijasi o'chib ketdi");
    assert.ok(stale.rows[0].decided_at, "qaror sanasi o'chib ketdi");

    const fresh = await pool.query(
      "select status, message, decision_note from access_requests where id = $1",
      [freshApplicationId]
    );
    assert.equal(fresh.rows[0].message, "Kechqurun o'qiy olaman", "yaqindagi ariza matni o'chib ketdi");
    assert.equal(fresh.rows[0].decision_note, "Guruhga qo'shildi");

    // Ikkala qaror qatori ham joyida: retention qarorni o'chirmaydi.
    const rows = await pool.query(
      "select count(*)::int as c from access_requests where id in ($1, $2)",
      [oldApplicationId, freshApplicationId]
    );
    assert.equal(rows.rows[0].c, 2, "retention qaror qatorini o'chirib yubordi");
  });

  await check("faollik o'lchovi haqiqiy ish: login emas", async () => {
    const dormantRow = await pool.query("select email, account_status, status_reason from users where id = $1", [dormantId]);
    assert.equal(dormantRow.rows[0].account_status, "suspended", "3 yil ishlamagan student anonimlashtirilmadi");
    assert.equal(dormantRow.rows[0].email, null, "shaxsiy maydonlar tozalanmadi");
    assert.equal(dormantRow.rows[0].status_reason, "anonymised_by_retention");

    const activeRow = await pool.query("select email, account_status from users where id = $1", [activeId]);
    assert.equal(activeRow.rows[0].account_status, "active", "kecha ishlagan student o'chirildi");
    assert.equal(activeRow.rows[0].email, "retention.active@example.test");
    assert.equal(appliedByRule.inactive_student_accounts.applied, true);
  });

  await check("ikkinchi run hech narsani o'chirmaydi (idempotent)", async () => {
    const second = await run(false);
    const secondByRule = Object.fromEntries(second.results.map((r) => [r.rule, r]));
    assert.equal(secondByRule.learning_history.affected, 0, `ikkinchi run learning_history=${secondByRule.learning_history.affected}`);
    assert.equal(secondByRule.audit_history.affected, 0);
    assert.equal(secondByRule.inactive_student_accounts.affected, 0);
    assert.equal(secondByRule.evaluated_work_past_window.affected, 0);
    assert.equal(secondByRule.applicant_free_text.affected, 0, "ikkinchi run matnni yana tozalayapti");
  });

  await check("retention runi audit jurnaliga yoziladi", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as c from audit_log where action = 'retention.cleanup'"
    );
    assert.ok(rows[0].c >= 1, "audit yozuvi yo'q");
  });
} finally {
  // Fixtures go away; nothing real is touched.
  await pool.query("delete from activity_events where user_id in ($1, $2)", [dormantId, activeId]);
  await pool.query("delete from audit_log where action like 'retention.%' and actor_user_id in ($1, $2)", [dormantId, activeId]);
  await pool.query("delete from notifications where user_id in ($1, $2)", [dormantId, activeId]);
  await pool.query("delete from access_requests where id in ($1, $2)", [oldApplicationId, freshApplicationId]);
  await pool.query("delete from reading_attempts where user_id = $1", [activeId]);
  await pool.query("delete from users where id in ($1, $2)", [dormantId, activeId]);
  await pool.end();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failures.length || process.exitCode === 1 ? 1 : 0);
