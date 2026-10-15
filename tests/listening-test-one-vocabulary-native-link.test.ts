import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listeningTestOnePackage } from "../scripts/listening-test-one-package";
import { senseKeyOf } from "../src/lib/services/vocabulary/dedupe";
import { findUnitSpans } from "../src/lib/services/lexical/listening-occurrences";
import { formsOf } from "../src/lib/services/lexical/forms";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Test 1 converts its 20 authentic authored vocabulary senses into the canonical Listening package", () => {
  const { manifest, canonical, stored } = listeningTestOnePackage();
  assert.equal(manifest.id, "listening-test-1");
  assert.equal(stored.testId, "listening-test-1");
  assert.equal(canonical.content.collection, "academic");
  assert.equal(stored.vocabulary.length, 20);
  assert.equal(canonical.content.vocabulary.length, 20);
  assert.equal(stored.sections.length, 4);
  assert.equal(stored.questions.length, 40);
  const keys = new Set<string>();
  for (const item of stored.vocabulary) {
    assert.ok(item.word.trim() && item.def.trim() && item.uz.trim() && item.ex.trim());
    const key = senseKeyOf({ term: item.word, partOfSpeech: item.pos, meaning: item.def });
    assert.ok(!keys.has(key), `duplicate authored sense: ${item.word}`);
    keys.add(key);
  }
  assert.equal(keys.size, 20);
  // Examples and senses come from authored source, never an invented dictionary.
  const raw = JSON.parse(read("content/listening/academic/test-01/data.json"));
  assert.deepEqual(stored.vocabulary.map(x => x.word), raw.vocabulary.map((v: { headword: string }) => v.headword));
});

test("Test 1 spans are extracted only from actual authored Listening transcripts", () => {
  const { stored } = listeningTestOnePackage();
  const candidates = stored.vocabulary.map(x => ({
    key: senseKeyOf({ term: x.word, partOfSpeech: x.pos, meaning: x.def }),
    forms: formsOf(x.word, x.pos).map(form => form.form),
  }));
  const spans = stored.sections.flatMap(section => findUnitSpans(section.transcript, candidates));
  assert.ok(spans.length > 0, "Authentic authored vocabulary must map to real transcript tokens");
  for (const span of spans) {
    assert.ok(span.end > span.start);
    assert.ok(span.surface.length > 0);
    assert.ok(span.keys.length >= 1);
  }
});

test("Test 1 uses the ONE vocabulary architecture rather than a separate per-test library", () => {
  const importer = read("src/lib/import/listening/importer.ts");
  const ingestion = read("src/lib/services/lexical/listening-occurrences.ts");
  const activity = read("src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx");
  const save = read("src/app/api/vocabulary/route.ts");
  const engine = read("src/lib/services/vocabulary/engine.ts");
  const install = read("scripts/install-listening-test-one.ts");
  assert.match(install, /importCanonicalListeningPackage\(tx, canonical/);
  assert.match(importer, /ingestListeningOccurrences\(tx, test\.id, payload\)/);
  assert.match(ingestion, /tx\.insert\(lexemes\)/);
  assert.match(ingestion, /tx\.insert\(lexicalOccurrences\)/);
  assert.match(activity, /listeningVocabularySession\(db, id/);
  assert.match(save, /sessionSenseId/);
  assert.match(save, /addVocabularyBatch/);
  assert.match(engine, /input\.sourceType === "listening"/);
  assert.match(engine, /sourceSnapshot: item\.sourceSnapshot/);
});

test("versioned Listening reimport preserves old recordings and authorizes the new private R2 key", () => {
  const importer = read("src/lib/import/listening/importer.ts");
  assert.match(importer, /const knownKeys = new Set\(blocks\.map\(block => block\.objectKey\)/);
  assert.match(importer, /const missingAssets = options\.assets\.filter\(asset => !knownKeys\.has\(asset\.objectKey\)\)/);
  assert.match(importer, /await tx\.insert\(resourceBlocks\)\.values\(missingAssets\.map/);
  assert.match(importer, /position: nextPosition\+\+/);
  assert.doesNotMatch(importer, /delete\(resourceBlocks\)/,
    "historical Listening versions must keep their former private audio access");
});

test("Manual Listening vocabulary cannot bypass active exam or forge a source ID", () => {
  const save = read("src/app/api/vocabulary/route.ts");
  const marker = save.indexOf("if (parsed.data.sourceType === \"listening\")", save.indexOf("if (parsed.data.occurrenceId)"));
  const branch = save.slice(marker, marker + 950);
  assert.ok(marker >= 0);
  assert.match(branch, /fullListeningDetail\(parsed\.data\.sourceId, user\.role\)/);
  assert.match(branch, /lexicalAssistanceAllowed\("VOCABULARY_STUDY"/);
  assert.match(branch, /listeningExamState\(user, parsed\.data\.sourceId\)/);
});

test("The Test 1 installer never imports before verifying exact private R2 bytes and owner", () => {
  const source = read("scripts/install-listening-test-one.ts");
  assert.match(source, /STORAGE_PROVIDER=r2/);
  assert.match(source, /eq\(users\.role, "owner"\)/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /getStorageService\(\)/);
  assert.match(source, /acknowledgeGradeImpact: false/);
  assert.match(source, /if \(!apply\)/);
});
