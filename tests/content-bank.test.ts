import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentBankVocabulary, searchContentBank } from "../src/lib/content/bank";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { createTestDatabase } from "./support/pglite";

/**
 * THE CONTENT BANK (§AC).
 *
 * The claims under test:
 *   • an item is identified by (module, contentType, sourceRef) — searching by IDENTITY
 *     works, and a title search is additive rather than the only way in;
 *   • the bank is a projection over `content_versions`: revision counts and states are
 *     aggregated, never copied into a second store;
 *   • both publication questions answer correctly and differently — "the item IS in this
 *     state" versus "the item's history includes this state";
 *   • the result is bounded and paginated, and the total is the filtered total, not the
 *     page size;
 *   • facets describe the filtered bank;
 *   • the route is staff-only and refuses learners.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

const read = (path: string) => readFileSync(path, "utf8");

async function actor(database: Awaited<ReturnType<typeof createTestDatabase>>): Promise<string> {
  const [row] = await database.query<{ id: string }>(`insert into users (name, role) values ('Bank owner', 'owner') returning id`);
  return row!.id;
}

test("CB1 the bank searches by IDENTITY, aggregates revisions, and answers both state questions", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const author = { ...owner, id: ownerId };

    // Two items with the SAME title: identity, not the title, is what distinguishes them.
    const first = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "writing",
        contentType: "task2",
        sourceRef: "bank-item-alpha",
        title: "Education and society",
        payload: { taskType: "task2", category: "education", prompt: "A synthetic prompt long enough to be real, alpha.", targetWordCount: 250 },
      }),
    );
    const second = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "writing",
        contentType: "task2",
        sourceRef: "bank-item-beta",
        title: "Education and society",
        payload: { taskType: "task2", category: "education", prompt: "A synthetic prompt long enough to be real, beta.", targetWordCount: 250 },
      }),
    );
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;

    const byIdentity = await searchContentBank({ sourceRef: "bank-item-alpha" }, db);
    assert.equal(byIdentity.rows.length, 1, "identity search returns exactly the item");
    assert.equal(byIdentity.rows[0]!.sourceRef, "bank-item-alpha");

    const byTitle = await searchContentBank({ title: "Education and society" }, db);
    assert.equal(byTitle.rows.length, 2, "a title search can match several items — which is why it is not identity");

    // Revise one item and publish it: the aggregate follows the history.
    const revised = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: author,
        module: "writing",
        contentType: "task2",
        sourceRef: "bank-item-alpha",
        title: "Education and society (revised)",
        versionId: first.version.id,
        payload: { taskType: "task2", category: "education", prompt: "A synthetic prompt long enough to be real, alpha revised.", targetWordCount: 250 },
      }),
    );
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    await db.transaction((tx) => publishContentVersion(tx, { actor: author, versionId: revised.version.id, to: "published" }));

    const alpha = (await searchContentBank({ sourceRef: "bank-item-alpha" }, db)).rows[0]!;
    assert.equal(alpha.versions, 2, "both revisions are counted");
    assert.equal(alpha.latestVersionNo, 2);
    assert.equal(alpha.latestState, "published", "the item IS published now");
    assert.equal(alpha.states.draft + alpha.states.published, 2, "the state tally describes the history");
    assert.equal(alpha.hasPublishedRevision, true);
    assert.match(alpha.title, /revised/, "the newest revision's title is the item's title");

    // The two state questions are genuinely different questions.
    assert.equal((await searchContentBank({ latestState: "draft", module: "writing" }, db)).rows.some((row) => row.sourceRef === "bank-item-alpha"), false, "its newest revision is not a draft any more");
    assert.equal((await searchContentBank({ hasState: "draft", module: "writing" }, db)).rows.some((row) => row.sourceRef === "bank-item-alpha"), true, "but its history includes a draft");
    assert.equal((await searchContentBank({ hasState: "draft", module: "writing" }, db)).rows.some((row) => row.sourceRef === "bank-item-beta"), true, "and so does the still-draft item");

    // Version and date filters describe the same item.
    assert.equal((await searchContentBank({ versionNo: 2, module: "writing" }, db)).rows.some((row) => row.sourceRef === "bank-item-alpha"), true);
    assert.equal((await searchContentBank({ versionNo: 99, module: "writing" }, db)).rows.length, 0);
    assert.equal((await searchContentBank({ updatedFrom: new Date(Date.now() + 60_000), module: "writing" }, db)).rows.length, 0, "a future date matches nothing");
    assert.equal((await searchContentBank({ updatedTo: new Date(Date.now() + 60_000), module: "writing" }, db)).rows.length, 2);

    // Facets describe the filtered bank.
    const writingBank = await searchContentBank({ module: "writing" }, db);
    assert.equal(writingBank.facets.module.find((facet) => facet.value === "writing")!.count, 2);
    assert.ok(writingBank.facets.state.some((facet) => facet.value === "published"));
    assert.ok(writingBank.facets.contentType.some((facet) => facet.value === "writing:task2"));

    // Bounded and paginated: the total is the filtered total, not the page.
    const page = await searchContentBank({ limit: 1, offset: 0 }, db);
    assert.equal(page.rows.length, 1);
    assert.equal(page.limit, 1);
    assert.ok(page.total >= 2, "the total counts every matching item");
    assert.equal((await searchContentBank({ limit: 5000 }, db)).limit, 100, "the limit is capped");
  } finally {
    await database.close();
  }
});

test("CB2 the bank spans modules without a second store, and its vocabulary comes from the registry", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);

    await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId: ownerId,
        sourceRef: "bank-pack-1",
        slug: "bank-pack",
        labelEn: "Bank pack",
        words: [{ term: "synthesis", partOfSpeech: "noun", definitionEn: "a combination of parts", translationUz: "sintez", example: "A synthesis of both views." }],
        publish: true,
      }),
    );
    const all = await searchContentBank({ q: "bank-" }, db);
    const modules = new Set(all.rows.map((row) => row.module));
    assert.ok(modules.has("vocabulary"), "a vocabulary pack is in the same bank as writing tasks");
    assert.ok(all.rows.every((row) => row.key.includes(row.sourceRef)), "the key is built from identity, not from a title");

    const vocabulary = await contentBankVocabulary(db);
    assert.ok(vocabulary.modules.some((module) => module.module === "lesson"), "the filters are the registry's modules");
    assert.ok(vocabulary.states.includes("archived"));
    assert.ok(vocabulary.tracks.includes("unspecified"), "tracks come from the data");
  } finally {
    await database.close();
  }
});

test("CB3 the bank route is staff-only and never touches a learner read path", () => {
  const route = read("src/app/api/admin/content/bank/route.ts");
  assert.match(route, /isStaff\(user\.role\)/);
  assert.match(route, /status: 403/);
  assert.match(route, /searchContentBank/);
  const bank = read("src/lib/content/bank.ts");
  assert.doesNotMatch(bank, /isLive\(/, "the bank reports states and live-ness from SQL aggregates, it does not re-decide visibility");
  assert.doesNotMatch(bank, /db\.insert|db\.update|db\.delete/, "a bank is a read projection, never a writer");
});
