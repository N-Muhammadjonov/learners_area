/*
 * §8 / §12 — a vocabulary game answer's practice event and its point award are one write unit.
 *
 * THE DEFECT. `recordGameAnswer` (src/lib/services/vocabulary/engine.ts) wrote the learner's
 * `VOCAB_GAME_PRACTICED` activity event, then called `touchMeaningfulActivity`, then called
 * `awardPoints` — three separate statements with no transaction boundary. The event is not an audit
 * nicety: `loadSelfAssessments` reads those rows back to restore the learner's Learned / Not yet
 * marks, and `dashboard.ts` reads every event type to compute the study streak. So when the point
 * award failed, the practice event was already committed: the learner's history recorded an attempt
 * whose reward never existed, and a retry added a second event while `awardPoints` deduped the point.
 *
 * HOW THE FAILURE IS INJECTED. A real PostgreSQL `BEFORE INSERT` trigger on `vocab_point_events`,
 * scoped to this test's own learner, raises inside the application's own pooled connection. A
 * `set_config` GUC on the test connection cannot work: the application uses a different pooled
 * connection and would never see it. The fault is armed through a scratch table this file owns
 * exclusively and drops in `finally`, and the drop is asserted — leaving the table behind is schema
 * residue that breaks the next gated file's sweep (see 9.8 of docs/OWNER-DOSSIER.md).
 *
 * WHY THERE IS A POSITIVE CONTROL. A rollback assertion passes vacuously if the write never
 * happened: `not_found`, `not_in_set` and an unverified `self` judgement all return before reaching
 * the point award. The first subtest therefore proves a real, point-awarding answer reaches both
 * writes, and only then is the fault armed.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED AS FIXED. `awardPoints` dedupes per (learner, entry, Tashkent
 * day) while the practice event does not dedupe at all, so a same-day retry adds an event without a
 * second point. That asymmetry is recorded by the last subtest rather than silently repaired: making
 * the event idempotent is a product decision about what a repeated answer means, not an atomicity
 * question, and this file does not pretend to have answered it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { db as appDb } from "../src/db/client";
import { lexemes, users, userVocabulary } from "../src/db/schema";
import { recordGameAnswer } from "../src/lib/services/vocabulary/engine";
import { VOCAB_POINTS } from "../src/lib/services/vocabulary/points";

const PROBE = "vocabulary-game-atomicity-qa2";
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
const enabled =
  process.env.QA2_DATABASE_TESTS === "1" &&
  !!DATABASE_URL &&
  /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const skipReason = !enabled
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL (this test injects a database trigger)"
  : false;

const EVENT_TYPE = "VOCAB_GAME_PRACTICED";
const FAULT = "block_game_point";
/** Owned by this file alone, created and dropped here: a scratch table left behind is residue. */
const FAULT_TABLE = "qa_fault_game_tbl";
const TAG = `qa-game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The lexeme's example sentence, submitted verbatim so the server grades it correct and verified. */
const SENTENCE = "Trees can significantly mitigate heat in a city.";
/** Distinct Tashkent days, so each attempt has its own point dedupe key and none masks another. */
const day = (n: number) => new Date(`2026-03-0${n}T09:00:00+05:00`);

test("a game answer's practice event and its point award commit or roll back together", { skip: skipReason, timeout: 240_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();

  let installedTrigger = false;
  let userId = "";
  let entryId = "";

  const count = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0].n as number;
  const eventRows = () =>
    count("select count(*)::int n from activity_events where user_id = $1 and type = $2", [
      userId,
      EVENT_TYPE,
    ]);
  const pointRows = () =>
    count("select count(*)::int n from vocab_point_events where user_id = $1", [userId]);

  /** A real, point-awarding answer: `builder` + a `sentence` submission the server grades itself. */
  const answer = (now: Date) =>
    recordGameAnswer({
      userId,
      entryId,
      setKey: "all",
      gameId: "builder",
      submission: { kind: "sentence", text: SENTENCE },
      now,
    });

  try {
    await t.test("arrange: a learner with one Vocabulary entry of their own", async () => {
      const [user] = await appDb
        .insert(users)
        .values({
          email: `${TAG}@learners-qa.invalid`,
          name: "Game Atomicity",
          passwordHash: "x",
        } as typeof users.$inferInsert)
        .returning();
      userId = user!.id;
      const [lexeme] = await appDb
        .insert(lexemes)
        .values({
          term: "mitigate",
          definitionEn: "make less severe",
          translationUz: "yumshatmoq",
          exampleSentence: SENTENCE,
          senseKey: `mitigate::${TAG}`,
        } as typeof lexemes.$inferInsert)
        .returning();
      const [entry] = await appDb
        .insert(userVocabulary)
        .values({ userId, lexemeId: lexeme!.id } as typeof userVocabulary.$inferInsert)
        .returning();
      entryId = entry!.id;

      assert.ok(userId && entryId, "the learner and their Vocabulary entry must really exist");
      assert.equal(await eventRows(), 0, "the learner starts with no practice events");
      assert.equal(await pointRows(), 0, "the learner starts with no point awards");
    });

    await t.test("arrange: install the fault trigger on the point ledger, scoped to this learner", async () => {
      await db.query(`create table if not exists ${FAULT_TABLE} (name text primary key, scope text)`);
      await db.query(`
        create or replace function qa_fault_game_guard() returns trigger language plpgsql as $$
        begin
          if exists (
            select 1 from ${FAULT_TABLE}
            where name = '${FAULT}' and (scope is null or scope = new.user_id::text)
          ) then
            raise exception 'qa fault: ${EVENT_TYPE} point award blocked';
          end if;
          return new;
        end;
        $$;
      `);
      await db.query("drop trigger if exists qa_fault_game_points on vocab_point_events");
      await db.query(
        "create trigger qa_fault_game_points before insert on vocab_point_events for each row execute function qa_fault_game_guard()",
      );
      installedTrigger = true;
      const installed = await count(
        "select count(*)::int n from information_schema.triggers where trigger_name = 'qa_fault_game_points'",
      );
      assert.equal(installed, 1, "the trigger must really be installed, or the test proves nothing");
    });

    await t.test("positive control: an unarmed answer writes one event and awards exactly one point", async () => {
      const result = await answer(day(1));
      assert.equal(result.ok, true, "the answer must be accepted, or nothing below is exercised");
      assert.ok(result.ok);
      assert.equal(result.correct, true, "the submitted sentence must actually grade correct");
      assert.equal(result.verified, true, "the server must have graded it itself");
      assert.equal(result.awarded, VOCAB_POINTS.gameAnswer, "a verified correct answer awards the point");
      assert.equal(await eventRows(), 1, "exactly one practice event");
      assert.equal(await pointRows(), 1, "exactly one point ledger row");
    });

    await t.test("arm the fault and confirm it bites", async () => {
      await db.query(
        `insert into ${FAULT_TABLE} (name, scope) values ($1, $2) on conflict (name) do update set scope = excluded.scope`,
        [FAULT, userId],
      );
      let threw = "";
      await answer(day(2)).catch((error: unknown) => {
        threw = String((error as Error)?.message ?? error);
      });
      // Drizzle wraps the driver error, so the raised text may arrive as the cause rather than in
      // the outer message. Asserting only on /qa fault/ would silently pass when it never matched.
      assert.ok(threw.length > 0, "the armed fault must make the point award fail");
      assert.match(threw, /qa fault|vocab_point_events/, `unexpected failure text: ${threw}`);
    });

    await t.test("no practice event survives the rolled-back point award", async () => {
      const events = await eventRows();
      const points = await pointRows();
      assert.equal(
        events,
        1,
        `${events - 1} practice event(s) survived a point award that never happened: the learner's ` +
          `Vocabulary history and study streak record an attempt the point ledger has no row for`,
      );
      assert.equal(points, 1, "the failed award must leave the ledger exactly as it was");
    });

    await t.test("disarm: the same answer then writes exactly one event and one point", async () => {
      await db.query(`delete from ${FAULT_TABLE} where name = $1`, [FAULT]);
      const result = await answer(day(2));
      assert.equal(result.ok, true);
      assert.ok(result.ok);
      assert.equal(result.awarded, VOCAB_POINTS.gameAnswer, "the retry must actually award the point");
      assert.equal(await eventRows(), 2, "one event for the successful attempt, none for the failed one");
      assert.equal(await pointRows(), 2, "one point for the successful attempt");
    });

    await t.test("a same-day retry adds an event but no second point (recorded, not repaired)", async () => {
      const result = await answer(day(2));
      assert.equal(result.ok, true);
      assert.ok(result.ok);
      assert.equal(result.awarded, 0, "the point dedupes per learner, entry and Tashkent day");
      assert.equal(await eventRows(), 3, "the practice event does not dedupe — this asymmetry is recorded, not fixed");
      assert.equal(await pointRows(), 2, "the ledger must not award twice for one day");
    });
  } finally {
    if (installedTrigger) {
      await db.query("drop trigger if exists qa_fault_game_points on vocab_point_events").catch(() => {});
    }
    await db.query("drop function if exists qa_fault_game_guard()").catch(() => {});
    await db.query(`delete from ${FAULT_TABLE} where name = $1`, [FAULT]).catch(() => {});
    await db.query(`drop table if exists ${FAULT_TABLE}`).catch(() => {});

    const remaining = await count(
      "select count(*)::int n from information_schema.triggers where trigger_name = 'qa_fault_game_points'",
    ).catch(() => -1);
    assert.equal(remaining, 0, "the injected trigger must be gone, or later tests inherit the fault");
    const tableLeft = await count(
      `select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = $1`,
      [FAULT_TABLE],
    ).catch(() => -1);
    assert.equal(tableLeft, 0, "the scratch fault table must be dropped, not left for the next file");
    await db.end().catch(() => {});
  }
});
