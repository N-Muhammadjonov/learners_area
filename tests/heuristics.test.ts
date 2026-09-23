import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countWords,
  splitSentences,
  splitParagraphs,
  averageSentenceLength,
  lexicalDiversity,
  linkingWordCount,
  toBand,
} from "../src/lib/services/writing-evaluation/heuristics";

test("countWords: empty and whitespace-only text is zero words", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n  "), 0);
});

test("countWords: counts whitespace-separated tokens", () => {
  assert.equal(countWords("This is four words"), 4);
});

test("splitSentences: splits on terminal punctuation", () => {
  const out = splitSentences("First sentence. Second one! Third?");
  assert.equal(out.length, 3);
  assert.equal(out[0], "First sentence.");
});

test("splitParagraphs: splits on blank lines only", () => {
  const out = splitParagraphs("Para one line one.\nStill para one.\n\nPara two.");
  assert.equal(out.length, 2);
});

test("averageSentenceLength: empty text is zero, not NaN", () => {
  assert.equal(averageSentenceLength(""), 0);
});

test("averageSentenceLength: computes a sane average", () => {
  // "One two three." (3) + "Four five." (2) => 2.5 average
  assert.equal(averageSentenceLength("One two three. Four five."), 2.5);
});

test("lexicalDiversity: all-unique text is close to 1", () => {
  assert.equal(lexicalDiversity("alpha beta gamma delta"), 1);
});

test("lexicalDiversity: heavy repetition scores low", () => {
  const score = lexicalDiversity("the the the the cat the the the");
  assert.ok(score < 0.4, `expected low diversity, got ${score}`);
});

test("linkingWordCount: counts distinct linking devices used", () => {
  assert.equal(linkingWordCount("However, this matters. In contrast, that does not."), 2);
});

test("linkingWordCount: zero when none are present", () => {
  assert.equal(linkingWordCount("Cats are small animals that sleep a lot."), 0);
});

test("toBand: clamps into the 4.0-9.0 IELTS range", () => {
  assert.equal(toBand(2), 4);
  assert.equal(toBand(11), 9);
});

test("toBand: rounds to the nearest half band", () => {
  assert.equal(toBand(6.24), 6);
  assert.equal(toBand(6.26), 6.5);
});
