import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSpeakingWithRiwi } from "../src/lib/services/coach/providers/riwi/speaking";
import { speakingEvaluationRequest } from "../src/lib/services/coach/speaking";

// Reproduced in a real browser: a 17-word TYPED transcript attached to a 4-second recording was scored as 268 words per minute.
const transcript = "I usually spend my weekends with my family and we often cook together at home because it is relaxing.";
const base = { part: "part1" as const, promptText: "What do you do at weekends?", transcript, durationMs: 4247, language: "en" as const, pronunciationAvailable: false };
const text = (output: unknown) => JSON.stringify(output);

test("a typed transcript never produces a speaking-rate claim or penalty from the recording length", () => {
  for (const transcriptOrigin of ["manual", null] as const) {
    const output = evaluateSpeakingWithRiwi({ ...base, transcriptOrigin });
    assert.doesNotMatch(text(output), /words per minute|wpm/i, `${transcriptOrigin}: no rate claimed`);
    assert.match(text(output), transcriptOrigin === "manual" ? /typed, not transcribed from the recording/ : /source is unverified/);
  }
});

test("a transcribed answer still gets a measured rate", () => {
  for (const transcriptOrigin of ["stt", "browser_stt"] as const) {
    assert.match(text(evaluateSpeakingWithRiwi({ ...base, transcriptOrigin })), /words per minute/i, transcriptOrigin);
  }
});

test("typed transcripts are not scored lower than before for lacking timing", () => {
  const typed = evaluateSpeakingWithRiwi({ ...base, durationMs: null, transcriptOrigin: "manual" });
  const typedWithDuration = evaluateSpeakingWithRiwi({ ...base, transcriptOrigin: "manual" });
  assert.equal(text(typed.criteria), text(typedWithDuration.criteria), "recording length cannot change a typed transcript's criteria");
  assert.equal(typed.confidence, typedWithDuration.confidence, "recording length is not timing evidence for typed text");
});

test("edited recognition text cannot borrow recording timing for a rate claim", () => {
  for (const transcriptOrigin of ["stt", "browser_stt"] as const) {
    const request = speakingEvaluationRequest({ ...base, userId: "fixture", attemptId: "fixture", transcriptOrigin, transcriptEdited: true });
    assert.equal(request.input.durationMs, null);
    assert.doesNotMatch(text(evaluateSpeakingWithRiwi(request.input)), /words per minute|wpm/i);
    const unchanged = speakingEvaluationRequest({ ...base, userId: "fixture", attemptId: "fixture", transcriptOrigin, transcriptEdited: false });
    assert.equal(unchanged.input.durationMs, base.durationMs);
    assert.match(text(evaluateSpeakingWithRiwi(unchanged.input)), /words per minute/i);
  }
});
