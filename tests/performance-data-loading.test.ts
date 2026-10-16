import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import type { db as appDatabase } from "../src/db/client";
import { migrateTestDatabase } from "./support/pglite";
import { senseKeyOf } from "../src/lib/services/vocabulary/dedupe";
import { listeningVocabularySession } from "../src/lib/services/lexical/listening-occurrences";
import type { ListeningPackage } from "../src/lib/listening/package";

test("20 canonical vocabulary entries retain exact contexts/order with one unit SELECT instead of twenty", async () => {
  const client = new PGlite();
  const queries: string[] = [];
  try {
    await migrateTestDatabase(client);
    const db = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } }) as unknown as typeof appDatabase;
    const [author] = await db.insert(schema.users).values({ name: "Performance fixture" }).returning();
    const tests = await db.insert(schema.listeningTests).values([
      { createdByUserId: author!.id, title: "Own context", audioType: "audio" },
      { createdByUserId: author!.id, title: "Other context", audioType: "audio" },
    ]).returning();
    const entries: ListeningPackage["vocabulary"] = Array.from({ length: 20 }, (_, index) => ({
      word: `perfword${index}`, pos: "noun", def: `Fixture meaning ${index}`,
      uz: "package translation must not replace canonical", ex: `Example ${index}`, also: [`Related ${index}`],
    }));
    const units = entries.map(entry => ({ id: randomUUID(), lemma: entry.word, lemmaNorm: entry.word, partOfSpeech: entry.pos, lexicalType: "word" }));
    await db.insert(schema.lexicalUnits).values(units);
    const senses = entries.map((entry, index) => ({
      id: randomUUID(), term: entry.word, partOfSpeech: entry.pos, definitionEn: entry.def,
      senseKey: senseKeyOf({ term: entry.word, partOfSpeech: entry.pos, meaning: entry.def }),
      translationUz: `Canonical ${index}`, lexicalUnitId: units[index]!.id,
    }));
    await db.insert(schema.lexemes).values(senses);
    await db.insert(schema.lexicalUnitPronunciations).values(units.map(unit => ({ lexicalUnitId: unit.id, ipa: "/test/", provenance: "authored" })));
    const firstIds = entries.map(() => randomUUID());
    await db.insert(schema.lexicalOccurrences).values(senses.flatMap((sense, index) => [
      { id: randomUUID(), listeningTestId: tests[0]!.id, lexemeId: sense.id, sourceType: "listening", sectionNumber: 2, startChar: index * 4 + 1, endChar: index * 4 + 2, surfaceForm: sense.term },
      { id: firstIds[index]!, listeningTestId: tests[0]!.id, lexemeId: sense.id, sourceType: "listening", sectionNumber: 1, startChar: index * 4 + 1, endChar: index * 4 + 2, surfaceForm: sense.term },
      { id: randomUUID(), listeningTestId: tests[1]!.id, lexemeId: sense.id, sourceType: "listening", sectionNumber: 1, startChar: index * 4, endChar: index * 4 + 1, surfaceForm: sense.term },
    ]));
    queries.length = 0;
    const session = await listeningVocabularySession(db, tests[0]!.id, entries);
    assert.equal(queries.length, 61, "20 sense + 1 unit + 20 scoped occurrence + 20 original pronunciation reads");
    assert.equal(queries.filter(query => /from "lexical_units"/.test(query)).length, 1);
    assert.equal(session.length, 20);
    for (const [index, item] of session.entries()) {
      assert.equal(item.senseId, senses[index]!.id);
      assert.equal(item.occurrenceId, firstIds[index], "earliest context in this test only");
      assert.equal(item.translationUz, `Canonical ${index}`);
      assert.equal(item.lexicalType, "word");
      assert.equal(item.ipa, "/test/");
      assert.equal(item.example, entries[index]!.ex);
      assert.deepEqual(item.also, entries[index]!.also);
    }
    const duplicates = await listeningVocabularySession(db, tests[0]!.id, [entries[2]!, entries[0]!, { ...entries[2]!, ex: "Separate quiz position", also: ["Different presentation"] }]);
    assert.deepEqual(duplicates.map(item => item.senseId), [senses[2]!.id, senses[0]!.id, senses[2]!.id]);
    assert.equal(duplicates[2]!.example, "Separate quiz position");
    assert.deepEqual(duplicates[2]!.also, ["Different presentation"]);
    queries.length = 0;
    assert.deepEqual(await listeningVocabularySession(db, tests[0]!.id, []), []);
    const fallback = await listeningVocabularySession(db, tests[0]!.id, [{ word: "the", pos: "", def: "Article", uz: "", ex: "The example", also: [] }]);
    assert.equal(queries.length, 0, "empty/function-word sessions make no lexical queries");
    assert.deepEqual(fallback[0], { senseId: null, occurrenceId: null, term: "the", partOfSpeech: null, definitionEn: "Article", translationUz: null, lexicalType: null, ipa: null, example: "The example", also: [], quiz: undefined });
  } finally {
    await client.close();
  }
});
