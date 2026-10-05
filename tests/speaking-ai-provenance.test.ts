import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSCRIPT_LENGTH,
  resolveBrowserTranscript,
  transcriptComparisonKey,
} from "../src/lib/speaking/browser-transcript";
import {
  INTERNAL_ONLY_EVALUATION_FIELDS,
  toLearnerEvaluation,
} from "../src/lib/services/coach/public-evaluation";
import { PUBLIC_CHECKED_BY } from "../src/lib/services/coach/attribution";
import {
  completeAiSessionItemSchema,
  completeAiSessionSchema,
  createAiSessionSchema,
  listAiSessionsQuerySchema,
  sessionModeSchema,
  skipAiSessionItemSchema,
} from "../src/lib/validation/speaking-ai";
import { submitAttemptSchema } from "../src/lib/validation/speaking-practice";
import { SESSION_PLAN_MODES } from "../src/lib/speaking/ai-session-plan";
import type { EvaluationRecord } from "../src/lib/data/evaluations";

/**
 * Provenance and trust-boundary tests (spec §20–§22, §43, §13–§14).
 *
 * These assert the rules the feature's honesty depends on, using sentinel values
 * so a leak cannot hide behind a plausible-looking string:
 *   - the learner projection never carries provider/model identity
 *   - "the learner edited this" is derived, never accepted
 *   - strict schemas reject every client-asserted authority field
 */

// ---------------------------------------------------------------------------
// browser transcript resolution
// ---------------------------------------------------------------------------

test("an unreviewed transcript is stored verbatim and marked NOT edited", () => {
  const resolved = resolveBrowserTranscript({
    raw: "I work in a bank and I like it.",
    final: "I work in a bank and I like it.",
  });
  assert.ok(resolved);
  assert.equal(resolved.edited, false);
  assert.equal(resolved.transcript, "I work in a bank and I like it.");
  assert.equal(resolved.raw, "I work in a bank and I like it.");
});

test("a corrected word is reported as edited", () => {
  const resolved = resolveBrowserTranscript({
    raw: "I work in a bank and I like it.",
    final: "I work in a bank and I liked it.",
  });
  assert.equal(resolved?.edited, true, "a real wording change must be recorded");
});

test("punctuation and capitalisation fixes count as edits — they are not silently normalized away", () => {
  assert.equal(resolveBrowserTranscript({ raw: "i work here", final: "I work here." })?.edited, true);
  assert.equal(resolveBrowserTranscript({ raw: "what do you do", final: "What do you do?" })?.edited, true);
});

test("whitespace-only differences are NOT edits", () => {
  // Otherwise a trailing space from the review box would falsely label every
  // transcript as learner-edited, which would unfairly discount the evidence.
  assert.equal(resolveBrowserTranscript({ raw: "  I work here.  ", final: "I work here." })?.edited, false);
  assert.equal(resolveBrowserTranscript({ raw: "I  work\there.", final: "I work here." })?.edited, false);
  assert.equal(transcriptComparisonKey("  a \t b \n"), "a b");
});

test("an empty or whitespace-only final transcript resolves to null so a real STT provider can still run", () => {
  assert.equal(resolveBrowserTranscript({ raw: "something", final: "" }), null);
  assert.equal(resolveBrowserTranscript({ raw: "something", final: "   \n\t " }), null);
  assert.equal(resolveBrowserTranscript({}), null);
});

test("a transcript sent with no raw counterpart is treated as edited", () => {
  // The learner typed or wholly replaced it: there is no recognition output to
  // compare against, so claiming "unedited browser output" would be false.
  const resolved = resolveBrowserTranscript({ final: "My own words." });
  assert.equal(resolved?.edited, true);
  assert.equal(resolved?.raw, "");
  assert.equal(resolved?.transcript, "My own words.");
});

test("non-string input is ignored rather than coerced", () => {
  assert.equal(resolveBrowserTranscript({ raw: 123, final: { evil: true } as never }), null);
  assert.equal(resolveBrowserTranscript({ raw: null, final: undefined }), null);
});

test("a short but real answer is accepted", () => {
  // The manual-transcript path needs 10 characters to filter junk typed into an
  // optional box. This one was reviewed and deliberately sent, and a genuine
  // Part 1 answer can be four characters long.
  const resolved = resolveBrowserTranscript({ raw: "Yes.", final: "Yes." });
  assert.equal(resolved?.transcript, "Yes.");
  assert.equal(resolved?.edited, false);
});

test("input is truncated to the column limit instead of overflowing it", () => {
  const long = "a".repeat(MAX_TRANSCRIPT_LENGTH + 500);
  const resolved = resolveBrowserTranscript({ raw: long, final: long });
  assert.ok(resolved);
  assert.equal(resolved.transcript.length, MAX_TRANSCRIPT_LENGTH);
  assert.equal(resolved.raw.length, MAX_TRANSCRIPT_LENGTH);
});

// ---------------------------------------------------------------------------
// learner-safe projection
// ---------------------------------------------------------------------------

/** Realistic record whose internal fields are unmistakable sentinels. */
function record(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    id: "eval-1",
    userId: "user-SECRET",
    evaluationType: "speaking",
    sourceType: "speaking_attempt-SECRET",
    sourceId: "source-SECRET",
    providerId: "vendor-SECRET",
    providerDisplayName: "Vendor Display SECRET",
    providerType: "external",
    providerVersion: "9.9.9-SECRET",
    model: "model-name-SECRET",
    promptVersion: "prompt-9.9-SECRET",
    rubricVersion: "rubric-9.9-SECRET",
    fallbackUsed: false,
    fallbackFrom: "fallback-vendor-SECRET",
    checkedByName: PUBLIC_CHECKED_BY,
    checkedBy: { id: "vendor-SECRET", displayName: "Vendor Display SECRET", type: "external" },
    overallEstimate: 6.5,
    confidence: 0.6,
    verdict: null,
    criteria: [
      { key: "fluency", label: "Fluency", band: 6.5, note: "steady" },
      { key: "pronunciation", label: "Pronunciation", band: null, limited: true, note: "Not assessed" },
    ],
    strengths: ["Extended the answer"],
    weaknesses: ["Repeated the same verb"],
    issues: [{ category: "SPEAKING_REPETITION", message: "repeats", severity: "medium", suggestion: "vary it" }],
    nextActions: ["Practise synonyms"],
    recommendedExercises: [{ kind: "speaking", label: "Timed answer", href: "/speaking/ai", reason: "fluency" }],
    processedInMs: 1200,
    createdAt: new Date("2026-10-04T10:00:00.000Z"),
    ...overrides,
  };
}

function collectKeys(value: unknown, seen = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, seen);
    return seen;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      seen.add(key);
      collectKeys(child, seen);
    }
  }
  return seen;
}

test("the learner projection omits every internal-only field, at any depth", () => {
  const keys = collectKeys(toLearnerEvaluation(record()));
  for (const forbidden of INTERNAL_ONLY_EVALUATION_FIELDS) {
    assert.equal(keys.has(forbidden), false, `learner payload leaked internal field "${forbidden}"`);
  }
});

test("no provider, model, version or fallback string survives anywhere in the learner payload", () => {
  const source = record();
  const json = JSON.stringify(toLearnerEvaluation(source));
  const secrets = [
    source.providerId,
    source.providerDisplayName,
    source.model,
    source.providerVersion,
    source.promptVersion,
    source.rubricVersion,
    source.fallbackFrom,
    source.userId,
    source.sourceId,
    source.sourceType,
    "openai",
    "gpt",
    "gemini",
    "claude",
  ];
  for (const secret of secrets) {
    if (!secret) continue;
    assert.equal(
      json.toLowerCase().includes(secret.toLowerCase()),
      false,
      `learner payload contains internal value "${secret}"`,
    );
  }
});

test("the learner projection always says Checked by RIWI, whatever really ran", () => {
  for (const fallbackUsed of [false, true]) {
    for (const providerType of ["internal", "external"] as const) {
      const projected = toLearnerEvaluation(record({ fallbackUsed, providerType, providerId: "anything" }));
      assert.equal(projected.checkedBy, PUBLIC_CHECKED_BY);
      assert.equal(projected.checkedBy, "RIWI");
      assert.equal(projected.fallbackUsed, fallbackUsed, "fallback is safe to show; the vendor behind it is not");
    }
  }
});

test("the projection keeps the evidence the learner is entitled to see", () => {
  const projected = toLearnerEvaluation(record());
  assert.equal(projected.id, "eval-1");
  assert.equal(projected.overallEstimate, 6.5);
  assert.equal(projected.confidence, 0.6);
  assert.deepEqual(projected.strengths, ["Extended the answer"]);
  assert.deepEqual(projected.weaknesses, ["Repeated the same verb"]);
  assert.deepEqual(projected.nextActions, ["Practise synonyms"]);
  assert.equal(projected.createdAt, "2026-10-04T10:00:00.000Z");
  assert.deepEqual(projected.issues, [
    { category: "SPEAKING_REPETITION", message: "repeats", excerpt: null, suggestion: "vary it", severity: "medium" },
  ]);
  assert.deepEqual(projected.recommendedExercises, [
    { kind: "speaking", label: "Timed answer", href: "/speaking/ai", reason: "fluency" },
  ]);
});

test("an unassessed criterion projects as band-less and limited, never as a number", () => {
  const projected = toLearnerEvaluation(record());
  const pronunciation = projected.criteria.find((c) => c.key === "pronunciation");
  assert.deepEqual(pronunciation, {
    key: "pronunciation",
    label: "Pronunciation",
    band: null,
    limited: true,
    note: "Not assessed",
  });
});

test("optional criterion/issue/exercise fields default safely instead of vanishing", () => {
  const projected = toLearnerEvaluation(
    record({
      criteria: [{ key: "fluency", label: "Fluency", band: 6 }],
      issues: [{ category: "SPEAKING_FILLERS", message: "fillers", severity: "low" }],
      recommendedExercises: [{ kind: "speaking", label: "Drill" }],
    }),
  );
  assert.deepEqual(projected.criteria[0], { key: "fluency", label: "Fluency", band: 6, limited: false, note: null });
  assert.deepEqual(projected.issues[0], {
    category: "SPEAKING_FILLERS",
    message: "fillers",
    excerpt: null,
    suggestion: null,
    severity: "low",
  });
  assert.deepEqual(projected.recommendedExercises[0], { kind: "speaking", label: "Drill", href: null, reason: null });
});

test("the projection copies arrays, so a caller cannot mutate the stored record through it", () => {
  const source = record();
  const projected = toLearnerEvaluation(source);
  projected.strengths.push("injected");
  projected.criteria.push({ key: "injected", label: "x", band: 9, limited: false, note: null });
  assert.equal(source.strengths.length, 1, "stored record was mutated through the projection");
  assert.equal(source.criteria.length, 2);
});

// ---------------------------------------------------------------------------
// strict schemas: client-asserted authority is a 400, not a hint
// ---------------------------------------------------------------------------

test("sessionModeSchema is exactly SESSION_PLAN_MODES, so the two cannot drift", () => {
  assert.deepEqual([...sessionModeSchema.options].sort(), [...SESSION_PLAN_MODES].sort());
});

test("createAiSessionSchema accepts the four modes and nothing else", () => {
  for (const mode of SESSION_PLAN_MODES) {
    assert.equal(createAiSessionSchema.safeParse({ mode }).success, true, `${mode} should be accepted`);
  }
  assert.equal(createAiSessionSchema.safeParse({ mode: "part4" }).success, false);
  assert.equal(createAiSessionSchema.safeParse({}).success, false);
});

test("createAiSessionSchema rejects every client-asserted authority field", () => {
  const attempts = [
    { mode: "full", userId: "someone-else" },
    { mode: "full", role: "staff" },
    { mode: "full", seed: 42 },
    { mode: "full", plan: { items: [] } },
    { mode: "full", items: [{ promptId: "x" }] },
    { mode: "full", promptIds: ["a", "b"] },
    { mode: "full", questions: ["What do you do?"] },
    { mode: "full", provider: "openai" },
    { mode: "full", model: "gpt-4o" },
    { mode: "full", checkedBy: "Someone" },
    { mode: "full", transcriptOrigin: "stt" },
  ];
  for (const body of attempts) {
    assert.equal(
      createAiSessionSchema.safeParse(body).success,
      false,
      `session creation must reject ${JSON.stringify(body)}`,
    );
  }
});

test("completeAiSessionItemSchema takes only a uuid attemptId", () => {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId }).success, true);
  assert.equal(completeAiSessionItemSchema.safeParse({}).success, false);
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId: "not-a-uuid" }).success, false);
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId, userId: "x" }).success, false);
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId, band: 7 }).success, false);
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId, transcriptOrigin: "stt" }).success, false);
  assert.equal(completeAiSessionItemSchema.safeParse({ attemptId, ordinal: 3 }).success, false);
});

test("skip and complete accept an empty body and reject anything smuggled in", () => {
  for (const schema of [skipAiSessionItemSchema, completeAiSessionSchema]) {
    assert.equal(schema.safeParse({}).success, true);
    assert.equal(schema.safeParse({ transcript: "fabricated" }).success, false);
    assert.equal(schema.safeParse({ overallEstimate: 8 }).success, false);
    assert.equal(schema.safeParse({ userId: "x" }).success, false);
  }
});

test("listAiSessionsQuerySchema bounds the limit", () => {
  assert.equal(listAiSessionsQuerySchema.safeParse({}).success, true);
  assert.equal(listAiSessionsQuerySchema.safeParse({ limit: 5 }).success, true);
  assert.equal(listAiSessionsQuerySchema.safeParse({ limit: "5" }).success, true, "query strings must coerce");
  assert.equal(listAiSessionsQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(listAiSessionsQuerySchema.safeParse({ limit: 5000 }).success, false);
  assert.equal(listAiSessionsQuerySchema.safeParse({ userId: "x" }).success, false);
});

test("submitAttemptSchema accepts the browser transcript pair", () => {
  const parsed = submitAttemptSchema.safeParse({
    durationMs: 45_000,
    browserTranscriptRaw: "I work in a bank.",
    browserTranscript: "I work in a bank.",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.browserTranscript, "I work in a bank.");
    assert.equal(parsed.data.browserTranscriptRaw, "I work in a bank.");
  }
});

test("submitAttemptSchema still rejects transcript, origin, score and provider", () => {
  const rejected = [
    { transcript: "fabricated transcription" },
    { transcriptOrigin: "stt" },
    { transcriptOrigin: "browser_stt" },
    { browserTranscriptEdited: false },
    { transcriptEdited: false },
    { transcriptProvider: "vendor" },
    { score: 7 },
    { band: 7 },
    { overallEstimate: 7 },
    { provider: "openai" },
    { model: "gpt-4o" },
    { checkedBy: "OpenAI" },
    { userId: "someone" },
    { evaluation: { overallEstimate: 9 } },
  ];
  for (const body of rejected) {
    assert.equal(
      submitAttemptSchema.safeParse(body).success,
      false,
      `submit must reject client-asserted ${JSON.stringify(body)}`,
    );
  }
});

test("submitAttemptSchema keeps its existing bounds for Practice on Your Own", () => {
  // The pre-existing caller sends only durationMs; that must keep working.
  assert.equal(submitAttemptSchema.safeParse({}).success, true);
  assert.equal(submitAttemptSchema.safeParse({ durationMs: 60_000 }).success, true);
  assert.equal(submitAttemptSchema.safeParse({ durationMs: 0 }).success, false);
  assert.equal(submitAttemptSchema.safeParse({ durationMs: -5 }).success, false);
  assert.equal(submitAttemptSchema.safeParse({ durationMs: 4 * 60 * 60 * 1000 }).success, false);
  assert.equal(submitAttemptSchema.safeParse({ browserTranscript: "x".repeat(9000) }).success, false);
});
