import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey } from "../src/lib/uploads/keys";
import {
  createAttemptSchema,
  listPromptsQuerySchema,
  submitAttemptSchema,
} from "../src/lib/validation/speaking-practice";
import { extensionForMime, pickMimeType, formatDuration } from "../src/lib/audio/recorder";

/**
 * Speaking practice: object-key scoping, the request schemas, and the recorder
 * helpers the PracticeStudio relies on.
 */
test("a practice recording is namespaced under its attempt", () => {
  const key = buildObjectKey({
    speakingAttemptId: "11111111-1111-1111-1111-111111111111",
    intentId: "33333333-3333-3333-3333-333333333333",
    category: "audio",
    filename: "my answer.webm",
  });

  assert.match(key, /^speaking\/attempts\/11111111-1111-1111-1111-111111111111\/audio\/[0-9a-f-]{36}\.webm$/);
  // The original name is display metadata only and must never reach the key.
  assert.doesNotMatch(key, /answer/);
});

test("a practice recording cannot borrow another attempt's scope", () => {
  const key = buildObjectKey({
    intentId: "44444444-4444-4444-4444-444444444444",
    category: "audio",
    filename: "answer.webm",
  });

  // Without an attempt id there is no attempt to file the recording under, so
  // the key must not silently land in another namespace.
  assert.doesNotMatch(key, /^speaking\//);
});

test("a traversal filename cannot escape the attempt scope", () => {
  const key = buildObjectKey({
    speakingAttemptId: "22222222-2222-2222-2222-222222222222",
    intentId: "55555555-5555-5555-5555-555555555555",
    category: "audio",
    filename: "../../etc/passwd.webm",
  });

  assert.match(key, /^speaking\/attempts\/22222222-2222-2222-2222-222222222222\/audio\/[0-9a-f-]{36}\.webm$/);
});

test("a practice recording cannot borrow another attempt's scope", () => {
  const key = buildObjectKey({
    intentId: "44444444-4444-4444-4444-444444444444",
    category: "audio",
    filename: "answer.webm",
  });

  // Without an attempt id there is no attempt to file the recording under, so
  // the key must not silently land in another namespace.
  assert.doesNotMatch(key, /^speaking\//);
});

test("a traversal filename cannot escape the attempt scope", () => {
  const key = buildObjectKey({
    speakingAttemptId: "22222222-2222-2222-2222-222222222222",
    intentId: "55555555-5555-5555-5555-555555555555",
    category: "audio",
    filename: "../../etc/passwd.webm",
  });

  assert.match(key, /^speaking\/attempts\/22222222-2222-2222-2222-222222222222\/audio\/[0-9a-f-]{36}\.webm$/);
});

test("attempt creation requires a valid part and an optional prompt", () => {
  const parsed = createAttemptSchema.parse({
    part: "part2",
    promptId: "3f6b0c1e-6d2a-4f8b-9c31-1a2b3c4d5e6f",
  });
  assert.equal(parsed.part, "part2");

  assert.throws(() => createAttemptSchema.parse({ part: "part9" }));
  // An unknown prompt is rejected before it can become a dangling reference.
  assert.throws(() => createAttemptSchema.parse({ part: "part1", promptId: "not-a-uuid" }));
});

test("prompt filtering is optional and restricted to real parts", () => {
  assert.deepEqual(listPromptsQuerySchema.parse({}), {});
  assert.equal(listPromptsQuerySchema.parse({ part: "part3" }).part, "part3");
  assert.throws(() => listPromptsQuerySchema.parse({ part: "part9" }));
});

test("submitting an attempt only carries optional review metadata", () => {
  assert.deepEqual(submitAttemptSchema.parse({}), {});
  assert.equal(submitAttemptSchema.parse({ durationMs: 61000 }).durationMs, 61000);
  // A transcript must never be accepted from the browser: there is no
  // transcription provider, so the field would be fabricated data.
  assert.throws(() => submitAttemptSchema.parse({ transcript: "I said some things" }));
});

test("recording codecs map to the extension the file will actually have", () => {
  assert.equal(extensionForMime("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionForMime("audio/mp4"), "m4a");
  assert.equal(extensionForMime("audio/mpeg"), "mp3");
  // An unknown container falls back to the browser's default, never to an
  // empty extension that would produce a key without one.
  assert.equal(extensionForMime("audio/x-unknown"), "webm");
  assert.equal(extensionForMime("audio/ogg"), "ogg");
  assert.equal(extensionForMime(""), "webm");

  // Codec negotiation reads the real browser API, which does not exist in Node.
  assert.equal(pickMimeType(), null);
});

test("recording duration is shown as minutes and seconds", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(4200), "0:04");
  assert.equal(formatDuration(61000), "1:01");
  // Never reports a negative duration if the clock jumps backwards.
  assert.equal(formatDuration(-5), "0:00");
});
