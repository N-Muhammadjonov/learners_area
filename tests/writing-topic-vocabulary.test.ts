import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { users, writingLanguagePatterns, lexemes, userVocabulary } from "../src/db/schema";
import { saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { topicVocabulary, setPatternSaved } from "../src/lib/services/writing/topic-vocabulary";
import { TOPIC_PACKS } from "../src/lib/services/vocabulary/packs";

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `v${Math.random()}@example.test`, name: "V", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const base = { provenance: "Learners Area QA", example: "Example sentence." };
  const rows = await t.db.insert(writingLanguagePatterns).values([
    { ...base, pattern: "rose sharply to", function: "trend", taskType: "task1", topic: "Energy", publicationState: "published" },
    { ...base, pattern: "While it is true that X, Y", function: "concession", taskType: "task2", topic: "Education", publicationState: "published" },
    { ...base, pattern: "DRAFT-ONLY", function: "argument", taskType: "task2", publicationState: "draft" },
  ] as (typeof writingLanguagePatterns.$inferInsert)[]).returning();
  return { t, db: t.db as never, userId: u!.id, rows };
}

test("Topic vocabulary: only published patterns, filtered by task / function / topic", async () => {
  const { t, db, userId } = await setup();
  try {
    const all = await topicVocabulary(userId, {}, db);
    assert.ok(!all.patterns.some((p) => p.pattern === "DRAFT-ONLY"));
    assert.equal(all.patterns.length, 2);
    assert.ok(all.topics.some((x) => x.id === "energy") && all.topics.some((x) => x.id === TOPIC_PACKS[0]!.id));
    assert.deepEqual((await topicVocabulary(userId, { task: "task1" }, db)).patterns.map((p) => p.pattern), ["rose sharply to"]);
    assert.deepEqual((await topicVocabulary(userId, { fn: "concession" }, db)).patterns.map((p) => p.fn), ["concession"]);
    const byTopic = await topicVocabulary(userId, { topic: "education" }, db);
    assert.deepEqual(byTopic.patterns.map((p) => p.topic), ["Education"]);
    assert.equal(byTopic.words.length, 0, "no pack is called education");
    const pack = await topicVocabulary(userId, { topic: TOPIC_PACKS[0]!.id }, db);
    assert.equal(pack.words.length, TOPIC_PACKS[0]!.words.length);
  } finally { await t.close(); }
});

test("Saved state comes from the learner's real user_vocabulary and pattern bank", async () => {
  const { t, db, userId, rows } = await setup();
  try {
    const w = TOPIC_PACKS[0]!.words[0]!;
    const [lx] = await t.db.insert(lexemes).values({ term: w.term, partOfSpeech: w.partOfSpeech, definitionEn: w.definitionEn } as typeof lexemes.$inferInsert).returning();
    await t.db.insert(userVocabulary).values({ userId, lexemeId: lx!.id } as typeof userVocabulary.$inferInsert);
    assert.equal(await setPatternSaved(userId, rows[0]!.id, true, db), true);
    assert.equal(await setPatternSaved(userId, rows[0]!.id, true, db), true, "idempotent");
    assert.equal(await setPatternSaved(userId, rows[2]!.id, true, db), false, "drafts cannot be saved");
    const v = await topicVocabulary(userId, {}, db);
    assert.equal(v.words.find((x) => x.term === w.term)!.saved, true);
    assert.equal(v.words.find((x) => x.term !== w.term)!.saved, false);
    assert.equal(v.patterns.find((p) => p.id === rows[0]!.id)!.saved, true);
    await setPatternSaved(userId, rows[0]!.id, false, db);
    assert.equal((await topicVocabulary(userId, {}, db)).patterns.find((p) => p.id === rows[0]!.id)!.saved, false);
  } finally { await t.close(); }
});

test("No Writing-only lexical store: saving uses the canonical /api/vocabulary engine", () => {
  for (const f of readdirSync("drizzle").filter((x) => x.endsWith(".sql"))) {
    assert.doesNotMatch(readFileSync(`drizzle/${f}`, "utf8"), /CREATE TABLE writing_(words|vocab)/);
  }
  const btn = readFileSync("src/components/writing/topic/SaveButtons.tsx", "utf8");
  assert.match(btn, /request<[\s\S]*?>\("\/api\/vocabulary"/);
  const tab = readFileSync("src/components/writing/topic/WritingTopicVocabularyTab.tsx", "utf8");
  assert.match(tab, /tab=activation&item=/, "Activate in Writing opens Activation Lab with the item");
  const page = readFileSync("src/app/(app)/writing/page.tsx", "utf8");
  assert.match(page, /tab === "topic-vocabulary" \?[\s\S]*WritingTopicVocabularyTab/);
});

test("Writing topic vocabulary is canonical: a published pack is the source, built-ins are the fallback", async () => {
  const t = await createTestDatabase();
  try {
    const db = t.db as never;
    const [u] = await t.db.insert(users).values({ email: `v${Math.random()}@example.test`, name: "V", passwordHash: "x" } as typeof users.$inferInsert).returning();
    const [ownerRow] = await t.query<{ id: string }>(`insert into users (name, role) values ('Pack owner', 'owner') returning id`);

    // Nothing published yet: exactly the built-ins, i.e. the previous behaviour.
    const before = await topicVocabulary(u!.id, {}, db);
    assert.ok(before.words.some((w) => w.packId === TOPIC_PACKS[0]!.id), "built-in packs are the compatibility fallback");

    // A draft pack changes nothing a learner sees.
    await t.db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId: ownerRow!.id,
        sourceRef: "pack-cohesion-draft",
        slug: "cohesion-draft",
        labelEn: "Cohesion (draft)",
        words: [{ term: "notyet", partOfSpeech: "noun", definitionEn: "a draft-only word", translationUz: "-", example: "Draft." }],
      }),
    );
    assert.ok(!(await topicVocabulary(u!.id, {}, db)).words.some((w) => w.term === "notyet"), "a draft pack is invisible");

    // A published pack wins over the built-in list, and its word IS a canonical sense.
    await t.db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId: ownerRow!.id,
        sourceRef: "pack-cohesion",
        slug: "cohesion",
        labelEn: "Cohesion",
        labelUz: "Bog'lovchilar",
        words: [{ term: "nonetheless", partOfSpeech: "adverb", definitionEn: "in spite of that", translationUz: "shunga qaramay", example: "Nonetheless, the trend continued." }],
        publish: true,
      }),
    );
    const after = await topicVocabulary(u!.id, {}, db);
    assert.ok(after.words.some((w) => w.term === "nonetheless" && w.packId === "cohesion"), "the authored pack is shown");
    assert.ok(after.topics.some((topic) => topic.id === "cohesion"), "and it contributes a topic");
    assert.ok(!after.words.some((w) => w.packId === TOPIC_PACKS[0]!.id), "once a pack is published the database is the source of truth");
    const only = await topicVocabulary(u!.id, { topic: "cohesion" }, db);
    assert.equal(only.words.length, 1);
    assert.equal(await t.query(`select count(*)::int as n from writing_words`, []).then((rows) => (rows[0] as { n: number }).n).catch(() => 0), 0, "no writing-local word table exists");
  } finally {
    await t.close();
  }
});
