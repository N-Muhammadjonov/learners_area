/**
 * The Writing Activation Lab's evidence write is atomic — or it is a defect.
 *
 * WHAT IS AT STAKE. `checkActivation` does two independent writes for one learner action:
 * `recordSentenceUse` + `confirmSentenceUse` store a `vocabulary_usages` row, and an
 * `activity_events` row of type `WRITING_ACTIVATION_CHECK` records the attempt. That event is not a
 * cosmetic feed entry — it is the ONLY record the learner's statistics are computed from.
 * `activationSessionStats` and `activationOverview` read nothing else, and `statsFromEvents` counts
 * rows directly: `attempts` is `ps.length`, `averageBands` sums every row's bands, `wordsActivated`
 * is the set of rows with `usageRecorded && entryId`. The payload even carries `usageRecorded`, a
 * claim about whether the usage row was stored.
 *
 * Both writes were issued on the bare pool with no transaction between them, so a failure of the
 * event insert left the usage row committed: the learner's Vocabulary says the sentence was used and
 * confirmed, while the Activation Lab has no record the attempt ever happened, and the returned
 * stats omit it. That is the same defect class B3 closed for assignment creation.
 *
 * HOW THE FAILURE IS INJECTED. A BEFORE INSERT trigger on `activity_events` raises when a `qa_fault_activation_tbl`
 * row is armed for this learner. A `set_config` GUC would not work: `checkActivation` writes through
 * the application's own pooled connection, so a GUC set on the test's connection is invisible to it.
 * The trigger runs inside the connection that performs the write, which is the only place the failure
 * can be made to happen truthfully. It is scoped to this test's learner id, and the DDL is created
 * and dropped by this file with the drop verified.
 *
 * The AI check is supplied through the product's own `deps.check` seam, exactly as
 * tests/writing-activation.test.ts does. No provider response is fabricated as evidence about AI
 * behaviour: the subject here is whether two real database writes commit or roll back together.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { db as appDb } from "../src/db/client";
import { lexemes, users, userVocabulary } from "../src/db/schema";
import { checkActivation } from "../src/lib/services/writing/activation";
import { normalizeCheck, type CheckOutcome } from "../src/lib/services/writing/check";

const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("writing-activation-atomicity-qa2");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("writing-activation-atomicity-qa2", qa2ResidueGuard);
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

const EVENT_TYPE = "WRITING_ACTIVATION_CHECK";
const FAULT = "block_activation_event";
const TAG = `qa-activation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A correct verdict, so the usage write runs: `needs_revision` would skip it and prove nothing. */
const check = async (): Promise<CheckOutcome> => ({
  ok: true,
  result: {
    ...normalizeCheck("activation", {
      verdict: "correct",
      criteria: [
        { key: "meaning", band: 8 },
        { key: "grammar", band: 7 },
      ],
      issues: [{ message: "Use a stronger verb.", suggestion: "Trees can significantly mitigate heat." }],
    }),
    evaluationId: crypto.randomUUID(),
  },
});

const input = (sessionId: string, entryId: string, answer: string) => ({
  sessionId,
  entryId,
  mode: "writing" as const,
  targetLevel: "7.0" as const,
  uzbekPrompt: false,
  answer,
});

test("the activation event and the vocabulary usage it describes commit or roll back together", { skip: skipReason, timeout: 240_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();

  let installedTrigger = false;
  let userId = "";
  let entryId = "";

  const count = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0].n as number;
  const usageRows = () =>
    count("select count(*)::int n from vocabulary_usages where user_id = $1", [userId]);
  const eventRows = () =>
    count("select count(*)::int n from activity_events where user_id = $1 and type = $2", [
      userId,
      EVENT_TYPE,
    ]);

  try {
    await t.test("arrange: a learner with one Vocabulary entry of their own", async () => {
      const [user] = await appDb
        .insert(users)
        .values({
          email: `${TAG}@learners-qa.invalid`,
          name: "Activation Atomicity",
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
          senseKey: `mitigate::${TAG}`,
        } as typeof lexemes.$inferInsert)
        .returning();
      const [entry] = await appDb
        .insert(userVocabulary)
        .values({ userId, lexemeId: lexeme!.id } as typeof userVocabulary.$inferInsert)
        .returning();
      entryId = entry!.id;

      // Without a real entry the call returns not_found before writing anything, and every rollback
      // assertion below would pass because nothing was ever attempted — a green test proving nothing.
      assert.ok(userId && entryId, "the learner and their Vocabulary entry must really exist");
      assert.equal(await usageRows(), 0, "the learner starts with no recorded sentence use");
      assert.equal(await eventRows(), 0, "the learner starts with no activation events");
    });

    await t.test("arrange: install the fault trigger, scoped to this learner", async () => {
      await db.query("create table if not exists qa_fault_activation_tbl (name text primary key, scope text)");
      await db.query(`
        create or replace function qa_fault_activation_guard() returns trigger language plpgsql as $$
        begin
          if exists (
            select 1 from qa_fault_activation_tbl
            where name = '${FAULT}' and (scope is null or scope = new.user_id::text)
          ) and new.type = '${EVENT_TYPE}' then
            raise exception 'qa fault: ${EVENT_TYPE} event write blocked';
          end if;
          return new;
        end;
        $$;
      `);
      await db.query("drop trigger if exists qa_fault_activation_events on activity_events");
      await db.query(
        "create trigger qa_fault_activation_events before insert on activity_events for each row execute function qa_fault_activation_guard()",
      );
      installedTrigger = true;
      const installed = await count(
        "select count(*)::int n from information_schema.triggers where trigger_name = 'qa_fault_activation_events'",
      );
      assert.equal(installed, 1, "the trigger must really be installed, or the test proves nothing");
    });

    await t.test("arm the fault and confirm it bites", async () => {
      await db.query(
        `insert into qa_fault_activation_tbl (name, scope) values ($1, $2) on conflict (name) do update set scope = excluded.scope`,
        [FAULT, userId],
      );
      let threw = "";
      await checkActivation(userId, "en", input(crypto.randomUUID(), entryId, "Trees mitigate heat."), {
        database: appDb,
        check,
      }).catch((error: unknown) => {
        threw = String((error as Error)?.message ?? error);
      });
      // Drizzle wraps the driver error, so the raised text may arrive as the cause rather than in
      // `message`. What must be identifiable is that the write that failed was the event write.
      assert.ok(threw.length > 0, "the event write must fail; the call resolved instead");
      assert.match(
        threw,
        /qa fault|activity_events/,
        `the failure must come from the activity_events write; got "${threw.slice(0, 200)}"`,
      );
    });

    await t.test("the failed attempt leaves no activation event", async () => {
      assert.equal(await eventRows(), 0, "the blocked event must not exist");
    });

    await t.test(
      "the failed attempt leaves no vocabulary usage behind it — the two writes are one unit",
      async () => {
        const left = await usageRows();
        assert.equal(
          left,
          0,
          `${left} vocabulary_usages row(s) survived a rolled-back activation: the learner's Vocabulary ` +
            `records a confirmed sentence use that the Activation Lab has no evidence for`,
        );
      },
    );

    await t.test("disarm: the same call succeeds and writes exactly one of each", async () => {
      await db.query("delete from qa_fault_activation_tbl where name = $1", [FAULT]);
      const sessionId = crypto.randomUUID();
      const outcome = await checkActivation(userId, "en", input(sessionId, entryId, "Trees mitigate heat."), {
        database: appDb,
        check,
      });
      assert.equal(outcome.ok, true, `the positive control must succeed: ${JSON.stringify(outcome)}`);
      if (!outcome.ok) return;
      assert.equal(outcome.usageRecorded, true, "the usage write is part of the accepted action");
      assert.equal(await usageRows(), 1, "exactly one usage row");
      assert.equal(await eventRows(), 1, "exactly one activation event");
      assert.equal(outcome.stats.attempts, 1, "the stats the learner sees count the one real attempt");
      assert.equal(outcome.stats.usageRecorded, 1, "and record that its usage was stored");

      const stored = (
        await db.query(
          "select payload->>'usageRecorded' as recorded from activity_events where user_id = $1 and type = $2",
          [userId, EVENT_TYPE],
        )
      ).rows[0];
      assert.equal(stored.recorded, "true", "the event's own claim about the usage row must be true");
    });

    await t.test("re-arm: a failure after a success cannot duplicate or orphan anything", async () => {
      await db.query(
        `insert into qa_fault_activation_tbl (name, scope) values ($1, $2) on conflict (name) do update set scope = excluded.scope`,
        [FAULT, userId],
      );
      await checkActivation(userId, "en", input(crypto.randomUUID(), entryId, "Cities mitigate risk."), {
        database: appDb,
        check,
      }).catch(() => {});
      assert.equal(await eventRows(), 1, "still one event: the blocked attempt added none");
      assert.equal(await usageRows(), 1, "still one usage row: the blocked attempt orphaned none");
    });

    await t.test("disarm and retry: the learner's retry after a failure produces exactly one more", async () => {
      await db.query("delete from qa_fault_activation_tbl where name = $1", [FAULT]);
      const sessionId = crypto.randomUUID();
      const outcome = await checkActivation(userId, "en", input(sessionId, entryId, "Cities mitigate risk."), {
        database: appDb,
        check,
      });
      assert.equal(outcome.ok, true, "the retry must succeed once the fault is gone");
      assert.equal(await eventRows(), 2, "one event per accepted attempt, none for the failed one");
      if (outcome.ok) {
        // Session stats are scoped to the sessionId they are asked about — that is the product's
        // contract, not a bug — so this new session counts its own single accepted attempt. The
        // learner-wide total is what the event count above asserts.
        assert.equal(outcome.stats.attempts, 1, "the retry's own session counts its one attempt");
        assert.equal(outcome.stats.usageRecorded, 1, "and records that its usage was stored");
      }
    });
  } finally {
    await db.query("delete from qa_fault_activation_tbl where name = $1", [FAULT]).catch(() => {});
    if (installedTrigger) {
      await db.query("drop trigger if exists qa_fault_activation_events on activity_events").catch(() => {});
      await db.query("drop function if exists qa_fault_activation_guard()").catch(() => {});
      // The scratch table is dropped too, and the drop is verified. Leaving it behind is schema
      // residue: another gated file creates and drops a table of the same purpose, and a table that
      // exists at its capture() but is gone by its sweep() used to abort that file's whole sweep.
      await db.query("drop table if exists qa_fault_activation_tbl").catch(() => {});
      const remaining = await count(
        "select count(*)::int n from information_schema.triggers where trigger_name = 'qa_fault_activation_events'",
      ).catch(() => -1);
      assert.equal(remaining, 0, "the injected trigger must be gone, or later tests inherit the fault");
      const tableLeft = await count(
        "select count(*)::int n from information_schema.tables where table_schema='public' and table_name = 'qa_fault_activation_tbl'",
      ).catch(() => -1);
      assert.equal(tableLeft, 0, "the scratch fault table must be dropped, not left for the next file");
    }
    await db.end().catch(() => {});
  }
});
