import assert from "node:assert/strict";
import test from "node:test";

import { providerRegistry, registerProvider } from "../src/lib/services/coach/registry";
import {
  resolveEvaluation,
  type EvaluationRequest,
  type ResolveOutcome,
} from "../src/lib/services/coach/resolver";
import {
  providerEvaluationOutputSchema,
  evaluationResultSchema,
} from "../src/lib/services/coach/schema";
import { RIWI_PROVIDER_ID } from "../src/lib/services/coach/config";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { categoriesCheckedBy } from "../src/lib/services/coach/categories";
import { classifyAssignment } from "../src/lib/services/coach/assignment";
import { SpeechToTextService, sttRegistry } from "../src/lib/services/coach/stt";
import { createLlmEvaluationProvider } from "../src/lib/services/coach/providers/shared/llm-provider";
import { RiwiProvider } from "../src/lib/services/coach/providers/riwi";
import { GOOD_OUTPUT, StubRiwi, TestEvaluationProvider } from "./support/test-provider";

/**
 * Provider resolution, fallback and validation.
 *
 * No test names a real vendor: every external case is exercised through the
 * generic adapter in tests/support, which is exactly how a future integration
 * will be tested.
 */

const WRITING_REQUEST: EvaluationRequest = {
  evaluationType: "writing",
  input: {
    taskType: "task2",
    prompt: "Some people think … Discuss both views.",
    content:
      "Over the last decade, many students have started to study online. However, this shift brings problems. " +
      "Firstly, students lose the daily contact with their teachers, and they often have no one to ask. " +
      "Furthermore, the home environment is full of distractions, so it is hard to focus on a long essay. " +
      "On the other hand, online study allows people who live far from a city to attend a good course. " +
      "As a result, education becomes more equal. In conclusion, I believe the benefits outweigh the problems when the course is well designed.",
    targetWordCount: 80,
  },
};

const CTX = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("RIWI is the default evaluator and no external provider is called", async () => {
  const spy = new TestEvaluationProvider({ id: "should-not-run" });
  registerProvider(spy);
  try {
    const outcome = await withEnv(
      { AI_PRIMARY_PROVIDER: undefined, AI_EXTERNAL_ENABLED: undefined },
      () => resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.providerType, "internal");
    assert.equal(outcome.result.checkedBy.displayName, "RIWI");
    assert.equal(outcome.result.fallbackUsed, false);
    assert.equal(outcome.result.fallbackFrom, null);
    assert.equal(spy.callCount, 0, "an unconfigured external provider must never be called");
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("RIWI's bounded evidence excerpts remain exact source quotes under contract validation", async () => {
  const content = "word ".repeat(160);
  const outcome = await withEnv(
    { AI_PRIMARY_PROVIDER: undefined, AI_EXTERNAL_ENABLED: undefined },
    () => resolveEvaluation({
      evaluationType: "writing",
      input: { taskType: "task1", prompt: "Describe the chart.", content, targetWordCount: 150 },
    }, CTX),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
  const excerpts = outcome.result.issues.flatMap((issue) => issue.excerpt ? [issue.excerpt] : []);
  assert.ok(excerpts.length > 0, "the long test response should exercise RIWI excerpt bounds");
  for (const excerpt of excerpts) assert.ok(content.includes(excerpt), `excerpt is not verbatim source text: ${excerpt}`);
});

test("a configured external provider that succeeds is the only evaluator", async () => {
  const spy = new TestEvaluationProvider({ id: "test-external", displayName: "Test AI" });
  registerProvider(spy);
  const riwiSpy = new StubRiwi();
  // Swap RIWI for an always-failing stub: if RIWI were also called after a
  // successful external evaluation, the result would come back as a failure.
  providerRegistry.register(riwiSpy);

  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.providerId, "test-external");
    assert.equal(outcome.result.providerType, "external");
    assert.equal(outcome.result.checkedBy.displayName, "Test AI");
    assert.equal(outcome.result.fallbackUsed, false);
    assert.equal(outcome.result.overallEstimate, GOOD_OUTPUT.overallEstimate);
    assert.equal(outcome.attempts.length, 1);
    assert.equal(outcome.attempts[0]?.providerId, "test-external");
    assert.equal(riwiSpy.callCount, 0, "RIWI must not evaluate a submission an external provider already handled");
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("an external failure falls back to RIWI and says so", async () => {
  registerProvider(new TestEvaluationProvider({ behaviour: "fail" }));
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.checkedBy.displayName, "RIWI");
    assert.equal(outcome.result.fallbackUsed, true);
    assert.equal(outcome.result.fallbackFrom, "test-external");
    assert.equal(outcome.attempts[0]?.outcome, "failed");
    assert.equal(outcome.attempts[0]?.failure?.reason, "provider_error");
    assert.equal(outcome.attempts[1]?.outcome, "succeeded");
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a malformed provider response is rejected and RIWI takes over", async () => {
  for (const behaviour of ["malformed_extra_field", "malformed_bad_band"] as const) {
    registerProvider(new TestEvaluationProvider({ behaviour }));
    try {
      const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, (): Promise<ResolveOutcome> =>
        resolveEvaluation(WRITING_REQUEST, CTX)
      );
      assert.equal(outcome.ok, true, `${behaviour}: expected a fallback result`);
      if (!outcome.ok) return;
      assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
      assert.equal(outcome.result.fallbackUsed, true);
      assert.equal(
        outcome.attempts[0]?.failure?.reason,
        "invalid_response",
        `${behaviour}: malformed output must be reported as invalid_response`
      );
    } finally {
      providerRegistry.clear();
      reRegisterDefaults();
    }
  }
});

test("an external LLM pronunciation score is rejected instead of being hidden before validation", async () => {
  const invalidOutput = {
    overallEstimate: 7, confidence: 0.8, verdict: null,
    criteria: [
      { key: "fluency", label: "Fluency and Coherence", band: 7, limited: false, note: null },
      { key: "lexical", label: "Lexical Resource", band: 7, limited: false, note: null },
      { key: "grammar", label: "Grammatical Range and Accuracy", band: 7, limited: false, note: null },
      { key: "pronunciation", label: "Pronunciation", band: 8, limited: false, note: "Claimed from transcript" },
    ],
    strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [],
  };
  let systemPrompt = "";
  const external = createLlmEvaluationProvider({
    id: "test-llm-speaking",
    displayName: "Test LLM",
    version: "fixture-v1",
    model: () => "fixture-model",
    requiredSecrets: () => ["TEST_LLM_API_KEY"],
    transport: async ({ system }) => {
      systemPrompt = system;
      return { ok: true, text: JSON.stringify(invalidOutput) };
    },
  });
  registerProvider(external);
  try {
    const outcome = await withEnv({
      AI_PRIMARY_PROVIDER: "test-llm-speaking",
      AI_EXTERNAL_ENABLED: "true",
      TEST_LLM_API_KEY: "fixture-only-not-a-provider-credential",
    }, () => resolveEvaluation({
      evaluationType: "speaking",
      input: {
        part: "part2",
        promptText: "Describe a place you like.",
        transcript: "I would like to talk about a park near my house. First of all, it is quiet in the morning, so I often go there to read. On the other hand, it becomes crowded at the weekend, because families bring their children. Overall, I like it because it is close to my home and I can walk there in five minutes.",
        transcriptOrigin: "manual",
        durationMs: 95_000,
        pronunciationAvailable: false,
      },
    }, CTX));
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.match(systemPrompt, /Pronunciation, accent, intonation, stress, pauses, and prosody cannot be inferred from a transcript/);
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.fallbackUsed, true);
    assert.equal(outcome.attempts[0]?.failure?.reason, "invalid_response");
    const pronunciation = outcome.result.criteria.find((criterion) => criterion.key === "pronunciation");
    assert.equal(pronunciation?.band, null);
    assert.equal(pronunciation?.limited, true);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a provider without the required capability is not called", async () => {
  const limited = new TestEvaluationProvider({
    id: "text-only",
    displayName: "Text Only",
    capabilities: ["text-evaluation"],
  });
  registerProvider(limited);
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "text-only" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(limited.callCount, 0, "capability check must happen before the call");
    assert.equal(outcome.attempts[0]?.failure?.reason, "capability_missing");
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.fallbackUsed, true);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a hanging provider times out and RIWI evaluates instead", async () => {
  registerProvider(new TestEvaluationProvider({ behaviour: "hang" }));
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX, { timeoutMs: 120, maxAttempts: 1, retryBackoffMs: 0 })
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.attempts[0]?.failure?.reason, "timeout");
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.fallbackUsed, true);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a transient failure is retried once before falling back", async () => {
  const flaky = new TestEvaluationProvider({ behaviour: "fail_once" });
  registerProvider(flaky);
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX, { maxAttempts: 2, retryBackoffMs: 0 })
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(flaky.callCount, 2);
    assert.equal(outcome.result.providerId, "test-external");
    assert.equal(outcome.result.fallbackUsed, false);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a configured but unregistered provider degrades to RIWI, truthfully", async () => {
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "not-installed" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.result.fallbackUsed, true);
    assert.equal(outcome.result.fallbackFrom, "not-installed");
    assert.equal(outcome.attempts[0]?.failure?.reason, "not_configured");
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("AI_EXTERNAL_ENABLED=false keeps every evaluation internal", async () => {
  const spy = new TestEvaluationProvider();
  registerProvider(spy);
  try {
    const outcome = await withEnv(
      { AI_PRIMARY_PROVIDER: "test-external", AI_EXTERNAL_ENABLED: "false" },
      () => resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(spy.callCount, 0);
    assert.equal(outcome.result.providerId, RIWI_PROVIDER_ID);
    assert.equal(outcome.attempts[0]?.failure?.reason, "not_configured");
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("RIWI failing produces a truthful error instead of a loop", async () => {
  const failing = new StubRiwi();
  providerRegistry.register(failing);
  try {
    const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "riwi" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX, { maxAttempts: 1 })
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.error, "evaluation_unavailable");
    // One provider, one attempt, no recursion.
    assert.equal(outcome.attempts.length, 1);
    assert.equal(failing.callCount, 1);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("a fallback never recurses back into the external provider", async () => {
  const external = new TestEvaluationProvider({ behaviour: "fail" });
  registerProvider(external);
  try {
    await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX, { maxAttempts: 1 })
    );
    // Exactly one attempt against the failing provider, then RIWI once.
    assert.equal(external.callCount, 1);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("external adapters never receive local user identity", async () => {
  const spy = new TestEvaluationProvider();
  registerProvider(spy);
  try {
    await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () =>
      resolveEvaluation(WRITING_REQUEST, CTX)
    );
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0]?.userId, "external-anonymous");
    assert.notEqual(spy.calls[0]?.userId, CTX.userId);
    assert.equal(spy.calls[0]?.language, "en");
    // Provider context contains only anonymous identity, language, timeout signal,
    // and machine-owned contract metadata (never the local user identity).
    assert.deepEqual(Object.keys(spy.calls[0] ?? {}).sort(), [
      "assessmentContract",
      "language",
      "signal",
      "userId",
    ]);
    assert.equal(spy.calls[0]?.assessmentContract?.key, "writing.task2.generic");
    assert.equal(spy.calls[0]?.assessmentContract?.version, getAssessmentContract("writing.task2.generic")?.version);
    assert.equal(spy.calls[0]?.assessmentContract?.policyScope, null);
  } finally {
    providerRegistry.clear();
    reRegisterDefaults();
  }
});

test("provider version metadata is recorded on every result", async () => {
  const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "riwi" }, () =>
    resolveEvaluation(WRITING_REQUEST, CTX)
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const contract = getAssessmentContract("writing.task2.generic");
  assert.ok(contract);
  assert.equal(outcome.result.providerVersion, "1.1.0");
  assert.equal(outcome.result.promptVersion, contract.version);
  assert.equal(outcome.result.rubricVersion, contract.rubricVersion);
  assert.ok(outcome.result.processedInMs >= 0);
  assert.ok(evaluationResultSchema.safeParse(outcome.result).success);
});

test("RIWI reports pronunciation as limited instead of inventing a score", async () => {
  const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "riwi" }, () =>
    resolveEvaluation(
      {
        evaluationType: "speaking",
        input: {
          part: "part2",
          promptText: "Describe a place you like.",
          transcript:
            "I would like to talk about a park near my house. First of all, it is quiet in the morning, so I often go there to read. " +
            "On the other hand, it becomes crowded at the weekend, because families bring their children. Overall, I like it because it is close to my home and I can walk there in five minutes.",
          transcriptOrigin: "manual",
          durationMs: 95_000,
          pronunciationAvailable: false,
        },
      },
      CTX
    )
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const pronunciation = outcome.result.criteria.find((c) => c.key === "pronunciation");
  assert.ok(pronunciation, "pronunciation criterion must be reported");
  assert.equal(pronunciation?.band, null);
  assert.equal(pronunciation?.limited, true);
  assert.ok((pronunciation?.note ?? "").length > 0);
  // The estimate averages only the criteria that could be measured.
  assert.ok(outcome.result.overallEstimate !== null);
  assert.ok(outcome.result.confidence < 0.8);
});

test("RIWI refuses to evaluate a speaking attempt with no transcript", async () => {
  const outcome = await withEnv({ AI_PRIMARY_PROVIDER: "riwi" }, () =>
    resolveEvaluation(
      {
        evaluationType: "speaking",
        input: {
          part: "part1",
          promptText: null,
          transcript: null,
          transcriptOrigin: null,
          durationMs: 30_000,
          pronunciationAvailable: false,
        },
      },
      CTX
    )
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error, "invalid_evaluation");
  assert.deepEqual(outcome.attempts, [], "missing work is rejected before any evaluator call");
});

test("the evaluation contract rejects vendor-shaped output", () => {
  assert.equal(providerEvaluationOutputSchema.safeParse(GOOD_OUTPUT).success, true);
  assert.equal(
    providerEvaluationOutputSchema.safeParse({ ...GOOD_OUTPUT, vendorInternalScore: 42 }).success,
    false,
    "unknown vendor fields must not validate"
  );
  assert.equal(
    providerEvaluationOutputSchema.safeParse({
      ...GOOD_OUTPUT,
      criteria: [{ key: "x", label: "x", band: 12 }],
    }).success,
    false,
    "a band outside 0–9 must not validate"
  );
  assert.equal(
    providerEvaluationOutputSchema.safeParse({ ...GOOD_OUTPUT, confidence: 3 }).success,
    false
  );
});

test("speech-to-text is provider-independent and never the evaluator", async () => {
  assert.equal(SpeechToTextService.isConfigured(), false);
  const unconfigured = await SpeechToTextService.transcribe({
    objectKey: "speaking/attempts/x/audio/y.webm",
    contentType: "audio/webm",
    durationMs: 1000,
    language: "en",
  });
  assert.equal(unconfigured.ok, false);
  if (!unconfigured.ok) assert.equal(unconfigured.failure.reason, "not_configured");

  // A transcription provider is registered independently of the evaluator.
  const transcribeCalls: string[] = [];
  sttRegistry.register({
    id: "test-stt",
    displayName: "Test Transcription",
    version: "0.0.1-test",
    type: "external",
    capabilities: ["speech-to-text", "audio-input"],
    requiredSecrets: ["TEST_STT_API_KEY"],
    async transcribe(request) {
      transcribeCalls.push(request.objectKey);
      return {
        ok: true,
        providerId: "test-stt",
        providerDisplayName: "Test Transcription",
        transcript: "This is a transcript from the test adapter.",
        confidence: 0.8,
      };
    },
  });

  try {
    const outcome = await withEnv({ STT_PRIMARY_PROVIDER: "test-stt" }, () =>
      SpeechToTextService.transcribe({
        objectKey: "speaking/attempts/x/audio/y.webm",
        contentType: "audio/webm",
        durationMs: 1000,
        language: "en",
      })
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.transcript, "This is a transcript from the test adapter.");
    assert.deepEqual(transcribeCalls, ["speaking/attempts/x/audio/y.webm"]);

    // An STT provider must never end up as "Checked by".
    const evaluation = await withEnv(
      { AI_PRIMARY_PROVIDER: "riwi", STT_PRIMARY_PROVIDER: "test-stt" },
      () =>
        resolveEvaluation(
          {
            evaluationType: "speaking",
            input: {
              part: "part1",
              promptText: null,
              transcript: outcome.transcript,
              transcriptOrigin: "stt",
              durationMs: 60_000,
              pronunciationAvailable: false,
            },
          },
          CTX
        )
    );
    assert.equal(evaluation.ok, true);
    if (!evaluation.ok) return;
    assert.equal(evaluation.result.checkedBy.id, RIWI_PROVIDER_ID);
    assert.notEqual(evaluation.result.checkedBy.id, "test-stt");
  } finally {
    sttRegistry.clear();
  }
});

test("assignment evaluation dispatches by task type rather than guessing", () => {
  const writing = classifyAssignment({
    relatedWritingPromptId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    description: null,
  });
  assert.equal(writing.kind, "writing_task");

  const freeForm = classifyAssignment({ relatedWritingPromptId: null, description: "Write something" });
  assert.equal(freeForm.kind, "free_form");
  assert.ok(freeForm.reason.length > 0);
});

test("weakness categories stay inside the canonical vocabulary", () => {
  const canonical = new Set([
    "GRAMMAR_ARTICLE",
    "GRAMMAR_SVA",
    "GRAMMAR_TENSE",
    "GRAMMAR_PREPOSITION",
    "GRAMMAR_FRAGMENT",
    "GRAMMAR_PUNCTUATION",
    "WRITING_TASK_RESPONSE",
    "WRITING_COHESION",
    "WRITING_LEXICAL_REPETITION",
    "WRITING_LENGTH",
    "SPEAKING_FILLERS",
    "SPEAKING_FLUENCY",
    "SPEAKING_SHORT_RESPONSE",
    "SPEAKING_REPETITION",
    "VOCAB_COLLOCATION",
    "VOCAB_WRONG_FORM",
    "VOCAB_NOT_USED",
  ]);
  for (const type of ["writing", "speaking", "grammar", "vocabulary", "assignment"] as const) {
    const checked = categoriesCheckedBy(type);
    assert.ok(checked.length > 0, `${type} must check at least one category`);
    for (const category of checked) {
      assert.ok(canonical.has(category), `${category} is not a canonical weakness category`);
    }
  }
});

test("every registered provider satisfies the adapter interface", () => {
  for (const id of providerRegistry.ids()) {
    const registration = providerRegistry.get(id);
    assert.ok(registration);
    const provider = registration.provider;
    assert.ok(provider.id.length > 0);
    assert.ok(provider.displayName.length > 0);
    assert.ok(["internal", "external"].includes(provider.type));
    assert.ok(provider.capabilities.length > 0);
    // Adapters declare secret NAMES, never values.
    for (const secret of provider.requiredSecrets) {
      assert.match(secret, /^[A-Z][A-Z0-9_]*$/);
    }
    assert.ok(provider.promptVersion.length > 0);
    assert.ok(provider.rubricVersion.length > 0);
  }
  // RIWI needs no credentials at all — it works on a machine with no API keys.
  assert.deepEqual(providerRegistry.get("riwi")?.provider.requiredSecrets, []);
});

/** The registry is process-wide; these tests mutate it, so restore the default. */
function reRegisterDefaults(): void {
  providerRegistry.register(new RiwiProvider());
}
