/*
 * §03 — Coach evaluation persistence is one write unit.
 *
 * THE DEFECT. `evaluateAndPersist` (src/lib/services/coach/service.ts) performs four related writes
 * with no transaction boundary: `saveEvaluation`, `recordWeaknessesFromEvaluation`,
 * `recordEvaluationEvent` and, when the provider fell back, `recordFallbackEvent`. Each helper writes
 * through the global pool, so each commits on its own.
 *
 * WHY THAT IS WORSE THAN AN ORDINARY PARTIAL WRITE. Step 1 of the function is a de-duplication read:
 * `findEvaluation` returns an existing row and the caller gets `{ reused: true }` before the provider
 * is ever called. That is correct and deliberate — a retry must not pay a provider twice or produce a
 * second competing verdict for the same work. But it also means that once `saveEvaluation` has
 * committed, every later retry short-circuits at step 1. So if a write *after* the evaluation fails,
 * the missing weakness rows and the missing completion event can never be recovered through a normal
 * retry: the learner keeps a verdict while `coach-dashboard.ts` serves a weakness profile that never
 * recorded it, permanently.
 *
 * THE FOUR INJECTION POINTS (§3.2). A real PostgreSQL BEFORE trigger, scoped to this test's own
 * learner, raises at each write in turn: the evaluation insert, the weakness insert/update, the
 * COACH_EVALUATION_COMPLETED insert and the COACH_PROVIDER_FALLBACK insert. A `set_config` GUC on the
 * test connection cannot work — the application uses a different pooled connection and would never
 * see it. The scratch table that arms the faults is owned by this file alone, dropped in `finally`,
 * and the drop is asserted.
 *
 * WHAT IS STUBBED AND WHAT IS REAL. The evaluation itself is always RIWI's own real internal output —
 * no artificial provider result is ever generated or treated as evidence. The only stub is an external
 * provider that FAILS (tests/support `AlwaysFailingProvider`), which is how the genuine RIWI fallback
 * path is reached so that `fallbackUsed`/`fallbackFrom` are real and the fallback event is exercised.
 *
 * WHY THERE IS A POSITIVE CONTROL. A rollback assertion passes vacuously if the writes never
 * happened. Subtest 3 therefore proves that an unarmed RIWI evaluation really writes an evaluation
 * row, a real `coach_weaknesses` row (RIWI reports `WRITING_TASK_RESPONSE` for this answer, which is
 * a canonical weakness category), and exactly one completion event — and only then is a fault armed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { db as appDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { evaluateAndPersist } from "../src/lib/services/coach/service";
import { providerRegistry } from "../src/lib/services/coach/registry";
import { RiwiProvider } from "../src/lib/services/coach/providers/riwi";
import { RIWI_PROVIDER_ID } from "../src/lib/services/coach/config";
import type { EvaluationRequest } from "../src/lib/services/coach/resolver";
import { AlwaysFailingProvider } from "./support/test-provider";

const PROBE = "coach-atomicity-qa2";
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
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL (this test injects database triggers)"
  : false;

/** Owned by this file alone, created and dropped here: a scratch table left behind is schema residue. */
const FAULT_TABLE = "qa_fault_coach_tbl";
const TAG = `qa-coach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const FAULTS = {
  evaluation: "block_evaluation_insert",
  weakness: "block_weakness_write",
  completion: "block_completion_event",
  fallback: "block_fallback_event",
} as const;
const TRIGGERS = [
  "qa_fault_coach_evaluations",
  "qa_fault_coach_weaknesses",
  "qa_fault_coach_events",
] as const;

/** The same deterministic writing answer used by tests/coach-providers.test.ts. RIWI grades it
 *  internally and reports one WRITING_TASK_RESPONSE issue, which is a canonical weakness category —
 *  so the weakness write really happens and can really be faulted. */
const WRITING_REQUEST: EvaluationRequest = {
  evaluationType: "writing",
  input: {
    taskType: "task2",
    prompt: "Some people think … Discuss both views.",
    content:
      "Over the last decade, many students have started to study online. However, this shift brings problems. " +
      "Firstly, students lose the daily contact with their teachers, and they often have no one to ask. " +
      "Furthermore, the home environment is full of distractions, so it is hard to focus on a long essay. " +
      "On the other hand, online study allows people who live far from a city to attend a good course. " +
      "As a result, education becomes more equal. In conclusion, I believe the benefits outweigh the problems when the course is well designed.",
    targetWordCount: 80,
  },
};

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a coach evaluation, its weaknesses and its events commit or roll back together", { skip: skipReason, timeout: 300_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();

  let installed = false;
  let userId = "";
  /** A second learner, to prove a fault scoped to one learner cannot touch another. */
  let otherUserId = "";

  const count = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0].n as number;
  const evalRows = (who = userId) =>
    count("select count(*)::int n from evaluations where user_id = $1", [who]);
  const weaknessRows = (who = userId) =>
    count("select count(*)::int n from coach_weaknesses where user_id = $1", [who]);
  const occurrenceTotal = (who = userId) =>
    count("select coalesce(sum(occurrence_count),0)::int n from coach_weaknesses where user_id = $1", [who]);
  const events = (type: string, who = userId) =>
    count("select count(*)::int n from activity_events where user_id = $1 and type = $2", [who, type]);
  const completionEvents = (who = userId) => events("COACH_EVALUATION_COMPLETED", who);
  const fallbackEvents = (who = userId) => events("COACH_PROVIDER_FALLBACK", who);

  const arm = async (name: string) => {
    await db.query(
      `insert into ${FAULT_TABLE} (name, scope) values ($1, $2) on conflict (name) do update set scope = excluded.scope`,
      [name, userId],
    );
  };
  const disarm = async (name: string) => {
    await db.query(`delete from ${FAULT_TABLE} where name = $1`, [name]);
  };
  /*
   * Disarm everything, unconditionally. Each subtest below arms a fault and asserts while it is
   * armed; if an assertion throws before the subtest's own disarm runs, the fault stays armed and
   * every later subtest measures nothing — which is how one real failure turned into seven and hid
   * the concurrency result. So every subtest starts from a known-disarmed state, and every armed
   * section disarms in a finally.
   */
  const disarmAll = async () => {
    await db.query(`delete from ${FAULT_TABLE}`).catch(() => {});
  };

  /** Every call needs its own source, because one source is evaluated once by design. */
  const evaluate = (sourceId = crypto.randomUUID()) =>
    evaluateAndPersist({
      userId,
      evaluationType: "writing",
      sourceType: "writing_submission",
      sourceId,
      request: WRITING_REQUEST,
      language: "en",
    });

  try {
    await t.test("arrange: two learners, one of them the fault target", async () => {
      const [user] = await appDb
        .insert(users)
        .values({ email: `${TAG}@learners-qa.invalid`, name: "Coach Atomicity", passwordHash: "x" } as typeof users.$inferInsert)
        .returning();
      userId = user!.id;
      const [other] = await appDb
        .insert(users)
        .values({ email: `${TAG}-other@learners-qa.invalid`, name: "Coach Bystander", passwordHash: "x" } as typeof users.$inferInsert)
        .returning();
      otherUserId = other!.id;

      assert.ok(userId && otherUserId, "both learners must really exist");
      assert.equal(await evalRows(), 0, "the target learner starts with no evaluation");
      assert.equal(await weaknessRows(), 0, "the target learner starts with no weakness rows");
      assert.equal(await completionEvents(), 0, "the target learner starts with no completion event");
      assert.equal(await fallbackEvents(), 0, "the target learner starts with no fallback event");
    });

    await t.test("arrange: install a fault trigger at each of the four writes", async () => {
      await db.query(`create table if not exists ${FAULT_TABLE} (name text primary key, scope text)`);
      await db.query(`
        create or replace function qa_fault_coach_evaluations_guard() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from ${FAULT_TABLE} where name = '${FAULTS.evaluation}' and scope = new.user_id::text) then
            raise exception 'qa fault: evaluation insert blocked';
          end if;
          return new;
        end; $$;
      `);
      await db.query(`
        create or replace function qa_fault_coach_weakness_guard() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from ${FAULT_TABLE} where name = '${FAULTS.weakness}' and scope = new.user_id::text) then
            raise exception 'qa fault: weakness write blocked';
          end if;
          return new;
        end; $$;
      `);
      await db.query(`
        create or replace function qa_fault_coach_events_guard() returns trigger language plpgsql as $$
        begin
          if new.type = 'COACH_EVALUATION_COMPLETED' and exists (select 1 from ${FAULT_TABLE} where name = '${FAULTS.completion}' and scope = new.user_id::text) then
            raise exception 'qa fault: completion event blocked';
          end if;
          if new.type = 'COACH_PROVIDER_FALLBACK' and exists (select 1 from ${FAULT_TABLE} where name = '${FAULTS.fallback}' and scope = new.user_id::text) then
            raise exception 'qa fault: fallback event blocked';
          end if;
          return new;
        end; $$;
      `);
      for (const [trigger, table, fn, timing] of [
        [TRIGGERS[0], "evaluations", "qa_fault_coach_evaluations_guard()", "insert"],
        [TRIGGERS[1], "coach_weaknesses", "qa_fault_coach_weakness_guard()", "insert or update"],
        [TRIGGERS[2], "activity_events", "qa_fault_coach_events_guard()", "insert"],
      ] as const) {
        await db.query(`drop trigger if exists ${trigger} on ${table}`);
        await db.query(`create trigger ${trigger} before ${timing} on ${table} for each row execute function ${fn}`);
      }
      installed = true;
      const present = await count(
        /*
         * count(DISTINCT trigger_name), not count(*): information_schema.triggers emits one row per
         * (trigger, event), so the BEFORE INSERT OR UPDATE trigger on coach_weaknesses is two rows and
         * a plain count reports 4 for 3 installed triggers.
         */
        `select count(distinct trigger_name)::int n from information_schema.triggers where trigger_name = any($1::text[])`,
        [[...TRIGGERS]],
      );
      assert.equal(present, TRIGGERS.length, "all three triggers must really be installed, or the test proves nothing");
    });

    await t.test("positive control: an unarmed RIWI evaluation writes all three real records", async () => {
      const sourceId = crypto.randomUUID();
      const outcome = await evaluate(sourceId);
      assert.equal(outcome.ok, true, `the evaluation must succeed: ${JSON.stringify(outcome)}`);
      assert.ok(outcome.ok);
      assert.equal(outcome.reused, false, "a first evaluation is never a reuse");
      assert.equal(outcome.evaluation.providerId, RIWI_PROVIDER_ID, "the evaluator must be RIWI, not a stub");
      assert.equal(outcome.evaluation.providerType, "internal");
      assert.equal(outcome.evaluation.fallbackUsed, false, "no external provider was configured");

      assert.equal(await evalRows(), 1, "exactly one evaluation row");
      assert.equal(await weaknessRows(), 1, "RIWI's WRITING_TASK_RESPONSE issue must create a real weakness row");
      assert.equal(await occurrenceTotal(), 1, "the weakness is counted once");
      assert.equal(await completionEvents(), 1, "exactly one completion event");
      assert.equal(await fallbackEvents(), 0, "no fallback happened, so no fallback event");

      // Reuse is the contract: the same source must not be evaluated or recorded twice.
      const again = await evaluate(sourceId);
      assert.equal(again.ok, true);
      assert.ok(again.ok);
      assert.equal(again.reused, true, "the same source returns the existing evaluation");
      assert.equal(await evalRows(), 1, "a reuse adds no evaluation");
      assert.equal(await completionEvents(), 1, "a reuse adds no completion event");
      assert.equal(await occurrenceTotal(), 1, "a reuse does not increment the weakness count");
    });

    await t.test("fault the weakness write: nothing may survive, and a retry must recover", async () => {
      await disarmAll();
      const sourceId = crypto.randomUUID();
      let threw = "";
      await arm(FAULTS.weakness);
      try {
        await evaluate(sourceId).catch((error: unknown) => {
          threw = String((error as Error)?.message ?? error);
        });
        assert.ok(threw.length > 0, "the armed fault must make the weakness write fail");
        assert.match(threw, /qa fault|coach_weaknesses/, `unexpected failure text: ${threw}`);

        assert.equal(
          await evalRows(),
          1,
          "the evaluation must roll back with the weakness write it was persisted alongside — " +
            "otherwise a retry finds it, returns reused:true and the weakness is lost forever",
        );
        assert.equal(await weaknessRows(), 1, "no partial weakness row");
        assert.equal(await occurrenceTotal(), 1, "the rolled-back evaluation must not increment the weakness count");
        assert.equal(await completionEvents(), 1, "no misleading completion event for work that was not recorded");
      } finally {
        await disarm(FAULTS.weakness);
      }
      const retried = await evaluate(sourceId);
      assert.equal(retried.ok, true, "the retry after the fault must succeed");
      assert.equal(await evalRows(), 2, "the retry persists the evaluation that rolled back");
      // One row per (learner, category): a repeat increments occurrence_count, it does not add a row.
      assert.equal(await weaknessRows(), 1, "still one weakness row for the one category RIWI reported");
      assert.equal(await occurrenceTotal(), 2, "the retry records the weakness it could not before");
      assert.equal(await completionEvents(), 2, "the retry writes exactly one completion event");
    });

    await t.test("fault the completion event: no evaluation or weakness may survive", async () => {
      await disarmAll();
      const sourceId = crypto.randomUUID();
      let threw = "";
      await arm(FAULTS.completion);
      try {
        await evaluate(sourceId).catch((error: unknown) => {
          threw = String((error as Error)?.message ?? error);
        });
        assert.ok(threw.length > 0, "the armed fault must make the event write fail");
        assert.match(threw, /qa fault|activity_events/, `unexpected failure text: ${threw}`);

        assert.equal(await evalRows(), 2, "the evaluation must roll back with the event that records it");
        assert.equal(await occurrenceTotal(), 2, "no partial weakness update");
        assert.equal(await completionEvents(), 2, "no completion event was written");
      } finally {
        await disarm(FAULTS.completion);
      }
      const retried = await evaluate(sourceId);
      assert.equal(retried.ok, true);
      assert.equal(await evalRows(), 3, "the retry persists the evaluation");
      assert.equal(await completionEvents(), 3, "the retry writes the completion event");
      assert.equal(await occurrenceTotal(), 3, "the retry records the weakness");
    });

    await t.test("fault the evaluation insert: nothing at all is written", async () => {
      await disarmAll();
      let threw = "";
      await arm(FAULTS.evaluation);
      try {
        await evaluate().catch((error: unknown) => {
          threw = String((error as Error)?.message ?? error);
        });
        assert.ok(threw.length > 0, "the armed fault must make the evaluation insert fail");
        assert.equal(await evalRows(), 3, "no evaluation row");
        assert.equal(await occurrenceTotal(), 3, "no weakness increment ahead of a failed evaluation");
        assert.equal(await completionEvents(), 3, "no completion event for an evaluation that does not exist");
      } finally {
        await disarm(FAULTS.evaluation);
      }
    });

    await t.test("fault the fallback event: a real RIWI fallback leaves nothing behind", async () => {
      // Only the external provider's FAILURE is stubbed. The evaluation that gets persisted is RIWI's
      // own real internal result, reached through the product's genuine fallback path.
      await disarmAll();
      providerRegistry.register(new AlwaysFailingProvider());
      try {
        const sourceId = crypto.randomUUID();
        await arm(FAULTS.fallback);
        let threw = "";
        await withEnv({ AI_PRIMARY_PROVIDER: "always-fails", AI_EXTERNAL_ENABLED: "true" }, () =>
          evaluate(sourceId),
        ).catch((error: unknown) => {
          threw = String((error as Error)?.message ?? error);
        });
        assert.ok(threw.length > 0, "the armed fault must make the fallback event write fail");
        assert.equal(await evalRows(), 3, "the evaluation must roll back with its fallback provenance");
        assert.equal(await fallbackEvents(), 0, "no orphaned fallback event");
        assert.equal(await completionEvents(), 3, "no completion event without its evaluation");

        await disarm(FAULTS.fallback);
        const retried = await withEnv({ AI_PRIMARY_PROVIDER: "always-fails", AI_EXTERNAL_ENABLED: "true" }, () =>
          evaluate(sourceId),
        );
        assert.equal(retried.ok, true, "the retry must succeed");
        assert.ok(retried.ok);
        assert.equal(retried.evaluation.providerId, RIWI_PROVIDER_ID, "RIWI produced the verdict");
        assert.equal(retried.evaluation.fallbackUsed, true, "the fallback really happened");
        assert.equal(retried.evaluation.fallbackFrom, "always-fails", "the fallback provenance is preserved");
        assert.equal(await evalRows(), 4, "one evaluation");
        assert.equal(await fallbackEvents(), 1, "exactly one fallback event, written with its evaluation");
        assert.equal(await completionEvents(), 4, "exactly one completion event");
      } finally {
        providerRegistry.clear();
        providerRegistry.register(new RiwiProvider());
        await disarm(FAULTS.fallback).catch(() => {});
      }
    });

    await t.test("a fault scoped to one learner cannot touch another", async () => {
      await disarmAll();
      await arm(FAULTS.completion);
      // The bystander is not the armed scope, so their evaluation must succeed untouched.
      const outcome = await evaluateAndPersist({
        userId: otherUserId,
        evaluationType: "writing",
        sourceType: "writing_submission",
        sourceId: crypto.randomUUID(),
        request: WRITING_REQUEST,
        language: "en",
      });
      assert.equal(outcome.ok, true, "another learner is unaffected by a fault scoped to this one");
      assert.equal(await evalRows(otherUserId), 1, "the bystander's evaluation was written");
      assert.equal(await completionEvents(otherUserId), 1, "the bystander's completion event was written");
      assert.equal(await evalRows(), 4, "the armed learner gained nothing while the fault was armed");
      await disarm(FAULTS.completion);
    });

    await t.test("two concurrent requests for one source produce one authoritative evaluation", async () => {
      await disarmAll();
      const sourceId = crypto.randomUUID();
      const before = {
        evaluations: await evalRows(),
        completion: await completionEvents(),
        occurrences: await occurrenceTotal(),
      };
      const [a, b] = await Promise.allSettled([evaluate(sourceId), evaluate(sourceId)]);
      const ok = [a, b].filter((r) => r.status === "fulfilled" && r.value.ok);
      assert.equal(ok.length, 2, `both requests must settle successfully: ${JSON.stringify([a, b].map((r) => r.status === "rejected" ? String(r.reason) : r.value))}`);
      const records = ok.map((r) => (r as PromiseFulfilledResult<{ ok: true; evaluation: { id: string } }>).value.evaluation.id);
      assert.equal(new Set(records).size, 1, "both callers must see the SAME authoritative evaluation id");
      assert.equal(await evalRows(), before.evaluations + 1, "exactly one evaluation row for one source");
      assert.equal(await completionEvents(), before.completion + 1, "the losing request adds no duplicate event");
      assert.equal(await occurrenceTotal(), before.occurrences + 1, "the losing request does not double-increment the weakness");
    });
  } finally {
    for (const [trigger, table] of [
      [TRIGGERS[0], "evaluations"],
      [TRIGGERS[1], "coach_weaknesses"],
      [TRIGGERS[2], "activity_events"],
    ] as const) {
      if (installed) await db.query(`drop trigger if exists ${trigger} on ${table}`).catch(() => {});
    }
    for (const fn of [
      "qa_fault_coach_evaluations_guard()",
      "qa_fault_coach_weakness_guard()",
      "qa_fault_coach_events_guard()",
    ]) {
      await db.query(`drop function if exists ${fn}`).catch(() => {});
    }
    for (const name of Object.values(FAULTS)) {
      await db.query(`delete from ${FAULT_TABLE} where name = $1`, [name]).catch(() => {});
    }
    await db.query(`drop table if exists ${FAULT_TABLE}`).catch(() => {});

    const triggersLeft = await count(
      `select count(distinct trigger_name)::int n from information_schema.triggers where trigger_name = any($1::text[])`,
      [[...TRIGGERS]],
    ).catch(() => -1);
    assert.equal(triggersLeft, 0, "the injected triggers must be gone, or later tests inherit the fault");
    const tableLeft = await count(
      "select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = $1",
      [FAULT_TABLE],
    ).catch(() => -1);
    assert.equal(tableLeft, 0, "the scratch fault table must be dropped, not left for the next file");
    await db.end().catch(() => {});
  }
});
