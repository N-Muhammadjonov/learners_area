import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { users, writingLanguagePatterns, lexemes, userVocabulary } from "../src/db/schema";
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
  assert.match(btn, /fetch\("\/api\/vocabulary"/);
  const tab = readFileSync("src/components/writing/topic/WritingTopicVocabularyTab.tsx", "utf8");
  assert.match(tab, /tab=activation&item=/, "Activate in Writing opens Activation Lab with the item");
  const page = readFileSync("src/app/(app)/writing/page.tsx", "utf8");
  assert.match(page, /tab === "topic-vocabulary" \?[\s\S]*WritingTopicVocabularyTab/);
});
