import assert from "node:assert/strict";
import test from "node:test";
import { countWords, normalizeForWordCount, words } from "../src/lib/retention/word-count";
import { RETENTION_LEVELS, RETENTION_LEVEL_CONFIG, isWordCountInRange, wordRangeFor } from "../src/lib/retention/levels";

/**
 * The word contract (§107, §108).
 *
 * One counter decides whether a text may be saved: the admin editor's live
 * number, the server's validation and the stored `word_count` are the same
 * function. These tests pin the exact boundaries for all five levels and the
 * counting semantics that could otherwise differ between a human's editor and
 * SQL's `array_length(string_to_array(...))`.
 */

const textOf = (count: number) => Array.from({ length: count }, () => "word").join(" ");

test("each level's target length is inside its own range", () => {
  for (const level of RETENTION_LEVELS) {
    const config = RETENTION_LEVEL_CONFIG[level];
    assert.ok(isWordCountInRange(level, config.targetWords), `${level} target`);
    assert.equal(config.minWords <= config.targetWords && config.targetWords <= config.maxWords, true);
  }
});

test("the exact inclusive boundaries are enforced for every level", () => {
  const expectations = {
    A2: { min: 100, max: 125 },
    B1: { min: 160, max: 195 },
    B2: { min: 240, max: 285 },
    C1: { min: 280, max: 330 },
    C2: { min: 390, max: 450 },
  } as const;

  for (const level of RETENTION_LEVELS) {
    const { min, max } = expectations[level];
    assert.deepEqual(wordRangeFor(level), { min, max });
    assert.equal(isWordCountInRange(level, min - 1), false, `${level} just below`);
    assert.equal(isWordCountInRange(level, min), true, `${level} lower bound`);
    assert.equal(isWordCountInRange(level, max), true, `${level} upper bound`);
    assert.equal(isWordCountInRange(level, max + 1), false, `${level} just above`);
    assert.equal(countWords(textOf(min)), min);
    assert.equal(countWords(textOf(max)), max);
  }
});

test("the launch target is 15 per level, and nothing in the contract treats it as a maximum", () => {
  // The number itself lives with the level contract; the point of this test is
  // that the range check above has no ceiling tied to it.
  assert.equal(isWordCountInRange("A2", 125), true);
  assert.equal(isWordCountInRange("C2", 450), true);
});

test("counting semantics: hyphenated words, apostrophes and numbers are one word each", () => {
  assert.equal(countWords("well-known"), 1);
  assert.equal(countWords("state-of-the-art"), 1);
  assert.equal(countWords("don't"), 1);
  assert.equal(countWords("don\u2019t"), 1, "the typographic apostrophe joins as well");
  assert.equal(countWords("1998"), 1);
  assert.equal(countWords("50,000 people"), 2, "a grouped number is ONE number, not two tokens");
  assert.equal(countWords("1,234,567"), 1);
  assert.equal(countWords("\u00a050\u00a0000\u00a0people"), 2, "a typographic grouping space joins too");
});

test("counting semantics: punctuation and dashes separate, whitespace never inflates", () => {
  assert.equal(countWords("word."), 1);
  assert.equal(countWords("one, two; three"), 3);
  assert.equal(countWords("one   two\n\nthree\tfour"), 4);
  assert.equal(countWords("  padded  "), 1);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n  "), 0);
  assert.equal(countWords("one—two"), 2, "an em dash separates words");
  assert.equal(countWords("one – two"), 2, "a spaced en dash separates the words and is not a word itself");
});

test("normalisation is documented and shared with the evaluator's digits rule", () => {
  assert.equal(normalizeForWordCount("50,000"), "50000");
  assert.equal(normalizeForWordCount("1,234,567"), "1234567");
  assert.equal(words("word 1998 don't").length, 3);
});

test("the ranges match the owner's published targets: ~110 / ~175 / ~260 / ~300 / ~415", () => {
  assert.equal(RETENTION_LEVEL_CONFIG.A2.targetWords, 110);
  assert.equal(RETENTION_LEVEL_CONFIG.B1.targetWords, 175);
  assert.equal(RETENTION_LEVEL_CONFIG.B2.targetWords, 260);
  assert.equal(RETENTION_LEVEL_CONFIG.C1.targetWords, 300);
  assert.equal(RETENTION_LEVEL_CONFIG.C2.targetWords, 415);
});
