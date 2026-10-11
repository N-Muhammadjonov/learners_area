#!/usr/bin/env node
/*
 * §8 / §12 — BROWSER CHECK for the vocabulary game answer write unit.
 *
 * WHAT THIS PROVES THAT THE QA2 TEST CANNOT. `tests/vocabulary-game-atomicity-qa2.test.ts` proves
 * `recordGameAnswer` is atomic at the service layer. This probe proves the same property through the
 * product's own HTTP route and a real logged-in Chromium session, which is the only place the
 * learner-visible form of the bug can appear:
 *
 *   1. When the point award fails, the route must answer 5xx and the practice event must NOT survive
 *      in PostgreSQL. Before the fix the event was committed first, so a learner whose award failed
 *      still had the attempt in their history and study streak.
 *   2. When the award succeeds, the browser's response must agree with the ledger: exactly one new
 *      `VOCAB_GAME_PRACTICED` event and exactly one new `vocab_point_events` row, and `awarded` must
 *      equal the server's own point value rather than anything the request claimed.
 *   3. The Games page must really render for that learner at 1440 and 390 px.
 *
 * THE FAULT IS REAL, NOT STUBBED. A PostgreSQL BEFORE INSERT trigger on `vocab_point_events`, scoped
 * to this one learner, is armed and disarmed from the probe while the application server runs against
 * the same database. No provider response is fabricated and no application code is patched.
 *
 * NOTHING IS LEFT BEHIND. The trigger, function and scratch table are dropped in a finally block and
 * the drops are verified; the rows this probe creates are deleted and the whole-database row total is
 * asserted back to the value measured before the probe started.
 */
import { createSession, launchBrowser } from "./lib/browser-qa.mjs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const EMAIL = "demo.student@learnersarea.uz";
const PASSWORD = "Student12345!";
const EVENT_TYPE = "VOCAB_GAME_PRACTICED";
const FAULT = "block_game_point_probe";
const FAULT_TABLE = "qa_fault_game_probe_tbl";
const TRIGGER = "qa_fault_game_probe_points";
const FN = "qa_fault_game_probe_guard";

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

let armed = false;
let installed = false;
let browser = null;
let session = null;
let userId = "";
let baselineTotal = -1;
const startedAt = new Date();

try {
  await client.connect();

  const baselineEvents = await one(
    "select count(*)::int n from activity_events where user_id = (select id from users where email = $1) and type = $2",
    [EMAIL, EVENT_TYPE],
  );
  baselineTotal = await wholeDbTotal();

  const learner = (
    await client.query("select id from users where email = $1", [EMAIL])
  ).rows[0];
  if (!learner) throw new Error(`no seeded learner at ${EMAIL} — seed the QA database first`);
  userId = learner.id;

  /*
   * TWO entries, not one. The point dedupe key is per (learner, entry, Tashkent day), so once the
   * positive control has been answered correctly, a same-day retry on that same entry correctly
   * awards nothing. Probing the fault on the control's entry would therefore fail the "retry awards
   * exactly one point" check for a reason that is the product working as designed, and the probe
   * would be blaming the application for its own setup. The fault leg gets its own entry.
   */
  const entries = (
    await client.query(
      `select uv.id, l.term, coalesce(nullif(trim(l.example_sentence), ''), l.definition_en) as answer
         from user_vocabulary uv join lexemes l on l.id = uv.lexeme_id
        where uv.user_id = $1
          and coalesce(nullif(trim(l.example_sentence), ''), l.definition_en) is not null
        order by l.term limit 2`,
      [userId],
    )
  ).rows;
  const controlEntry = entries[0];
  const faultEntry = entries[1];
  check(
    "the learner has two Vocabulary entries with gradable answers",
    !!controlEntry && !!faultEntry,
    `found ${entries.length}`,
  );
  if (!controlEntry || !faultEntry) {
    throw new Error("cannot exercise the game answer, and separately its failure, without two real entries");
  }

  const baselinePoints = await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);

  browser = await launchBrowser();
  session = await createSession(browser, { base: BASE, email: EMAIL, password: PASSWORD, viewport: 1440 });

  const games = await session.goto("/app/vocabulary/games/builder");
  check("the Builder game page renders for the logged-in learner", games.status === 200, `HTTP ${games.status}`);
  check("the route did not bounce to login", !games.url.includes("/login"), games.url);

  const submit = async (target) =>
    session.page.evaluate(
      async ({ answer, entryId }) => {
        const response = await fetch("/api/vocabulary/games", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            entryId,
            set: "all",
            gameId: "builder",
            submission: { kind: "sentence", text: answer },
          }),
        });
        const body = await response.text();
        return { status: response.status, body: body.slice(0, 400) };
      },
      { answer: target.answer, entryId: target.id },
    );

  // ── Positive control first: the answer really is correct and really awards a point. ────────────
  const errorsBeforeControl = session.consoleErrors.length;
  const control = await submit(controlEntry);
  const controlBody = JSON.parse(control.body || "{}");
  check("the browser's own answer is accepted", control.status === 200, `HTTP ${control.status} ${control.body}`);
  check("the server graded it correct and verified", controlBody.correct === true && controlBody.verified === true, control.body);
  check("the award is the server's own point value, not a client claim", controlBody.awarded === 1, control.body);
  const afterControlEvents = await one(
    "select count(*)::int n from activity_events where user_id = $1 and type = $2",
    [userId, EVENT_TYPE],
  );
  const afterControlPoints = await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);
  check("the ledger agrees with the browser: one new event", afterControlEvents === baselineEvents + 1, `${baselineEvents} -> ${afterControlEvents}`);
  check("the ledger agrees with the browser: one new point", afterControlPoints === baselinePoints + 1, `${baselinePoints} -> ${afterControlPoints}`);
  check("the successful answer produced no console error", session.consoleErrors.length === errorsBeforeControl, session.consoleErrors.slice(errorsBeforeControl).join(" | "));

  // ── Arm the fault, then fail the award from the browser. ──────────────────────────────────────
  await client.query(`create table if not exists ${FAULT_TABLE} (name text primary key, scope text)`);
  await client.query(`
    create or replace function ${FN}() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from ${FAULT_TABLE} where name = '${FAULT}' and (scope is null or scope = new.user_id::text)) then
        raise exception 'qa fault: game point award blocked';
      end if;
      return new;
    end;
    $$;
  `);
  await client.query(`drop trigger if exists ${TRIGGER} on vocab_point_events`);
  await client.query(`create trigger ${TRIGGER} before insert on vocab_point_events for each row execute function ${FN}()`);
  installed = true;
  check(
    "the fault trigger is really installed",
    (await one("select count(*)::int n from information_schema.triggers where trigger_name = $1", [TRIGGER])) === 1,
  );
  await client.query(`insert into ${FAULT_TABLE} (name, scope) values ($1, $2)`, [FAULT, userId]);
  armed = true;

  const errorsBeforeFault = session.consoleErrors.length;
  const failed = await submit(faultEntry);
  check("a failing award answers 5xx, never a fake success", failed.status >= 500, `HTTP ${failed.status} ${failed.body}`);

  const afterFaultEvents = await one(
    "select count(*)::int n from activity_events where user_id = $1 and type = $2",
    [userId, EVENT_TYPE],
  );
  const afterFaultPoints = await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);
  check(
    "no practice event survives the rolled-back award",
    afterFaultEvents === afterControlEvents,
    `${afterControlEvents} -> ${afterFaultEvents}: the learner's history and streak would record an attempt with no point row`,
  );
  check("the ledger is unchanged by the failed award", afterFaultPoints === afterControlPoints, `${afterControlPoints} -> ${afterFaultPoints}`);
  check(
    "the only console errors are the probe's own deliberate 5xx",
    session.consoleErrors.slice(errorsBeforeFault).every((text) => /50\d|Internal Server Error|failed/.test(text)),
    session.consoleErrors.slice(errorsBeforeFault).join(" | "),
  );

  // ── Disarm and retry through the browser. ─────────────────────────────────────────────────────
  await client.query(`delete from ${FAULT_TABLE} where name = $1`, [FAULT]);
  armed = false;
  const retried = await submit(faultEntry);
  check("the retry after the fault is accepted", retried.status === 200, `HTTP ${retried.status} ${retried.body}`);
  const retryBody = JSON.parse(retried.body || "{}");
  check("the retry awards exactly one point", retryBody.awarded === 1, retried.body);
  const afterRetryEvents = await one(
    "select count(*)::int n from activity_events where user_id = $1 and type = $2",
    [userId, EVENT_TYPE],
  );
  const afterRetryPoints = await one("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);
  check("the retry added exactly one event", afterRetryEvents === afterFaultEvents + 1, `${afterFaultEvents} -> ${afterRetryEvents}`);
  check("the retry added exactly one point", afterRetryPoints === afterFaultPoints + 1, `${afterFaultPoints} -> ${afterRetryPoints}`);

  // ── The page still renders at a phone width, with no sideways scroll. ─────────────────────────
  const narrow = await createSession(browser, { base: BASE, email: EMAIL, password: PASSWORD, viewport: 390 });
  const narrowNav = await narrow.goto("/app/vocabulary/games/builder");
  const overflow = await narrow.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("the Builder page renders at 390 px", narrowNav.status === 200, `HTTP ${narrowNav.status}`);
  check("no horizontal overflow at 390 px", overflow <= 0, `${overflow}px`);
  await narrow.close();
} catch (error) {
  check("the probe ran to completion", false, String(error?.message ?? error));
} finally {
  // Drop the fault before anything else: a trigger left armed would break every later write.
  if (installed) await client.query(`drop trigger if exists ${TRIGGER} on vocab_point_events`).catch(() => {});
  await client.query(`drop function if exists ${FN}()`).catch(() => {});
  if (armed) await client.query(`delete from ${FAULT_TABLE} where name = $1`, [FAULT]).catch(() => {});
  await client.query(`drop table if exists ${FAULT_TABLE}`).catch(() => {});

  const triggerLeft = await one("select count(*)::int n from information_schema.triggers where trigger_name = $1", [TRIGGER]).catch(() => -1);
  const tableLeft = await one(
    "select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = $1",
    [FAULT_TABLE],
  ).catch(() => -1);
  check("the injected trigger is gone", triggerLeft === 0, `still present: ${triggerLeft}`);
  check("the scratch fault table is gone", tableLeft === 0, `still present: ${tableLeft}`);

  // Remove what this probe wrote, so the seeded learner is exactly as it was found.
  if (userId) {
    await client.query(
      `delete from vocab_point_events where user_id = $1 and created_at >= $2`,
      [userId, startedAt],
    ).catch(() => {});
    await client.query(
      `delete from activity_events where user_id = $1 and type = $2 and created_at >= $3`,
      [userId, EVENT_TYPE, startedAt],
    ).catch(() => {});
  }

  const afterTotal = await wholeDbTotal().catch(() => -1);
  const learnerStillThere = await one("select count(*)::int n from users where email = $1", [EMAIL]).catch(() => 0);
  check("the seeded learner still exists", learnerStillThere === 1);
  // Not `>= 0`: an assertion that cannot fail is not a check. Compare against the total measured
  // before the probe wrote anything, so a row left behind fails this probe.
  check(
    "the whole database is back to its pre-probe row count",
    baselineTotal >= 0 && afterTotal === baselineTotal,
    `${baselineTotal} before, ${afterTotal} after`,
  );

  if (session) await session.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  await client.end().catch(() => {});
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join("; ")}`);
  process.exit(1);
}
