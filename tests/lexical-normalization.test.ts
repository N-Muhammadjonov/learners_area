import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMeaning, normalizePartOfSpeech, senseKeyOf } from "../src/lib/services/vocabulary/dedupe";

const key = (meaning: string, partOfSpeech = "noun") => senseKeyOf({ term: "charge", meaning, partOfSpeech });
test("meaning normalization includes parenthetical sense distinctions and collapses whitespace", () => {
  assert.notEqual(key("an amount (of money owed)"), key("an amount (of electricity stored)"));
  assert.equal(key("an amount of money"), key("  An   amount\nof money.  "));
  assert.equal(normalizeMeaning("One; two (related senses)."), "one; two (related senses)");
});
test("long definitions and meaningful POS distinctions do not collide", () => {
  const prefix = "Shared explanatory context ".repeat(12);
  assert.notEqual(key(prefix + "money"), key(prefix + "electricity"));
  assert.notEqual(key("a description", "noun"), key("a description", "noun phrase"));
  assert.notEqual(key("a description", "verb"), key("a description", "v.phrase"));
  assert.equal(normalizePartOfSpeech("(noun)"), "noun");
  assert.equal(normalizePartOfSpeech("n."), "noun");
  assert.ok(key(prefix).length <= 200);
});
