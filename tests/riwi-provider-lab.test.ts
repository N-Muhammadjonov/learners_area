import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { users, riwiKnowledgeSources, riwiLearningSignals, riwiProviderExperiments, riwiProviderExperimentResults } from "../src/db/schema";
import type { EvaluationProvider } from "../src/lib/services/coach/types";
import { ProviderRegistry } from "../src/lib/services/coach/registry";
import {
  RIWI_PROVIDER_LAB_FIXTURES,
  RIWI_PROVIDER_LAB_MAX_GLOBAL_RUNNING,
  RIWI_PROVIDER_LAB_MAX_RUNS_PER_HOUR_GLOBAL,
  riwiProviderLabRequestSchema,
  RiwiProviderLabError,
  getRiwiProviderExperiment,
  listRiwiProviderExperimentPage,
  runRiwiProviderExperiment,
} from "../src/lib/services/riwi/provider-lab";
import { createTestDatabase } from "./support/pglite";
import { installOwnerHistoryCursorTestSecret } from "./support/riwi-history-cursor";

test.after(installOwnerHistoryCursorTestSecret());
import { RULES, consume, resetAll } from "../src/lib/http/rate-limit";

const ownerId = randomUUID();
const studentId = randomUUID();
const originalEnv = new Map<string, string | undefined>();
const rolloutEnv = [
  "RIWI_ENABLED", "RIWI_OWNER_ENABLED", "RIWI_PROVIDER_LAB_ENABLED", "RIWI_EXTERNAL_AI_ENABLED",
] as const;
for (const name of rolloutEnv) originalEnv.set(name, process.env[name]);

function setRollout(externalAi = true) {
  process.env.RIWI_ENABLED = "true";
  process.env.RIWI_OWNER_ENABLED = "true";
  process.env.RIWI_PROVIDER_LAB_ENABLED = "true";
  process.env.RIWI_EXTERNAL_AI_ENABLED = String(externalAi);
}
function restoreEnvironment() {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function fakeProvider(respond: NonNullable<EvaluationProvider["respondToRiwi"]>, requiredSecrets: string[] = []): EvaluationProvider {
  return {
    id: "lab-stub", displayName: "Lab Stub", type: "external", version: "test-v1", model: "fixed-test-model",
    capabilities: ["riwi-assistant"], requiredSecrets, promptVersion: "test", rubricVersion: "test",
    respondToRiwi: respond,
  };
}

async function seed(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  await database.db.insert(users).values([
    { id: ownerId, name: "Owner Lab Test", role: "owner", accountStatus: "active" },
    { id: studentId, name: "Student Lab Test", role: "student", accountStatus: "active" },
  ]);
}

test("owner provider lab is fixture-only, capability-bounded, audited, normalized, and idempotent in PostgreSQL", async () => {
  const database = await createTestDatabase();
  const calls: Array<{ userId: string; message: string; historyLength: number; knowledgeLength: number }> = [];
  const auditActions: string[] = [];
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async (context, input) => {
    calls.push({ userId: context.userId, message: input.message, historyLength: input.history.length, knowledgeLength: input.knowledge.length });
    return {
      ok: true,
      answer: { answer: "Use an before a vowel sound. Contact private@example.test for more.", uncertainty: null, citations: input.knowledge.length ? ["K1"] : [] },
      usage: { inputTokens: 37, outputTokens: 18 },
    };
  }));
  setRollout(true);

  try {
    await seed(database);
    const actor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const experimentKey = randomUUID();
    const fixtureId = RIWI_PROVIDER_LAB_FIXTURES[0]!.id;
    const result = await runRiwiProviderExperiment({
      actor, fixtureId, providerIds: ["lab-stub"], idempotencyKey: experimentKey,
    }, {
      database: database.db,
      registry,
      externalEnabled: async () => true,
      writeAudit: async ({ action }) => { auditActions.push(action); },
    });

    assert.equal(result.replay, false);
    assert.equal(result.experiment.state, "completed");
    assert.equal(result.experiment.results.length, 1);
    assert.equal(result.experiment.results[0]?.state, "succeeded");
    assert.equal(result.experiment.results[0]?.inputTokens, 37);
    assert.equal(result.experiment.results[0]?.outputTokens, 18);
    assert.equal(result.experiment.results[0]?.estimatedCostMicros, null);
    assert.ok(!JSON.stringify(result.experiment).includes(RIWI_PROVIDER_LAB_FIXTURES[0]!.payload.message), "fixed prompt text is not persisted or returned");
    assert.equal(result.experiment.comparison, null, "single-provider runs do not claim a comparison");
    assert.ok(!result.experiment.results[0]?.normalizedResult?.answer.includes("private@example.test"), "external text is redacted before persistence and display");
    assert.deepEqual(calls, [{
      userId: "external-anonymous",
      message: RIWI_PROVIDER_LAB_FIXTURES[0]!.payload.message,
      historyLength: 0,
      knowledgeLength: 0,
    }], "the provider receives only the built-in fixture, never an owner/student-supplied prompt or identity");
    assert.ok(auditActions.includes("riwi.external.requested"));
    assert.ok(auditActions.includes("riwi.external.succeeded"));

    const replay = await runRiwiProviderExperiment({ actor, fixtureId, providerIds: ["lab-stub"], idempotencyKey: experimentKey }, {
      database: database.db, registry, externalEnabled: async () => true,
      writeAudit: async ({ action }) => { auditActions.push(action); },
    });
    assert.equal(replay.replay, true);
    assert.equal(replay.experiment.id, result.experiment.id);
    assert.equal(calls.length, 1, "an idempotent replay never repeats external work");
    const [persistedResults] = await database.db.select({ count: riwiProviderExperimentResults.id })
      .from(riwiProviderExperimentResults).where(eq(riwiProviderExperimentResults.experimentId, result.experiment.id));
    assert.ok(persistedResults?.count);

    await assert.rejects(
      runRiwiProviderExperiment({ actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[1]!.id, providerIds: ["lab-stub"], idempotencyKey: experimentKey }, {
        database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {},
      }),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "idempotency_conflict",
    );
    await assert.rejects(
      runRiwiProviderExperiment({ actor: { id: studentId, role: "student", accountStatus: "active" }, fixtureId, providerIds: ["lab-stub"], idempotencyKey: randomUUID() }, {
        database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {},
      }),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "forbidden",
    );
    await assert.rejects(
      runRiwiProviderExperiment({ actor, fixtureId, providerIds: ["not-registered"], idempotencyKey: randomUUID() }, {
        database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {},
      }),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "invalid_input",
    );
    assert.equal(riwiProviderLabRequestSchema.safeParse({
      fixtureId, providerIds: ["lab-stub"], idempotencyKey: randomUUID(), model: "caller-selected-unregistered-model",
    }).success, false, "provider/model selection is derived from the registered server provider, never request input");
    registry.register({
      ...fakeProvider(async () => {
        throw new Error("A provider without RIWI capability must never execute.");
      }),
      id: "lab-no-riwi",
      capabilities: ["grammar-evaluation"],
      respondToRiwi: undefined,
    });
    const missingCapability = await runRiwiProviderExperiment({
      actor, fixtureId, providerIds: ["lab-no-riwi"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    assert.equal(missingCapability.experiment.results[0]?.state, "capability_missing");
    assert.equal(calls.length, 1, "unregistered task capability does not reach a provider");

    setRollout(false);
    const externallyUnverified = await runRiwiProviderExperiment({
      actor, fixtureId, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async ({ action }) => { auditActions.push(action); } });
    assert.equal(externallyUnverified.experiment.state, "failed");
    assert.equal(externallyUnverified.experiment.results[0]?.state, "externally_unverified");
    assert.equal(externallyUnverified.experiment.results[0]?.safeErrorCode, "external_ai_disabled");
    assert.equal(calls.length, 1, "a disabled external-AI rollout never calls the provider");

    const history = (await listRiwiProviderExperimentPage(actor, { limit: 20 }, database.db)).experiments;
    assert.equal(history.length, 3, "history contains the success, capability-denial, and externally-unverified runs only for this owner");
    assert.ok(history.every((item) => item.results.length <= 2));
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider agreement and disagreement become deduplicated candidate evidence, never active knowledge", async () => {
  const database = await createTestDatabase();
  const registry = new ProviderRegistry();
  let comparisonMode: "different" | "same" = "different";
  const calls: string[] = [];
  const answer = (text: string) => ({ ok: true as const, answer: { answer: text, uncertainty: null, citations: [] } });
  registry.register({
    ...fakeProvider(async () => { calls.push("lab-stub-one"); return answer("Provider one candidate answer."); }),
    id: "lab-stub-one",
  });
  registry.register({
    ...fakeProvider(async () => {
      calls.push("lab-stub-two");
      return answer(comparisonMode === "same" ? "Provider one candidate answer." : "Provider two candidate answer.");
    }),
    id: "lab-stub-two",
  });
  setRollout(true);
  try {
    await seed(database);
    const actor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const fixtureId = RIWI_PROVIDER_LAB_FIXTURES[0]!.id;
    const mismatch = await runRiwiProviderExperiment({ actor, fixtureId, providerIds: ["lab-stub-one", "lab-stub-two"], idempotencyKey: randomUUID() }, {
      database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {},
    });
    assert.equal(mismatch.experiment.comparison?.exactAnswerMatch, false);
    const [disagreement] = await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, mismatch.experiment.id));
    assert.ok(disagreement);
    assert.equal(disagreement.signalType, "provider_disagreement");
    assert.equal(disagreement.state, "candidate");
    assert.equal(disagreement.actorRole, "owner");
    assert.equal(disagreement.scope, "global");
    assert.equal(disagreement.targetUserId, null);
    assert.match(disagreement.evidenceSummary, /normalized_exact_answer_text/);
    assert.match(disagreement.evidenceSummary, /semantic_quality=not_assessed/);
    assert.ok(!disagreement.candidateClaim.includes("factual"));
    assert.ok(!JSON.stringify(disagreement).includes("Provider one candidate answer."));
    assert.ok(!JSON.stringify(disagreement).includes("Provider two candidate answer."));

    await runRiwiProviderExperiment({ actor, fixtureId, providerIds: ["lab-stub-one", "lab-stub-two"], idempotencyKey: (await database.db.query.riwiProviderExperiments.findFirst({
      where: eq(riwiProviderExperiments.id, mismatch.experiment.id), columns: { idempotencyKey: true },
    }))!.idempotencyKey }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    assert.equal(calls.length, 2, "replay retries the idempotent signal path but never repeats provider work");
    assert.equal((await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, mismatch.experiment.id))).length, 1);

    comparisonMode = "same";
    const agreement = await runRiwiProviderExperiment({ actor, fixtureId, providerIds: ["lab-stub-one", "lab-stub-two"], idempotencyKey: randomUUID() }, {
      database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {},
    });
    assert.equal(agreement.experiment.comparison?.exactAnswerMatch, true);
    const [consensus] = await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, agreement.experiment.id));
    assert.ok(consensus);
    assert.equal(consensus.signalType, "provider_agreement");
    assert.equal(consensus.state, "candidate", "provider agreement is not trusted or promoted");
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0, "model agreement cannot create or activate knowledge");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider lab denies an adapter with no registered safe model identifier before dispatch", async () => {
  const database = await createTestDatabase();
  let calls = 0;
  const registry = new ProviderRegistry();
  registry.register({
    ...fakeProvider(async () => {
      calls++;
      return { ok: true, answer: { answer: "Must not call with an unsafe model identifier.", uncertainty: null, citations: [] } };
    }),
    model: "https://provider.example/model",
    requiredSecrets: [],
  });
  setRollout(true);
  try {
    await seed(database);
    const result = await runRiwiProviderExperiment({
      actor: { id: ownerId, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    assert.equal(calls, 0);
    assert.equal(result.experiment.results[0]?.model, null);
    assert.equal(result.experiment.results[0]?.state, "externally_unverified");
    assert.equal(result.experiment.results[0]?.safeErrorCode, "registered_model_unavailable");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider experiments, histories, and idempotency keys are isolated per owner", async () => {
  const database = await createTestDatabase();
  const secondOwnerId = randomUUID();
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => ({ ok: true, answer: { answer: "External AI stays disabled in this isolation test.", uncertainty: null, citations: [] } })));
  setRollout(true);
  try {
    await seed(database);
    await database.db.insert(users).values({ id: secondOwnerId, name: "Isolated Owner", role: "owner", accountStatus: "active" });
    const firstActor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const secondActor = { id: secondOwnerId, role: "owner" as const, accountStatus: "active" as const };
    const idempotencyKey = randomUUID();
    const first = await runRiwiProviderExperiment({
      actor: firstActor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey,
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
    assert.equal((await listRiwiProviderExperimentPage(firstActor, { limit: 20 }, database.db)).experiments.length, 1);
    assert.equal((await listRiwiProviderExperimentPage(secondActor, { limit: 20 }, database.db)).experiments.length, 0);
    await assert.rejects(getRiwiProviderExperiment(secondActor, first.experiment.id, database.db),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "not_found");

    const second = await runRiwiProviderExperiment({
      actor: secondActor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey,
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
    assert.equal(second.replay, false, "a key used by a different owner is not an idempotency replay");
    assert.notEqual(second.experiment.id, first.experiment.id);
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("owner provider-lab rate limit is four calls per account per hour", () => {
  resetAll();
  try {
    const account = "owner-fixture-test";
    for (let index = 0; index < 4; index++) assert.equal(consume(RULES.riwiProviderLab, account).ok, true);
    const limited = consume(RULES.riwiProviderLab, account);
    assert.equal(limited.ok, false);
    assert.ok(limited.retryAfterSeconds > 0);
    assert.equal(consume(RULES.riwiProviderLab, "another-owner").ok, true);
  } finally {
    resetAll();
  }
});

test("database-backed provider-lab run budget caps distinct experiments at four per owner per hour", async () => {
  const database = await createTestDatabase();
  let calls = 0;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    calls++;
    return { ok: true, answer: { answer: "Must not run while external AI is disabled.", uncertainty: null, citations: [] } };
  }));
  setRollout(true);
  try {
    await seed(database);
    const actor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const keys: string[] = [];
    for (let index = 0; index < 4; index++) {
      const idempotencyKey = randomUUID();
      keys.push(idempotencyKey);
      const result = await runRiwiProviderExperiment({
        actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey,
      }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
      assert.equal(result.experiment.state, "failed");
      assert.equal(result.experiment.results[0]?.state, "externally_unverified");
    }
    const replay = await runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: keys[3]!,
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
    assert.equal(replay.replay, true, "idempotent replay does not consume another run slot");
    await assert.rejects(runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} }),
    (error: unknown) => error instanceof RiwiProviderLabError && error.code === "rate_limited");
    assert.equal((await database.db.select().from(riwiProviderExperiments)).length, 4);
    assert.equal(calls, 0, "persistent budget checks occur even when in-memory route limits are bypassed");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("database-backed global experiment budget caps distinct runs at twelve per hour across owners", async () => {
  const database = await createTestDatabase();
  const extraOwnerIds = [randomUUID(), randomUUID(), randomUUID()];
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => ({ ok: true, answer: { answer: "Must not call while external AI is disabled.", uncertainty: null, citations: [] } })));
  setRollout(true);
  try {
    await seed(database);
    await database.db.insert(users).values(extraOwnerIds.map((id, index) => ({
      id, name: `Global Budget Owner ${index}`, role: "owner" as const, accountStatus: "active" as const,
    })));
    const ownerIds = [ownerId, ...extraOwnerIds];
    const replayKeys: string[] = [];
    for (const id of ownerIds) {
      for (let index = 0; index < 3; index++) {
        const key = randomUUID();
        replayKeys.push(key);
        const result = await runRiwiProviderExperiment({
          actor: { id, role: "owner", accountStatus: "active" },
          fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
          providerIds: ["lab-stub"], idempotencyKey: key,
        }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
        assert.equal(result.experiment.results[0]?.state, "externally_unverified");
      }
    }
    assert.equal(replayKeys.length, RIWI_PROVIDER_LAB_MAX_RUNS_PER_HOUR_GLOBAL);
    const replay = await runRiwiProviderExperiment({
      actor: { id: ownerIds[3]!, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub"], idempotencyKey: replayKeys.at(-1)!,
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} });
    assert.equal(replay.replay, true, "replay does not consume a global run slot");
    await assert.rejects(runRiwiProviderExperiment({
      actor: { id: ownerIds[0]!, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => false, writeAudit: async () => {} }),
    (error: unknown) => error instanceof RiwiProviderLabError && error.code === "rate_limited");
    assert.equal((await database.db.select().from(riwiProviderExperiments)).length, RIWI_PROVIDER_LAB_MAX_RUNS_PER_HOUR_GLOBAL);
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("database admission lock enforces a global two-experiment concurrency ceiling across owners", async () => {
  const database = await createTestDatabase();
  const secondOwnerId = randomUUID();
  const thirdOwnerId = randomUUID();
  let entered = 0;
  let resolveStarted!: () => void;
  let releaseProvider!: () => void;
  const bothStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    entered++;
    if (entered === 2) resolveStarted();
    await providerGate;
    return { ok: true, answer: { answer: "Bounded provider response.", uncertainty: null, citations: [] } };
  }));
  setRollout(true);
  let pending: Promise<unknown>[] = [];
  try {
    await seed(database);
    await database.db.insert(users).values([
      { id: secondOwnerId, name: "Second Lab Owner", role: "owner", accountStatus: "active" },
      { id: thirdOwnerId, name: "Third Lab Owner", role: "owner", accountStatus: "active" },
    ]);
    const runFor = (id: string) => runRiwiProviderExperiment({
      actor: { id, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub"],
      idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    pending = [runFor(ownerId), runFor(secondOwnerId)];
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([bothStarted, new Promise<never>((_, reject) => {
        startTimer = setTimeout(() => reject(new Error("two provider calls did not start")), 5000);
      })]);
    } finally { if (startTimer) clearTimeout(startTimer); }

    await assert.rejects(runFor(thirdOwnerId),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "concurrency_limited");
    assert.equal(entered, RIWI_PROVIDER_LAB_MAX_GLOBAL_RUNNING);
    assert.equal((await database.db.select().from(riwiProviderExperiments).where(eq(riwiProviderExperiments.state, "running"))).length,
      RIWI_PROVIDER_LAB_MAX_GLOBAL_RUNNING);
    releaseProvider();
    const completed = await Promise.all(pending) as Array<{ experiment: { state: string } }>;
    assert.ok(completed.every((result) => result.experiment.state === "completed"));
  } finally {
    releaseProvider();
    await Promise.allSettled(pending);
    restoreEnvironment();
    await database.close();
  }
});

test("provider-lab stores only safe provider-failure codes, never raw provider details", async () => {
  const database = await createTestDatabase();
  const providerRawBody = "RAW_PROVIDER_BODY_SENTINEL secret=not-for-storage";
  let calls = 0;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    calls++;
    return { ok: false, failure: { reason: "provider_error", detail: providerRawBody, retryable: false } };
  }));
  setRollout(true);
  try {
    await seed(database);
    const result = await runRiwiProviderExperiment({
      actor: { id: ownerId, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    assert.equal(calls, 1);
    assert.equal(result.experiment.state, "failed");
    assert.equal(result.experiment.results[0]?.state, "provider_error");
    assert.equal(result.experiment.results[0]?.safeErrorCode, "provider_error");
    assert.equal(result.experiment.results[0]?.normalizedResult, null);
    assert.ok(!JSON.stringify(result.experiment).includes(providerRawBody));
    const stored = await database.db.select().from(riwiProviderExperimentResults);
    assert.equal(stored[0]?.safeErrorCode, "provider_error");
    assert.ok(!JSON.stringify(stored).includes(providerRawBody));
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider-lab timeout and in-flight abort are bounded, propagated, and safely persisted", async () => {
  const database = await createTestDatabase();
  const registry = new ProviderRegistry();
  let timeoutCalls = 0;
  let timeoutAbortObserved = false;
  const timeoutEpoch = Date.now();
  let timeoutStartedAt: number | null = null;
  // This scenario exercises an in-flight timeout. Database/audit setup must not
  // consume its 15ms provider budget before the provider has even entered.
  const timeoutNow = () => new Date(timeoutEpoch + (timeoutStartedAt === null ? 0 : Date.now() - timeoutStartedAt));
  registry.register(fakeProvider(async (context) => {
    timeoutCalls++;
    timeoutStartedAt = Date.now();
    await new Promise<void>((resolve) => context.signal!.addEventListener("abort", () => {
      timeoutAbortObserved = true;
      resolve();
    }, { once: true }));
    return { ok: true, answer: { answer: "Late timeout result must be discarded.", uncertainty: null, citations: [] } };
  }));
  setRollout(true);
  try {
    await seed(database);
    const actor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const timeoutResult = await runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, timeoutMs: 15, now: timeoutNow, writeAudit: async () => {} });
    assert.equal(timeoutCalls, 1);
    assert.equal(timeoutAbortObserved, true);
    assert.equal(timeoutResult.experiment.results[0]?.state, "timeout");
    assert.equal(timeoutResult.experiment.results[0]?.normalizedResult, null);
    assert.ok(timeoutResult.experiment.results[0]!.durationMs >= 0);

    // Setup can exhaust the experiment deadline in production. In that case
    // skipping the provider is correct; verify that boundary independently.
    let deadlineReads = 0;
    const expired = await runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, timeoutMs: 15,
      now: () => new Date(timeoutEpoch + (deadlineReads++ === 0 ? 0 : 16)), writeAudit: async () => {} });
    assert.equal(timeoutCalls, 1, "an exhausted setup deadline must never invoke the provider");
    assert.equal(expired.experiment.results[0]?.state, "timeout");
    assert.equal(expired.experiment.results[0]?.safeErrorCode, "experiment_timeout");
    assert.equal(expired.experiment.results[0]?.normalizedResult, null);

    let resolveStarted!: () => void;
    let cancelSignalObserved = false;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    registry.register(fakeProvider(async (context) => {
      resolveStarted();
      await new Promise<void>(() => context.signal!.addEventListener("abort", () => { cancelSignalObserved = true; }, { once: true }));
      return { ok: true, answer: { answer: "Cancelled result must be discarded.", uncertainty: null, citations: [] } };
    }));
    const controller = new AbortController();
    const cancelledRun = runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds: ["lab-stub"], idempotencyKey: randomUUID(), signal: controller.signal,
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([started, new Promise<never>((_, reject) => {
        startTimer = setTimeout(() => reject(new Error("provider call did not start")), 5000);
      })]);
    } finally { if (startTimer) clearTimeout(startTimer); }
    controller.abort();
    const cancelled = await cancelledRun;
    assert.equal(cancelSignalObserved, true);
    assert.equal(cancelled.experiment.results[0]?.state, "cancelled");
    assert.equal(cancelled.experiment.results[0]?.normalizedResult, null);
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("the experiment-wide provider deadline is shared across two sequential calls", async () => {
  const database = await createTestDatabase();
  let secondProviderAborted = false;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240));
    return { ok: true, answer: { answer: "First provider completed within the shared deadline.", uncertainty: null, citations: [] } };
  }));
  registry.register({
    ...fakeProvider(async (context) => new Promise((resolve) => {
      context.signal!.addEventListener("abort", () => { secondProviderAborted = true; }, { once: true });
    })),
    id: "lab-second", displayName: "Second Lab Stub",
  });
  setRollout(true);
  try {
    await seed(database);
    const result = await runRiwiProviderExperiment({
      actor: { id: ownerId, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub", "lab-second"],
      idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, timeoutMs: 400, writeAudit: async () => {} });
    assert.equal(result.experiment.state, "partial");
    assert.equal(result.experiment.results[0]?.state, "succeeded");
    assert.equal(result.experiment.results[1]?.state, "timeout");
    assert.equal(secondProviderAborted, true);
    assert.ok(result.experiment.results[1]!.durationMs < 250,
      "the second provider receives only the remainder of the experiment-wide 400ms test deadline");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider lab comparisons report literal normalized-text matching only, not semantic quality", async () => {
  const database = await createTestDatabase();
  const registry = new ProviderRegistry();
  const answerProvider = (id: string, answer: string): EvaluationProvider => ({
    ...fakeProvider(async () => ({ ok: true, answer: { answer, uncertainty: null, citations: [] } })),
    id, displayName: id,
  });
  registry.register(answerProvider("lab-stub", "Use an before a vowel sound."));
  registry.register(answerProvider("lab-second", " USE   AN before a vowel sound. "));
  registry.register(answerProvider("lab-different", "Use a before a vowel sound."));
  setRollout(true);
  try {
    await seed(database);
    const actor = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
    const run = (providerIds: string[]) => runRiwiProviderExperiment({
      actor, fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id, providerIds, idempotencyKey: randomUUID(),
    }, { database: database.db, registry, externalEnabled: async () => true, writeAudit: async () => {} });
    const match = await run(["lab-stub", "lab-second"]);
    assert.equal(match.experiment.comparison?.status, "compared");
    assert.equal(match.experiment.comparison?.exactAnswerMatch, true);
    const mismatch = await run(["lab-stub", "lab-different"]);
    assert.equal(mismatch.experiment.comparison?.status, "compared");
    assert.equal(mismatch.experiment.comparison?.exactAnswerMatch, false);
    assert.equal(mismatch.experiment.state, "completed", "literal differences are evidence for review, not automated quality failures");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("owner provider-lab route derives an active owner from the server and rejects caller-selected authority", () => {
  const route = readFileSync("src/app/api/riwi/owner/provider-lab/route.ts", "utf8");
  assert.match(route, /async function ownerActor\(\)[\s\S]*?requireActiveUser\(\)/);
  assert.match(route, /type: z\.literal\("external"\)/, "GET schema matches registered external provider metadata");
  assert.match(route, /MODEL_ID\.test\(provider\.model\)/, "status only exposes a safe configured model identifier");
  assert.match(route, /user\.role !== "owner"/);
  assert.match(route, /accountStatus/);
  assert.match(route, /authorizeCapability\(actor, "riwi\.provider\.live_test"\)/);
  assert.match(route, /error\.code === "concurrency_limited" \|\| error\.code === "rate_limited"/);
  assert.match(route, /riwiProviderLabRequestSchema\.safeParse\(body\.value\)/);
  assert.doesNotMatch(route, /body\.value\.userId|body\.value\.role|body\.value\.model|body\.value\.secret/);
});

test("provider-lab pre-call audit failure is persisted as a safe failure and never reaches the provider", async () => {
  const database = await createTestDatabase();
  let calls = 0;
  let failedProviderAudit = false;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    calls++;
    return { ok: true, answer: { answer: "Must never run", uncertainty: null, citations: [] } };
  }));
  setRollout(true);
  try {
    await seed(database);
    const result = await runRiwiProviderExperiment({
      actor: { id: ownerId, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub"],
      idempotencyKey: randomUUID(),
    }, {
      database: database.db, registry, externalEnabled: async () => true,
      writeAudit: async ({ targetType }) => {
        if (targetType === "riwi_provider" && !failedProviderAudit) {
          failedProviderAudit = true;
          throw new Error("provider request audit unavailable");
        }
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.experiment.state, "failed");
    assert.equal(result.experiment.results[0]?.state, "audit_failed");
    assert.equal(result.experiment.results[0]?.safeErrorCode, "audit_unavailable");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("completion-audit failure withholds the normalized answer and persists only a safe failure state", async () => {
  const database = await createTestDatabase();
  let calls = 0;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    calls++;
    return { ok: true, answer: { answer: "Provider answer must not be shown without a completion audit.", uncertainty: null, citations: [] } };
  }));
  setRollout(true);
  try {
    await seed(database);
    const result = await runRiwiProviderExperiment({
      actor: { id: ownerId, role: "owner", accountStatus: "active" },
      fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
      providerIds: ["lab-stub"],
      idempotencyKey: randomUUID(),
    }, {
      database: database.db,
      registry,
      externalEnabled: async () => true,
      writeAudit: async ({ action, targetType }) => {
        if (action === "riwi.external.succeeded" && targetType === "riwi_provider") throw new Error("result audit unavailable");
      },
    });
    assert.equal(calls, 1, "the already-sent provider request is not retried");
    assert.equal(result.experiment.state, "failed");
    assert.equal(result.experiment.results[0]?.state, "result_audit_failed");
    assert.equal(result.experiment.results[0]?.normalizedResult, null);
    assert.equal(result.experiment.results[0]?.safeErrorCode, "result_audit_unavailable");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});

test("provider lab will not call a provider when required audit cannot be written", async () => {
  const database = await createTestDatabase();
  let calls = 0;
  const registry = new ProviderRegistry();
  registry.register(fakeProvider(async () => {
    calls++;
    return { ok: true, answer: { answer: "This must not be sent or saved.", uncertainty: null, citations: [] } };
  }));
  setRollout(true);

  try {
    await seed(database);
    await assert.rejects(
      runRiwiProviderExperiment({
        actor: { id: ownerId, role: "owner", accountStatus: "active" },
        fixtureId: RIWI_PROVIDER_LAB_FIXTURES[0]!.id,
        providerIds: ["lab-stub"],
        idempotencyKey: randomUUID(),
      }, {
        database: database.db,
        registry,
        externalEnabled: async () => true,
        writeAudit: async () => { throw new Error("audit unavailable"); },
      }),
    );
    assert.equal(calls, 0);
    const experiments = await database.db.select({ id: riwiProviderExperiments.id }).from(riwiProviderExperiments);
    assert.equal(experiments.length, 0, "the experiment and external request are rolled back atomically without the start audit");
  } finally {
    restoreEnvironment();
    await database.close();
  }
});
