import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_ATTEMPT_LOCAL_PREFIXES,
  clearListeningAttemptLocalState,
  listeningAttemptLocalKeys,
  type RemovableStorage,
} from "../src/lib/listening/attempt-local-state";
import { readFileSync } from "node:fs";

/**
 * THE END OF AN ATTEMPT'S BROWSER-LOCAL STATE (§16–§17, owner override 2026-10-07).
 *
 * The owner's rule is narrow and testable: while a learner is working, their note and highlights
 * belong to that attempt; when the attempt is FINISHED, that temporary material must not survive
 * as if it were permanent student content. The clearing must be surgical — `localStorage.clear()`
 * would wipe unrelated application state, and another open attempt's note is not ours to delete.
 *
 *   L1  the three key families are the attempt's own, and the attempt id is in every key;
 *   L2  finishing an attempt removes EXACTLY those three keys — an unrelated key, a lookalike key
 *       and a DIFFERENT attempt's keys all survive;
 *   L3  a storage that throws (private mode, quota policy) never breaks the flow — the submission
 *       has already been saved on the server by the time this runs;
 *   L4  no module in the app reaches for `localStorage.clear()`;
 *   L5  the exam's clearing happens AFTER the successful-submit check, and not on the failure path.
 */

function fakeStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const removed: string[] = [];
  const storage: RemovableStorage = {
    removeItem(key: string) {
      removed.push(key);
      store.delete(key);
    },
  };
  return { storage, store, removed };
}

test("L1 the attempt's keys are derived from its id alone", () => {
  const keys = listeningAttemptLocalKeys("attempt-1");
  assert.deepEqual(keys, {
    draft: "la-listening-draft:attempt-1",
    notes: "la-listening-notes:attempt-1",
    highlights: "la-listening-highlights:attempt-1",
  });
  assert.equal(LISTENING_ATTEMPT_LOCAL_PREFIXES.notes, "la-listening-notes", "the note prefix is not a lesson-notes key");
  assert.equal(keys.notes.includes("lesson"), false, "the attempt note is never the lesson's Xulosangiz key");
  // Two attempts never share a key, which is what makes cross-attempt leakage impossible.
  const other = listeningAttemptLocalKeys("attempt-2");
  for (const family of ["draft", "notes", "highlights"] as const) {
    assert.notEqual(keys[family], other[family]);
  }
});

test("L2 finishing an attempt removes exactly its three keys, and nothing else", () => {
  const { storage, store, removed } = fakeStorage({
    "la-listening-draft:attempt-1": "{}",
    "la-listening-notes:attempt-1": "Speaker changes answer after the example.",
    "la-listening-highlights:attempt-1": "{}",
    // A second attempt that is still being worked on.
    "la-listening-draft:attempt-2": "{}",
    "la-listening-notes:attempt-2": "still working here",
    "la-listening-highlights:attempt-2": "{}",
    // Unrelated application state, and lookalike keys that must not be touched.
    "la-locale": "en",
    "la-listening-notes": "not an attempt key",
    "la-listening-notes:attempt-1-extra": "not this attempt's key",
    "la-lesson-notes:lesson-1": "the lesson's own note",
  });

  const cleared = clearListeningAttemptLocalState("attempt-1", storage);

  assert.deepEqual(cleared.sort(), [
    "la-listening-draft:attempt-1",
    "la-listening-highlights:attempt-1",
    "la-listening-notes:attempt-1",
  ]);
  assert.deepEqual(removed.sort(), cleared.sort(), "exactly three removals were attempted");
  assert.equal(store.has("la-listening-notes:attempt-1"), false, "the finished attempt's note is gone");
  assert.equal(store.get("la-listening-notes:attempt-2"), "still working here", "the other open attempt keeps its note");
  assert.equal(store.get("la-listening-draft:attempt-2"), "{}");
  assert.equal(store.get("la-locale"), "en", "unrelated application state is untouched");
  assert.equal(store.get("la-listening-notes"), "not an attempt key", "a lookalike key is not touched");
  assert.equal(store.get("la-listening-notes:attempt-1-extra"), "not this attempt's key");
  assert.equal(store.get("la-lesson-notes:lesson-1"), "the lesson's own note", "Xulosangiz is never touched by this code path");
});

test("L3 a storage that refuses to forget never breaks the flow", () => {
  const throwing: RemovableStorage = {
    removeItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.deepEqual(clearListeningAttemptLocalState("attempt-1", throwing).length, 0, "the failure is swallowed, not propagated");
  assert.deepEqual(clearListeningAttemptLocalState("attempt-1", null), [], "an absent storage is not an error");
});

test("L4 no module CALLS the whole-store clear (comments are not calls)", () => {
  /*
   * The guard has to read CODE, not prose: the comment above the lifecycle boundary names
   * `localStorage.clear()` precisely in order to forbid it, and a naive substring match would
   * flag the sentence that documents the rule. Comments are stripped first, so this fails only
   * on a real call.
   */
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const file of ["src/components/listening/NativeListeningExam.tsx", "src/lib/listening/attempt-local-state.ts"]) {
    const source = readFileSync(file, "utf8");
    const code = withoutComments(source);
    assert.match(code, /clearListeningAttemptLocalState/, `${file} still performs the scoped cleanup`);
    assert.doesNotMatch(code, /localStorage\.clear\s*\(/, `${file} must never clear the whole store`);
    assert.doesNotMatch(code, /sessionStorage\.clear\s*\(/, `${file} must never clear the whole store`);
  }
});

test("L5 the exam clears AFTER a confirmed submit, and never on the failure path", () => {
  const source = readFileSync("src/components/listening/NativeListeningExam.tsx", "utf8");
  const submitBody = source.slice(source.indexOf("async function submit()"));
  const okCheck = submitBody.indexOf("if (!res.ok) throw new Error();");
  const clear = submitBody.indexOf("clearListeningAttemptLocalState(attemptId)");
  const catchBlock = submitBody.indexOf("} catch {");
  assert.ok(okCheck > -1, "the successful-submit check is present");
  assert.ok(clear > -1, "the attempt's local state is cleared");
  assert.ok(clear > okCheck, "clearing happens only after the server confirmed the submission");
  assert.ok(catchBlock > clear, "the failure path (catch) comes after the success path, so a failed submit keeps every key");
  // And the keys are read through the one owner rather than spelled out again here.
  assert.doesNotMatch(source, /`la-listening-(notes|highlights|draft):\$\{attemptId\}`/, "the exam does not re-spell the key names");
});
