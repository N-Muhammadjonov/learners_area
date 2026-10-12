import test from "node:test";
import assert from "node:assert/strict";
import { replayTypingAccuracy, BACKSPACE, DELETE_WORD } from "../src/lib/services/writing/typing-keystrokes";

test("perfect input includes correct separators and has 100% accuracy", () => {
  assert.deepEqual(replayTypingAccuracy(["one", "two"], ["one", "two"], [..."one two"], 0), {accuracy: 100, mistakes: 0});
});
test("correcting a wrong letter does not erase the mistake from accuracy", () => {
  assert.deepEqual(replayTypingAccuracy(["one"], ["one"], [..."onx", BACKSPACE, "e"], 0), {accuracy: 75, mistakes: 1});
});
test("reopening a wrong word and correcting it keeps both wrong attempts", () => {
  assert.deepEqual(replayTypingAccuracy(["one", "two"], ["one", "t"], [..."onx ", BACKSPACE, BACKSPACE, ..."e t"], 0), {accuracy: 71.4, mistakes: 2});
});
test("Backspace and word deletion are not scored attempts", () => {
  assert.deepEqual(replayTypingAccuracy(["one"], ["one"], [..."on", DELETE_WORD, ..."one"], 0), {accuracy: 100, mistakes: 0});
});
test("skipped characters count once in the accuracy denominator", () => {
  assert.deepEqual(replayTypingAccuracy(["one", "two"], ["on", "t"], [..."on t"], 1), {accuracy: 60, mistakes: 2});
});
test("a log inconsistent with submitted words is rejected", () => {
  assert.equal(replayTypingAccuracy(["one"], ["one"], [..."onx"], 0), null);
  assert.equal(replayTypingAccuracy(["one"], ["one"], ["\n", ..."one"], 0), null);
});
