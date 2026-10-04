import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { riwiKnowledgeSources, riwiKnowledgeUnits, users } from "../src/db/schema";
import {
  approveKnowledgeCandidate,
  createKnowledgeCandidate,
  promoteKnowledgeSource,
  retrieveActiveKnowledge,
} from "../src/lib/services/riwi/knowledge";
import { createTestDatabase } from "./support/pglite";

const actor = (id: string) => ({ id, role: "owner" as const, accountStatus: "active" as const });
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function publish(
  database: Awaited<ReturnType<typeof createTestDatabase>>,
  ownerId: string,
  title: string,
  content: string,
  options: { role?: "teacher"; userScopeId?: string } = {},
) {
  const candidate = await createKnowledgeCandidate({
    actor: actor(ownerId), sourceType: "grammar_material", title,
    provenance: "Owner-authored retrieval QA fixture", rightsClass: "owner_authored",
    scope: options.role ? { kind: "role", role: options.role } : { kind: "global" }, content,
  }, database.db);
  if (options.userScopeId) {
    await database.db.update(riwiKnowledgeSources).set({ scope: "user", scopeRole: null, scopeUserId: options.userScopeId })
      .where(eq(riwiKnowledgeSources.id, candidate.id));
  }
  await approveKnowledgeCandidate({ actor: actor(ownerId), sourceId: candidate.id }, database.db);
  await promoteKnowledgeSource({
    actor: actor(ownerId), sourceId: candidate.id, regressionFixtureId: "retrieval-active-scope-only-v1",
  }, database.db);
  return candidate.id;
}

test("retrieval filters natural-language filler, enforces active role/user scopes, and fails closed", async () => {
  const database = await createTestDatabase();
  const ownerId = randomUUID();
  const studentId = randomUUID();
  const otherStudentId = randomUUID();
  const teacherId = randomUUID();
  try {
    await database.db.insert(users).values([
      { id: ownerId, name: "Knowledge owner", role: "owner", accountStatus: "active" },
      { id: studentId, name: "Knowledge student", role: "student", accountStatus: "active" },
      { id: otherStudentId, name: "Other knowledge student", role: "student", accountStatus: "active" },
      { id: teacherId, name: "Knowledge teacher", role: "teacher", accountStatus: "active" },
    ]);

    const globalId = await publish(database, ownerId, "Article rule", "Use an article before a singular count noun.");
    const teacherIdSource = await publish(database, ownerId, "Teacher-only note", "Past perfect continuous forms describe an earlier ongoing action.", { role: "teacher" });
    const personalId = await publish(database, ownerId, "Learner note", "A bespoke lexicon token belongs only to this learner.", { userScopeId: studentId });

    const student = { id: studentId, role: "student" as const };
    const global = await retrieveActiveKnowledge("How do I use an article before the singular count noun?", student, database.db);
    assert.equal(global.length, 1, "bounded content words recover a hit from a natural-language question");
    assert.equal(global[0]?.sourceId, globalId);
    assert.equal(global[0]?.ref, "K1");
    assert.equal((await retrieveActiveKnowledge("past perfect continuous", student, database.db)).length, 0,
      "teacher-scoped knowledge is not visible to a student");
    assert.equal((await retrieveActiveKnowledge("past perfect continuous", { id: teacherId, role: "teacher" }, database.db))[0]?.sourceId, teacherIdSource);
    assert.equal((await retrieveActiveKnowledge("bespoke lexicon token", student, database.db))[0]?.sourceId, personalId);
    assert.equal((await retrieveActiveKnowledge("bespoke lexicon token", { id: otherStudentId, role: "student" }, database.db)).length, 0,
      "user-scoped knowledge is self-only");
    assert.deepEqual(await retrieveActiveKnowledge("how do I explain this, please?", student, database.db), [],
      "a query containing no content terms does not broaden retrieval");
    assert.deepEqual(await retrieveActiveKnowledge("singular count noun", student, {
      select: () => { throw new Error("search unavailable"); },
    } as never), [], "database/search failures return no context rather than an unfiltered fallback");

    const contents = Array.from({ length: 6 }, (_, index) => `retrieval anchor item ${String(index).padStart(2, "0")} token`);
    const authorities = [41, 42, 43, 44, 45, 95];
    const rows = await database.db.insert(riwiKnowledgeSources).values(contents.map((content, index) => ({
      sourceType: "grammar_material" as const,
      title: `Retrieval fixture ${index}`,
      checksum: sha256(content),
      provenance: "Bounded retrieval test fixture",
      rightsClass: "owner_authored",
      authority: authorities[index]!,
      scope: "global" as const,
      scopeRole: null,
      scopeUserId: null,
      state: "active" as const,
      parserVersion: "test/1",
      unitCount: 1,
      createdByUserId: ownerId,
      regressionFixtureId: "retrieval-active-scope-only-v1",
      regressionEvidenceHash: "a".repeat(64),
      regressionPassedAt: new Date(),
    }))).returning({ id: riwiKnowledgeSources.id });
    await database.db.insert(riwiKnowledgeUnits).values(rows.map((row, index) => ({
      sourceId: row.id,
      ordinal: 0,
      heading: null,
      content: contents[index]!,
      contentHash: sha256(contents[index]!),
      characterCount: contents[index]!.length,
    })));

    const ranked = await retrieveActiveKnowledge("retrieval anchor", student, database.db);
    assert.equal(ranked.length, 5, "retrieval is capped at five bounded excerpts");
    assert.deepEqual(ranked.map((item) => item.authority), [95, 45, 44, 43, 42], "relevance ties prefer higher registered authority");
    assert.deepEqual(ranked.map((item) => item.ref), ["K1", "K2", "K3", "K4", "K5"]);
    assert.deepEqual((await retrieveActiveKnowledge("retrieval anchor", student, database.db)).map((item) => item.sourceId),
      ranked.map((item) => item.sourceId), "stable tie-breakers keep citation mapping deterministic");
  } finally {
    await database.close();
  }
});
