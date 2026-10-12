import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { contentVersions, speakingAttempts, speakingMaterials } from "../src/db/schema";
import { saveContentDraft, publishContentVersion, type AuthoringActor } from "../src/lib/content/authoring";
import { MODULE_DESCRIPTORS, isKnownContentType } from "../src/lib/content/taxonomy";
import { previewContentVersion, previewInventory } from "../src/lib/content/preview";
import { listRegisteredAuthors, registerModuleAuthors } from "../src/lib/content/authors";
import { createMaterialSchema } from "../src/lib/validation/speaking";
import { speakingAttemptIdentity, startSpeakingAttempt } from "../src/lib/services/speaking/attempts";
import { sourceRefForSpeakingMaterial, speakingMaterialSnapshot } from "../src/lib/services/speaking/materials";
import { createTestDatabase } from "./support/pglite";

/**
 * SPEAKING CANONICAL IDENTITY (§5) and the legacy-type mapping (§6).
 *
 * The claims under test:
 *   • starting an attempt on a bank prompt PINS the exact revision it answered, and a
 *     later re-author does not change what an old attempt names;
 *   • a prompt that is not live for learners cannot be practised against — a draft or a
 *     future-scheduled prompt is refused instead of silently bound;
 *   • free practice stays free, and a legacy prompt with no canonical revision yields an
 *     honestly UNBOUND attempt rather than an invented version;
 *   • `speaking:material` is authored, versioned, published and previewed through the
 *     same services as every other content kind — the material table keeps serving the
 *     learner pages it already served, and gains identity instead of a second store;
 *   • `topic_set` is not a content type (a topic set is the topic grouping over the one
 *     bank) and `shadowing` is a material category, not a separate store.
 */

const read = (path: string) => readFileSync(path, "utf8");
const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

async function actor(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [user] = await database.query<{ id: string }>(`insert into users (name, role) values ('Speaking owner', 'owner') returning id`);
  return { ...owner, id: user!.id };
}

test("SP1 an attempt pins the exact prompt revision, and a re-author never rewrites it", async () => {
  const database = await createTestDatabase();
  try {
    const author = await actor(database);

    // v1: authored and published through the canonical services.
    const first = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "part1_question",
        sourceRef: "sp1-hometown",
        title: "Hometown",
        payload: { part: "part1", category: "part1", promptText: "Where is your hometown?", followUps: [] },
      }),
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    await database.db.transaction((tx) => publishContentVersion(tx, { actor: author, versionId: first.version.id, to: "published" }));

    const started = await startSpeakingAttempt({ actorId: author.id, promptId: first.version.targetId!, part: "part1" }, database.db as never);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.binding, "pinned");
    assert.equal(started.contentVersionId, first.version.id, "the attempt records the published revision");

    // v2: the same item re-authored and published. The published v1 is immutable, so the
    // revision is created by saving under the same IDENTITY (sourceRef) — never by
    // rewriting the old revision. The old attempt must keep naming v1.
    const second = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "part1_question",
        sourceRef: "sp1-hometown",
        title: "Hometown",
        payload: { part: "part1", category: "part1", promptText: "Where is your hometown, and do you like it?", followUps: [] },
      }),
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    await database.db.transaction((tx) => publishContentVersion(tx, { actor: author, versionId: second.version.id, to: "published" }));
    assert.notEqual(second.version.id, first.version.id, "a re-author made a new revision");

    const identity = await speakingAttemptIdentity(started.attempt.id, database.db as never);
    assert.equal(identity?.contentVersionId, first.version.id, "the pinned revision is unchanged");
    assert.match(identity!.versionIdentity, /^speaking:part1_question:sp1-hometown@v1$/);

    // A NEW attempt pins the newest published revision — history stays history.
    const later = await startSpeakingAttempt({ actorId: author.id, promptId: first.version.targetId!, part: "part1" }, database.db as never);
    assert.equal(later.ok && later.contentVersionId, second.version.id, "the newest live revision is what a learner is given now");

    // The prompt row was updated in place: one prompt, one identity, two revisions.
    const rows = await database.db.select({ id: speakingMaterials.id }).from(speakingMaterials);
    assert.equal(rows.length, 0, "no material row was created by speaking prompt authoring");
  } finally {
    await database.close();
  }
});

test("SP2 a prompt that is not live cannot be practised against, and free practice stays free", async () => {
  const database = await createTestDatabase();
  try {
    const author = await actor(database);
    const draft = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "cue_card",
        sourceRef: "sp2-cue-card",
        title: "A memorable journey",
        payload: { part: "part2", category: "part2", promptText: "Describe a memorable journey.", cueCard: "where you went", followUps: [] },
      }),
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;

    const refused = await startSpeakingAttempt({ actorId: author.id, promptId: draft.version.targetId!, part: "part2" }, database.db as never);
    assert.deepEqual(refused, { ok: false, reason: "prompt_not_live" }, "a draft is not learner-facing, so it cannot be pinned as one");

    const missing = await startSpeakingAttempt({ actorId: author.id, promptId: "11111111-1111-1111-1111-111111111111", part: "part2" }, database.db as never);
    assert.deepEqual(missing, { ok: false, reason: "prompt_not_found" });

    const wrongPart = await startSpeakingAttempt({ actorId: author.id, promptId: draft.version.targetId!, part: "part1" }, database.db as never);
    assert.deepEqual(wrongPart, { ok: false, reason: "part_mismatch" }, "one part is not an answer to another");

    const free = await startSpeakingAttempt({ actorId: author.id, promptId: null, part: "general" }, database.db as never);
    assert.equal(free.ok, true);
    if (!free.ok) return;
    assert.equal(free.binding, "free_practice");
    assert.equal(free.attempt.contentVersionId, null, "free practice has no prompt to pin");

    // A LEGACY prompt (a bank row that predates canonical authoring) still starts, and
    // its attempt is honestly unbound instead of pinned to an invented revision.
    const [legacy] = await database.db
      .insert((await import("../src/db/schema")).speakingPrompts)
      .values({ part: "part1", category: "part1", promptText: "Legacy prompt without a revision.", externalId: null })
      .returning({ id: (await import("../src/db/schema")).speakingPrompts.id });
    const unbound = await startSpeakingAttempt({ actorId: author.id, promptId: legacy!.id, part: "part1" }, database.db as never);
    assert.equal(unbound.ok, true);
    if (!unbound.ok) return;
    assert.equal(unbound.binding, "no_canonical_revision");
    assert.equal(unbound.contentVersionId, null);
    assert.equal(await speakingAttemptIdentity(unbound.attempt.id, database.db as never), null, "no identity is claimed for an unbound attempt");
  } finally {
    await database.close();
  }
});

test("SP3 speaking materials are authored, versioned, published and previewed like every other kind", async () => {
  const database = await createTestDatabase();
  try {
    const author = await actor(database);
    registerModuleAuthors();

    const created = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "material",
        sourceRef: "sp3-material-model",
        title: "Model answer for Part 1",
        payload: { title: "Model answer for Part 1", category: "part1", primaryType: "link", primaryUrl: "https://example.org/model-answer.mp3" },
      }),
    );
    assert.equal(created.ok, true, "the material author exists");
    if (!created.ok) return;
    assert.equal(created.version.targetType, "speaking_material");

    const [row] = await database.db.select().from(speakingMaterials).where(eq(speakingMaterials.id, created.version.targetId!));
    assert.equal(row?.title, "Model answer for Part 1");
    assert.equal(row?.category, "part1", "a material is a CATEGORY within one store, not a second store");
    assert.equal(row?.publicationState, "draft", "a new material is not learner-facing");

    // Revising keeps ONE row and adds a revision: identity, not a duplicate.
    const revised = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "material",
        sourceRef: "sp3-material-model",
        title: "Model answer for Part 1 (v2)",
        versionId: created.version.id,
        payload: { title: "Model answer for Part 1 (v2)", category: "part1", primaryType: "link", primaryUrl: "https://example.org/model-answer-v2.mp3" },
      }),
    );
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    const rows = await database.db.select().from(speakingMaterials);
    assert.equal(rows.length, 1, "one material, two revisions — never a duplicate row");
    assert.equal(rows[0]!.title, "Model answer for Part 1 (v2)");

    // Publishing moves the material row, which is what learner reads trust.
    await database.db.transaction((tx) => publishContentVersion(tx, { actor: author, versionId: revised.version.id, to: "published" }));
    const [published] = await database.db.select().from(speakingMaterials).where(eq(speakingMaterials.id, created.version.targetId!));
    assert.equal(published?.publicationState, "published");

    // The material identifies itself by its own ref, and the preview is truthful.
    assert.equal(await sourceRefForSpeakingMaterial(created.version.targetId!, database.db as never), "sp3-material-model");
    const preview = await previewContentVersion(revised.version.id, database.db as never);
    assert.equal(preview?.status, "PREVIEW_READY");
    assert.deepEqual(preview?.identity.versionIdentity, "speaking:material:sp3-material-model@v2");
    assert.equal(preview?.parts.find((part) => part.key === "category")?.value, "part1");

    // The RETIRED category cannot be authored. Shadowing was removed from the product,
    // so the author must refuse it outright rather than quietly writing a material that
    // no surface can ever render.
    const retired = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "material",
        sourceRef: "sp3-retired-shadowing",
        title: "Shadowing attempt",
        payload: { title: "Shadowing attempt", category: "shadowing", primaryType: "link", primaryUrl: "https://example.org/x.mp3" },
      }),
    );
    assert.equal(retired.ok, false, "the retired shadowing category is refused by the author");
    assert.equal((await database.db.select().from(speakingMaterials)).length, 1, "and no shadowing row was written");

    // An attachment may not ride in on a payload: the strict schema rejects it, and the
    // authoring service reports the refusal instead of writing half an item.
    const forged = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "speaking",
        contentType: "material",
        sourceRef: "sp3-forged",
        title: "Forged material",
        payload: { title: "Forged material", category: "part1", primaryType: "file", primaryObjectKey: "private/keys/are-not-trusted.mp3" },
      }),
    );
    assert.equal(forged.ok, false, "a payload carrying an object key is refused by the author");
    assert.equal((await database.db.select().from(speakingMaterials)).length, 1, "and nothing was written");

    // Nothing binary enters a revision: the snapshot names a primary, never a key.
    const snapshot = speakingMaterialSnapshot(
      { title: "t", category: "part1", primaryType: "audio", primaryUrl: null, primaryObjectKey: "private/x.mp3", primaryOriginalName: "x.mp3" },
      [{ type: "text", textContent: "hello", linkUrl: null }],
    );
    assert.equal(snapshot.primaryUrl, null);
    assert.equal(snapshot.hasPrimary, false, "an upload-backed primary is not a URL");
    assert.equal(JSON.stringify(snapshot).includes("private/x.mp3"), false, "no object key in a snapshot");

    const inventory = previewInventory();
    assert.deepEqual(
      inventory.filter((item) => item.status === "MISSING").map((item) => `${item.module}:${item.contentType}`),
      [],
      "the new authorable type has a preview too",
    );
  } finally {
    await database.close();
  }
});

test("SP4 topic_set, shadowing and material are MAPPED — no unmapped speaking type, no duplicate store", () => {
  registerModuleAuthors();
  const speaking = MODULE_DESCRIPTORS.find((descriptor) => descriptor.module === "speaking")!;

  // topic_set: not a content type at all. A topic set is the `topic` grouping over the
  // one canonical bank, managed by manage-topic against `speaking_prompts`.
  assert.equal(isKnownContentType("speaking", "topic_set"), false, "topic_set is not a declared type");
  assert.equal(speaking.contentTypes.includes("topic_set"), false);
  assert.match(read("src/lib/speaking/manage-topic.ts"), /speakingPrompts/, "the topic grouping writes the canonical bank");
  assert.equal(read("src/db/schema.ts").includes("topicSet"), false, "and there is no topic-set table");

  // shadowing: RETIRED from the product by owner decision. It is not a content type,
  // not a material category any author will accept, and it has no studio component.
  // The database enum value and the historical rows are deliberately left alone — the
  // feature is withdrawn, the past is not rewritten.
  assert.equal(isKnownContentType("speaking", "shadowing"), false);
  assert.deepEqual(speaking.contentTypes, ["part1_question", "cue_card", "part3_question", "material"]);
  assert.equal(
    existsSync(resolve(process.cwd(), "src/components/speaking/ShadowingStudio.tsx")),
    false,
    "the shadowing studio component is gone",
  );
  // Asserted behaviourally, not by grep: the word still appears in that file in a
  // comment explaining the retirement, so only a real parse proves the refusal.
  assert.equal(
    createMaterialSchema.safeParse({
      category: "shadowing",
      title: "Shadowing attempt",
      primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.org/x.mp3" },
    }).success,
    false,
    "the authoring schema refuses the retired category",
  );
  assert.equal(
    createMaterialSchema.safeParse({
      category: "part1",
      title: "A supported material",
      primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.org/x.mp3" },
    }).success,
    true,
    "positive control: a surviving category still parses",
  );

  // material: authored, versioned and previewed — and never assignable, because there
  // is no canonical assignment target for it (the registry refuses rather than invents).
  const authors = listRegisteredAuthors().map((author) => `${author.module}:${author.contentType}`);
  assert.ok(authors.includes("speaking:material"));
  const assignments = read("src/lib/content/assignments.ts");
  assert.equal(/speaking_material:/.test(assignments), false, "no invented assignment target for materials");

  // Every declared speaking type is either authored or explicitly non-authorable, and
  // no type is silently declared without an owner somewhere in the system.
  const promptTypes = ["part1_question", "cue_card", "part3_question"];
  for (const contentType of promptTypes) assert.ok(authors.includes(`speaking:${contentType}`), `speaking:${contentType} is authored`);
});
