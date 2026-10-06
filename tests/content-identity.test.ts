import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyIncoming,
  duplicateCandidates,
  fingerprintOf,
  identityReport,
  isStableSourceRef,
  normalizeSourceRef,
  sourceRefFor,
} from "../src/lib/content/identity";
import { inventoryProblems, inventorySummary, legacyInventory } from "../scripts/content-legacy-inventory";
import { pinVersion } from "../src/lib/content/versions";
import { publishContentVersion, type AuthoringActor } from "../src/lib/content/authoring";
import { createTestDatabase } from "./support/pglite";

/**
 * Source identity, duplicate detection and the legacy inventory (§43, §93, §94, §95).
 *
 * The claims under test:
 *   • a source ref is stable and derived from a natural key, never from a title;
 *   • re-importing the same content is a no-op, not a new revision;
 *   • an edit to the answer key alone is reported as such, because it is exactly
 *     the change that must never silently regrade history (§71);
 *   • the same content under a second ref is reported for review, never merged;
 *   • every legacy source is classified, and a "migrate"/"remove" verdict has to
 *     name its successor.
 */

async function ownerActor(database: Awaited<ReturnType<typeof createTestDatabase>>): Promise<AuthoringActor> {
  const [owner] = await database.query<{ id: string }>(`insert into users (name, role) values ('Identity owner', 'owner') returning id`);
  return { id: owner!.id, role: "owner", mayPublish: true };
}

test("SI1 a source ref is normalized from a natural key and never from a title", () => {
  assert.equal(normalizeSourceRef("  Cambridge 14 Test 2  "), "cambridge-14-test-2");
  assert.equal(sourceRefFor("Package 42 / Passage 1"), "package-42-passage-1");
  assert.equal(sourceRefFor("@@@"), null, "an unusable key yields no ref rather than a guess");
  assert.equal(isStableSourceRef("package-42-passage-1"), true);
  assert.equal(isStableSourceRef("Package 42"), false);
  assert.equal(isStableSourceRef("a".repeat(81)), false);
  // A title is deliberately NOT an identity input: editing a title must not move it.
  assert.equal(sourceRefFor("Write about a graph"), "write-about-a-graph");
});

/** The writer an import uses: canonical content straight into the version store. */
async function pin(
  database: Awaited<ReturnType<typeof createTestDatabase>>,
  actorUserId: string,
  input: { sourceRef: string; content: unknown; status?: "draft" | "published"; module?: string; contentType?: string },
) {
  const pinned = await database.db.transaction((tx) =>
    pinVersion(tx, {
      module: input.module ?? "writing",
      contentType: input.contentType ?? "task2",
      sourceRef: input.sourceRef,
      title: "Stable",
      content: input.content,
      publicationState: input.status ?? "draft",
      actorUserId,
    }),
  );
  if (input.status === "published")
    await database.db.transaction((tx) => publishContentVersion(tx, { actor: { id: actorUserId, role: "owner", mayPublish: true }, versionId: pinned.version.id, to: "published" }));
  return pinned;
}

test("SI2 the same bytes are 'identical', so re-running an import writes nothing", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const owner = await ownerActor(database);
    const content = { taskType: "task2", category: "education", prompt: "A prompt about urban transport.", wordMinimum: 250, answerNote: "Band 7 outline" };
    const pinned = await pin(database, owner.id, { sourceRef: "identity-identical", content });
    assert.equal(pinned.created, true);

    const before = await classifyIncoming({ module: "writing", contentType: "task2", sourceRef: "identity-identical", content }, db);
    assert.equal(before.kind, "identical", "a draft still holds the same bytes");
    const report = await identityReport({ module: "writing", contentType: "task2", sourceRef: "identity-identical", content }, db);
    assert.equal(report.wouldCreateVersion, false, "an import that changes nothing creates no version");
    assert.equal(report.contentKey.replace(":", "."), "writing.task2|identity-identical");

    // Whitespace and key order are not identity.
    const reordered = { wordMinimum: 250, answerNote: "Band 7 outline", prompt: "A prompt about urban transport.", taskType: "task2", category: "education" };
    assert.equal((await classifyIncoming({ module: "writing", contentType: "task2", sourceRef: "identity-identical", content: reordered }, db)).kind, "identical");
    // A different WORD does count.
    const edited = { ...content, prompt: "A prompt about urban transport in winter." };
    assert.equal((await classifyIncoming({ module: "writing", contentType: "task2", sourceRef: "identity-identical", content: edited }, db)).kind, "changed");
  } finally {
    await database.close();
  }
});

test("SI3 an answer-key edit and a wording edit are told apart", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const owner = await ownerActor(database);
    const questions = [
      { number: 1, prompt: "Complete the note.", key: ["library"], accepted: [["library"]] },
      { number: 2, prompt: "Complete the note.", key: ["silent"], accepted: [["silent"]] },
    ];
    const original = { questions, promptText: "A listening note completion about public libraries." };
    await pin(database, owner.id, { sourceRef: "identity-change", content: original, module: "listening", contentType: "full_test" });

    // A note the learner reads but is not graded on: the revision's semantics hold.
    const noted = await classifyIncoming(
      { module: "listening", contentType: "full_test", sourceRef: "identity-change", content: { ...original, promptText: "A listening note completion about municipal libraries." } },
      db,
    );
    assert.equal(noted.kind === "changed" ? noted.change : null, "metadata", "a description the learner is not graded on is not a new assessment");

    // A question the learner is graded on changes: new semantics.
    const wording = await classifyIncoming(
      {
        module: "listening",
        contentType: "full_test",
        sourceRef: "identity-change",
        content: { ...original, questions: [questions[0]!, { ...questions[1]!, prompt: "Write ONE WORD ONLY." }] },
      },
      db,
    );
    assert.equal(wording.kind === "changed" ? wording.change : null, "semantic", "the graded material moved");

    // Only the truth moves: this is the change that must never regrade history.
    const keyed = await classifyIncoming(
      {
        module: "listening",
        contentType: "full_test",
        sourceRef: "identity-change",
        content: { ...original, questions: [questions[0]!, { ...questions[1]!, key: ["quiet"], accepted: [["quiet"]] }] },
      },
      db,
    );
    assert.equal(keyed.kind === "changed" ? keyed.change : null, "answer_key", "an answer-key-only change is named as one");

    const fingerprints = fingerprintOf("writing", "task2", original);
    assert.match(fingerprints.semanticHash, /^[0-9a-f]{64}$/);
    assert.notEqual(fingerprints.contentHash, fingerprintOf("writing", "task2", { ...original, promptText: "different" }).contentHash);
  } finally {
    await database.close();
  }
});

test("SI4 the same content under a second ref is reported, never merged", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const owner = await ownerActor(database);
    const content = { taskType: "task2", category: "education", prompt: "A prompt about remote work.", wordMinimum: 250 };
    await pin(database, owner.id, { sourceRef: "identity-first", content, status: "published" });

    const duplicates = await duplicateCandidates({ module: "writing", contentType: "task2", sourceRef: "identity-second", content }, db);
    assert.equal(duplicates.length, 1, "the other ref is reported");
    assert.deepEqual(duplicates[0]!.sourceRef, "identity-first");
    assert.equal(duplicates[0]!.evidence, "identical_content");

    // Identical content stored under a different ref is still its own item: the
    // system reports, a human decides.
    const second = await pin(database, owner.id, { sourceRef: "identity-second", content, status: "published" });
    assert.equal(second.created, true, "a second ref is its own item");
    assert.equal((await duplicateCandidates({ module: "writing", contentType: "task2", sourceRef: "identity-second", content }, db)).length, 1);
    // Same module but a different content type is not a duplicate.
    assert.deepEqual(await duplicateCandidates({ module: "reading", contentType: "general_set", sourceRef: "identity-second", content }, db), []);
  } finally {
    await database.close();
  }
});

test("SI5 every legacy source is classified and a migration verdict names its successor", () => {
  const items = legacyInventory();
  assert.ok(items.length >= 10, "the inventory covers the repository's legacy content");
  for (const item of items) {
    assert.ok(item.reason.length > 20, `${item.path} needs a real reason, not a label`);
    assert.ok(
      ["KEEP", "MIGRATE", "COMPATIBILITY ONLY", "REMOVE AFTER MIGRATION", "MANUAL REVIEW REQUIRED"].includes(item.classification),
      `${item.path} has an unknown classification`,
    );
  }
  assert.deepEqual(inventoryProblems(items), [], "the inventory is internally consistent");
  const summary = inventorySummary(items);
  assert.ok((summary["COMPATIBILITY ONLY"] ?? 0) >= 3, "legacy reads are explicitly kept, not forgotten");
  assert.ok(Object.keys(summary).every((key) => ["KEEP", "MIGRATE", "COMPATIBILITY ONLY", "REMOVE AFTER MIGRATION", "MANUAL REVIEW REQUIRED"].includes(key)));

  // The rule bites: stripping a successor from a MIGRATE item is a problem.
  const broken = [{ path: "x", what: "y", classification: "MIGRATE" as const, reason: "no successor" }];
  assert.equal(inventoryProblems(broken).length, 1);
});
