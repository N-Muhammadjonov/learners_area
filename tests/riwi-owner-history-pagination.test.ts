import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLog, riwiKnowledgeSources, riwiLearningSignals, riwiProviderExperiments, users } from "../src/db/schema";
import {
  countKnowledgeSourcesForOwner,
  listKnowledgeSourcePage,
  KnowledgeServiceError,
} from "../src/lib/services/riwi/knowledge";
import {
  countLearningSignalsForOwner,
  LearningServiceError,
  listLearningSignalPage,
} from "../src/lib/services/riwi/learning";
import {
  countRiwiGovernanceAuditForOwner,
  listRiwiGovernanceAuditPage,
  RiwiAuditError,
} from "../src/lib/services/riwi/audit";
import {
  countRiwiProviderExperiments,
  listRiwiProviderExperimentPage,
  RiwiProviderLabError,
} from "../src/lib/services/riwi/provider-lab";
import { createTestDatabase } from "./support/pglite";

const ownerActor = (id: string) => ({ id, role: "owner" as const, accountStatus: "active" as const });

function createdAtFor(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(index / 2)));
}

test("owner histories page by stable timestamp and id, reauthorize every page, and count beyond displayed pages", async () => {
  const testDb = await createTestDatabase();
  try {
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    await testDb.db.insert(users).values([
      { id: ownerId, name: "History owner", role: "owner", accountStatus: "active" },
      { id: otherOwnerId, name: "Other history owner", role: "owner", accountStatus: "active" },
    ]);
    const actor = ownerActor(ownerId);
    const otherActor = ownerActor(otherOwnerId);
    const total = 31;
    const sourceRows = Array.from({ length: total }, (_, index) => ({
      id: randomUUID(), sourceType: "grammar_material" as const, title: `History source ${index}`,
      checksum: index.toString(16).padStart(64, "0"), provenance: "Owner-authored isolated pagination fixture",
      rightsClass: "owner_authored", authority: 65, scope: "global" as const,
      state: index % 2 === 0 ? "candidate" as const : "approved" as const,
      version: 1, unitCount: 0, createdAt: createdAtFor(index), updatedAt: createdAtFor(index),
    }));
    await testDb.db.insert(riwiKnowledgeSources).values(sourceRows);
    const signalRows = Array.from({ length: total }, (_, index) => ({
      id: randomUUID(), signalType: "manual_qa_finding" as const,
      state: index % 3 === 0 ? "in_review" as const : index % 3 === 1 ? "candidate" as const : "accepted" as const,
      actorUserId: ownerId, actorRole: "owner" as const, sourceId: randomUUID(),
      candidateClaim: `Private owner claim ${index}`, evidenceSummary: `Private evidence ${index}`,
      evidenceHash: index.toString(16).padStart(64, "0"), scope: "global" as const, createdAt: createdAtFor(index),
    }));
    await testDb.db.insert(riwiLearningSignals).values(signalRows);
    const auditRows = Array.from({ length: total }, (_, index) => ({
      id: randomUUID(), actorUserId: ownerId, action: "riwi.learning.signal.created",
      targetType: "riwi_learning_signal", targetId: signalRows[index]!.id,
      metadata: { role: "owner", signalId: signalRows[index]!.id }, createdAt: createdAtFor(index),
    }));
    await testDb.db.insert(auditLog).values(auditRows);
    const experimentRows = Array.from({ length: total }, (_, index) => ({
      id: randomUUID(), actorUserId: ownerId, taskProfile: "riwi_chat", fixtureId: "safe-grammar-explanation-v1",
      providers: ["openai"], idempotencyKey: randomUUID(), state: "pending" as const,
      createdAt: createdAtFor(index),
    }));
    await testDb.db.insert(riwiProviderExperiments).values(experimentRows);

    const [sourceFirst, signalFirst, auditFirst, experimentFirst] = await Promise.all([
      listKnowledgeSourcePage(actor, { limit: 5 }, testDb.db),
      listLearningSignalPage(actor, { limit: 5 }, testDb.db),
      listRiwiGovernanceAuditPage(actor, { limit: 5 }, testDb.db),
      listRiwiProviderExperimentPage(actor, { limit: 5 }, testDb.db),
    ]);
    assert.equal(sourceFirst.sources.length, 5);
    assert.equal(signalFirst.signals.length, 5);
    assert.equal(auditFirst.entries.length, 5);
    assert.equal(experimentFirst.experiments.length, 5);
    assert.ok(sourceFirst.nextCursor && signalFirst.nextCursor && auditFirst.nextCursor && experimentFirst.nextCursor);
    assert.equal("candidateClaim" in signalFirst.signals[0]!, false, "the list page excludes private signal claims and evidence");
    assert.equal("content" in sourceFirst.sources[0]!, false, "the source list page does not return source-unit content");

    const [sourceCounts, learningCounts, auditCount, experimentCount] = await Promise.all([
      countKnowledgeSourcesForOwner(actor, testDb.db),
      countLearningSignalsForOwner(actor, testDb.db),
      countRiwiGovernanceAuditForOwner(actor, testDb.db),
      countRiwiProviderExperiments(actor, testDb.db),
    ]);
    assert.deepEqual(sourceCounts, { total, candidates: 16, approved: 15 });
    assert.deepEqual(learningCounts, { total, pending: 21 });
    assert.equal(auditCount, total);
    assert.equal(experimentCount, total);

    const [sourceSecond, signalSecond, auditSecond, experimentSecond] = await Promise.all([
      listKnowledgeSourcePage(actor, { limit: 5, cursor: sourceFirst.nextCursor }, testDb.db),
      listLearningSignalPage(actor, { limit: 5, cursor: signalFirst.nextCursor }, testDb.db),
      listRiwiGovernanceAuditPage(actor, { limit: 5, cursor: auditFirst.nextCursor }, testDb.db),
      listRiwiProviderExperimentPage(actor, { limit: 5, cursor: experimentFirst.nextCursor }, testDb.db),
    ]);
    assert.equal(sourceSecond.sources.length, 5);
    assert.equal(signalSecond.signals.length, 5);
    assert.equal(auditSecond.entries.length, 5);
    assert.equal(experimentSecond.experiments.length, 5);

    const allSources = [...sourceFirst.sources, ...sourceSecond.sources];
    const allSignals = [...signalFirst.signals, ...signalSecond.signals];
    const allAudit = [...auditFirst.entries, ...auditSecond.entries];
    const allExperiments = [...experimentFirst.experiments, ...experimentSecond.experiments];
    for (const ids of [allSources, allSignals, allAudit, allExperiments].map((rows) => rows.map((row) => row.id))) {
      assert.equal(new Set(ids).size, 10, "sequential pages neither overlap nor duplicate ids");
    }
    assert.deepEqual(allSources.map((row) => row.id), [...sourceRows]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 10).map((row) => row.id), "timestamp ties are traversed by descending source id");
    assert.deepEqual(allSignals.map((row) => row.id), [...signalRows]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 10).map((row) => row.id), "timestamp ties are traversed by descending signal id");
    assert.deepEqual(allAudit.map((row) => row.id), [...auditRows]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 10).map((row) => row.id), "timestamp ties are traversed by descending audit id");
    assert.deepEqual(allExperiments.map((row) => row.id), [...experimentRows]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 10).map((row) => row.id), "timestamp ties are traversed by descending experiment id");
    await assert.rejects(listKnowledgeSourcePage(actor, { limit: 101 }, testDb.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "invalid_input");
    await assert.rejects(listLearningSignalPage(actor, { limit: 5, cursor: "malformed" }, testDb.db),
      (error: unknown) => error instanceof LearningServiceError && error.code === "invalid_input");
    assert.ok(sourceSecond.nextCursor && signalSecond.nextCursor && auditSecond.nextCursor && experimentSecond.nextCursor);

    await assert.rejects(listKnowledgeSourcePage(otherActor, { limit: 5, cursor: sourceFirst.nextCursor }, testDb.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "invalid_input",
      "a cursor cannot be replayed as another owner's authority");
    await assert.rejects(listLearningSignalPage(actor, { limit: 5, cursor: sourceFirst.nextCursor }, testDb.db),
      (error: unknown) => error instanceof LearningServiceError && error.code === "invalid_input",
      "a cursor from another history collection is rejected");
    await assert.rejects(listRiwiGovernanceAuditPage({ ...actor, role: "student" }, { limit: 5, cursor: auditFirst.nextCursor }, testDb.db),
      (error: unknown) => error instanceof RiwiAuditError && error.code === "forbidden",
      "a cursor never overrides a current role change");
    await assert.rejects(listRiwiProviderExperimentPage(otherActor, { limit: 5, cursor: experimentFirst.nextCursor }, testDb.db),
      (error: unknown) => error instanceof RiwiProviderLabError && error.code === "invalid_input");

    await testDb.db.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, ownerId));
    await assert.rejects(listKnowledgeSourcePage(actor, { limit: 5, cursor: sourceFirst.nextCursor }, testDb.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "forbidden",
      "a previously valid cursor is denied after current account revocation");
  } finally {
    await testDb.close();
  }
});
