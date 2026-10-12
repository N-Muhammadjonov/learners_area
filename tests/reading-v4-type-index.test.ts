import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { readingPassages, readingQuestions } from "../src/db/schema";
import { readingTypeFacets, readingTypePassages } from "../src/lib/data/reading-type-index";

test("READ-TYPE-INDEX actual SQL: published material, canonical-first aliases, no duplicate cards, bounded pages", async () => {
  const env = await createTestDatabase();
  try {
    const ids = (await env.db.insert(readingPassages).values(Array.from({ length: 27 }, (_, i) => ({ title: `Fixture ${i}`, bodyText: "Only QA text", publicationState: i === 26 ? "draft" as const : "published" as const }))).returning()).map(p => p.id);
    await env.db.insert(readingQuestions).values(ids.flatMap((passageId, i) => [1,2].map(order => ({ passageId, order, type:"multiple_choice" as const, typeCode: i%2 ? "MH" : "matching_headings", questionText:"Match", correctAnswer:"A", explanation:"Authored" }))));
    const facets = await readingTypeFacets(env.db);
    assert.equal(facets.find(t => t.id === "matching_headings")?.count,26);
    assert.ok(!facets.some(t => t.id === "MH"));
    assert.equal((await readingTypePassages("MH",1,env.db)).length,0,"aliases are not canonical filter IDs");
    const first = await readingTypePassages("matching_headings",1,env.db);
    assert.equal(first.length,25,"24 cards plus next-page sentinel");
    assert.equal(new Set(first.map(p => p.id)).size,25);
    assert.ok(!first.some(p => p.id === ids[26]));
    assert.equal((await readingTypePassages("matching_headings",2,env.db)).length,2);
    assert.equal((await readingTypePassages("multiple_choice",1,env.db)).length,0,"storage enum/options do not override the canonical matching type");
  } finally { await env.close(); }
});
