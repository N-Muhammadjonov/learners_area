import test from "node:test";
import assert from "node:assert/strict";
import { planImportSenseKeys } from "../src/lib/services/vocabulary/import-keys";

test("Reading import preserves both literacy source definitions without a legacy collision", () => {
  const rows = [
    { term: "literacy", partOfSpeech: "noun", definitionEn: "the ability to read and write, or competence in a specific symbolic system" },
    { term: "literacy", partOfSpeech: "noun", definitionEn: "the ability to read and write" },
  ];
  const keys = planImportSenseKeys(rows);
  assert.equal(keys[0]!.legacyKey, keys[1]!.legacyKey);
  assert.notEqual(keys[0]!.senseKey, keys[1]!.senseKey);
  assert.ok(keys.every((k) => k.collisionResolved && k.senseKey.startsWith("v2:")));
  assert.deepEqual(planImportSenseKeys([...rows].reverse()).map((k) => k.senseKey), keys.map((k) => k.senseKey).reverse());
});

test("Reading import retains compatible keys and deduplicates only full equivalent definitions", () => {
  const row = { term: "bank", partOfSpeech: "noun", definitionEn: "a financial institution" };
  const keys = planImportSenseKeys([row, { ...row, definitionEn: "A financial institution." }]);
  assert.equal(keys[0]!.senseKey, keys[0]!.legacyKey);
  assert.equal(keys[0]!.senseKey, keys[1]!.senseKey);
  assert.ok(keys.every((k) => !k.collisionResolved));
});
