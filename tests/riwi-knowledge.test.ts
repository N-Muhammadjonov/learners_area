import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Role } from "../src/lib/auth/roles";
import { riwiKnowledgeConflicts, riwiKnowledgeSources, users } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import {
  KnowledgeServiceError,
  approveKnowledgeCandidate,
  createKnowledgeCandidate,
  listKnowledgeConflicts,
  promoteKnowledgeSource,
  resolveKnowledgeConflict,
  retrieveActiveKnowledge,
} from "../src/lib/services/riwi/knowledge";

const owner = (id: string) => ({ id, role: "owner" as const, accountStatus: "active" as const });

async function setup() {
  const database = await createTestDatabase();
  const ownerId = randomUUID();
  await database.db.insert(users).values({ id: ownerId, name: "RIWI knowledge owner", role: "owner", accountStatus: "active" });
  return { database, actor: owner(ownerId) };
}

async function candidate(database: Awaited<ReturnType<typeof createTestDatabase>>, actor: ReturnType<typeof owner>, input: {
  title: string; content: string; rightsClass?: "owner_authored" | "licensed" | "public_domain" | "internal_permission" | "third_party_reference" | "unknown";
  scope?: { kind: "global" } | { kind: "role"; role: Role };
}) {
  return createKnowledgeCandidate({
    actor, sourceType: "grammar_material", title: input.title, provenance: "Owner-authored QA fixture",
    rightsClass: input.rightsClass ?? "owner_authored", scope: input.scope ?? { kind: "global" }, content: input.content,
  }, database.db);
}

 test("candidate knowledge remains inert until rights, review, and linked regression evidence pass", async () => {
  const { database, actor } = await setup();
  try {
    const item = await candidate(database, actor, { title: "Article rule", content: "Use an article before a singular count noun." });
    assert.equal(item.state, "candidate");
    assert.equal(item.unitCount, 1);
    assert.equal((await retrieveActiveKnowledge("singular count noun", { id: randomUUID(), role: "student" }, database.db)).length, 0);

    await approveKnowledgeCandidate({ actor, sourceId: item.id }, database.db);
    const active = await promoteKnowledgeSource({ actor, sourceId: item.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    assert.equal(active.state, "active");
    assert.equal(active.version, 1);
    assert.match(active.regressionEvidenceHash, /^[a-f0-9]{64}$/);
    const retrieved = await retrieveActiveKnowledge("singular count noun", { id: randomUUID(), role: "student" }, database.db);
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0]?.text, "Use an article before a singular count noun.");
    assert.equal(retrieved[0]?.ref, "K1");

    const teacherOnly = await candidate(database, actor, {
      title: "Teacher-only note", content: "Teacher-only notes describe past perfect continuous forms.", scope: { kind: "role", role: "teacher" },
    });
    await approveKnowledgeCandidate({ actor, sourceId: teacherOnly.id }, database.db);
    await promoteKnowledgeSource({ actor, sourceId: teacherOnly.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    assert.equal((await retrieveActiveKnowledge("past perfect continuous", { id: randomUUID(), role: "student" }, database.db)).length, 0);
    assert.equal((await retrieveActiveKnowledge("past perfect continuous", { id: randomUUID(), role: "teacher" }, database.db)).length, 1);

    await assert.rejects(candidate(database, actor, { title: "Duplicate article rule", content: "Use an article before a singular count noun." }),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "duplicate_source");
    const unlicensed = await candidate(database, actor, { title: "Unverified reference", content: "Some unverified material.", rightsClass: "unknown" });
    await assert.rejects(approveKnowledgeCandidate({ actor, sourceId: unlicensed.id }, database.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "rights_unverified");
  } finally {
    await database.close();
  }
});

test("lexical conflicts require owner resolution and accepted candidates must supersede the exact active source", async () => {
  const { database, actor } = await setup();
  try {
    const original = await candidate(database, actor, {
      title: "Present perfect",
      content: "The present perfect uses have or has with a past participle.",
    });
    await approveKnowledgeCandidate({ actor, sourceId: original.id }, database.db);
    await promoteKnowledgeSource({ actor, sourceId: original.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);

    const replacement = await candidate(database, actor, {
      title: "Present perfect updated",
      content: "Present perfect uses have or has with past participle forms.",
    });
    const conflicts = await listKnowledgeConflicts(actor, replacement.id, database.db);
    assert.ok(conflicts.length > 0);
    assert.ok(conflicts.every((conflict) => conflict.state === "open"));
    assert.ok(conflicts.every((conflict) => conflict.activeSourceId === original.id));
    await assert.rejects(approveKnowledgeCandidate({ actor, sourceId: replacement.id }, database.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "unresolved_conflict");

    const conflictId = conflicts[0]!.id;
    await resolveKnowledgeConflict({ actor, conflictId, decision: "accept_candidate", reason: "Reviewed; use this wording as the next version." }, database.db);
    await assert.rejects(resolveKnowledgeConflict({ actor, conflictId, decision: "keep_active", reason: "duplicate second decision" }, database.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "invalid_state");
    await approveKnowledgeCandidate({ actor, sourceId: replacement.id }, database.db);
    await assert.rejects(promoteKnowledgeSource({ actor, sourceId: replacement.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "unresolved_conflict");
    const promoted = await promoteKnowledgeSource({
      actor, sourceId: replacement.id, supersedesSourceId: original.id, regressionFixtureId: "retrieval-active-scope-only-v1",
    }, database.db);
    assert.equal(promoted.state, "active");
    assert.equal(promoted.version, 2);
    assert.equal((await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, original.id) }))?.state, "superseded");

    const rejected = await candidate(database, actor, {
      title: "Keep current wording",
      content: "The present perfect has or have with a past participle form.",
    });
    const rejectedConflicts = await listKnowledgeConflicts(actor, rejected.id, database.db);
    assert.ok(rejectedConflicts.length > 0);
    await resolveKnowledgeConflict({ actor, conflictId: rejectedConflicts[0]!.id, decision: "keep_active", reason: "The active wording remains authoritative." }, database.db);
    assert.equal((await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, rejected.id) }))?.state, "rejected");
    await assert.rejects(approveKnowledgeCandidate({ actor, sourceId: rejected.id }, database.db),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "invalid_state");
    assert.ok((await database.db.select().from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.candidateSourceId, rejected.id))).every((row) => row.state === "rejected"));
  } finally {
    await database.close();
  }
});
