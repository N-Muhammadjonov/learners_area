import type {
  ProviderCapability,
  ProviderEvaluationOutput,
} from "../../src/lib/services/coach/schema";
import {
  providerFail,
  providerOk,
  type AssignmentEvaluationInput,
  type EvaluationContext,
  type EvaluationProvider,
  type GrammarEvaluationInput,
  type ProviderResult,
  type SpeakingEvaluationInput,
  type VocabularyEvaluationInput,
  type WritingEvaluationInput,
} from "../../src/lib/services/coach/types";

/**
 * A generic external provider adapter used by the test suite.
 *
 * It lives here, outside `src/`, on purpose: connecting a provider must not
 * require touching the application. This file is the proof — it implements the
 * same `EvaluationProvider` interface a real vendor adapter would, and the only
 * production-side change needed to use one is a single line in
 * `src/lib/services/coach/providers/index.ts`.
 *
 * It never claims a capability it does not have, and its `requiredSecrets`
 * lists variable NAMES only.
 */

export type TestBehaviour =
  | "succeed"
  | "fail"
  | "rate_limited"
  | "malformed_extra_field"
  | "malformed_bad_band"
  | "hang"
  | "fail_once";

export const GOOD_OUTPUT: ProviderEvaluationOutput = {
  overallEstimate: 7.5,
  confidence: 0.9,
  verdict: null,
  criteria: [
    { key: "task_response", label: "Task Response", band: 7.5, note: "From the test provider." },
    { key: "coherence_cohesion", label: "Coherence and Cohesion", band: 7, note: "From the test provider." },
    { key: "lexical_resource", label: "Lexical Resource", band: 7.5, note: "From the test provider." },
    { key: "grammatical_range_accuracy", label: "Grammatical Range and Accuracy", band: 7, note: "From the test provider." },
  ],
  strengths: ["Provided by the test adapter."],
  weaknesses: [],
  issues: [],
  nextActions: ["Keep going."],
  recommendedExercises: [],
};

export class TestEvaluationProvider implements EvaluationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly type = "external" as const;
  readonly version = "0.0.1-test";
  readonly model: string | null;
  readonly capabilities: readonly ProviderCapability[];
  readonly requiredSecrets: readonly string[];
  readonly promptVersion = "external-adapter-v1";
  readonly rubricVersion = "ielts-public-criteria-v1";

  /** Every context the adapter was handed — used to assert privacy behaviour. */
  calls: EvaluationContext[] = [];
  callCount = 0;

  constructor(
    private options: {
      id?: string;
      displayName?: string;
      behaviour?: TestBehaviour;
      capabilities?: readonly ProviderCapability[];
      requiredSecrets?: readonly string[];
      model?: string | null;
    } = {}
  ) {
    this.id = options.id ?? "test-external";
    this.displayName = options.displayName ?? "Test Evaluator";
    this.capabilities =
      options.capabilities ?? [
        "text-evaluation",
        "writing-evaluation",
        "speaking-evaluation",
        "grammar-evaluation",
        "vocabulary-evaluation",
        "assignment-evaluation",
      ];
    this.requiredSecrets = options.requiredSecrets ?? ["TEST_EVALUATOR_API_KEY"];
    this.model = options.model ?? "test-model-1";
  }

  private async behave(ctx: EvaluationContext): Promise<ProviderResult> {
    this.calls.push(ctx);
    this.callCount += 1;
    const behaviour = this.options.behaviour ?? "succeed";

    if (behaviour === "hang") {
      // Never resolves: exercises the resolver's timeout + fallback path.
      return new Promise<ProviderResult>(() => {});
    }

    switch (behaviour) {
      case "fail":
        return providerFail("provider_error", "test provider configured to fail");
      case "rate_limited":
        return providerFail("rate_limited", "test provider is rate limited", true);
      case "malformed_extra_field":
        return providerOk({ ...GOOD_OUTPUT, vendorInternalScore: 42 } as unknown as ProviderEvaluationOutput);
      case "malformed_bad_band":
        return providerOk({
          ...GOOD_OUTPUT,
          criteria: [{ key: "task_response", label: "Task Response", band: 12 }],
        } as unknown as ProviderEvaluationOutput);
      case "fail_once":
        return this.callCount === 1
          ? providerFail("provider_error", "first call fails")
          : providerOk(GOOD_OUTPUT);
      default:
        return providerOk(GOOD_OUTPUT);
    }
  }

  async evaluateWriting(ctx: EvaluationContext, _input: WritingEvaluationInput) {
    return this.behave(ctx);
  }
  async evaluateSpeaking(ctx: EvaluationContext, _input: SpeakingEvaluationInput) {
    return this.behave(ctx);
  }
  async evaluateGrammar(ctx: EvaluationContext, _input: GrammarEvaluationInput) {
    return this.behave(ctx);
  }
  async evaluateVocabulary(ctx: EvaluationContext, _input: VocabularyEvaluationInput) {
    return this.behave(ctx);
  }
  async evaluateAssignment(ctx: EvaluationContext, _input: AssignmentEvaluationInput) {
    return this.behave(ctx);
  }
}

/** A provider that always fails — used to prove fallback cannot loop forever. */
export class AlwaysFailingProvider implements EvaluationProvider {
  readonly id = "always-fails";
  readonly displayName = "Always Fails";
  readonly type = "external" as const;
  readonly version = "0.0.1-test";
  readonly model = null;
  readonly capabilities: readonly ProviderCapability[] = ["writing-evaluation"];
  readonly requiredSecrets: readonly string[] = [];
  readonly promptVersion = "test";
  readonly rubricVersion = "test";
  callCount = 0;

  async evaluateWriting(): Promise<ProviderResult> {
    this.callCount += 1;
    return providerFail("provider_error", "always fails");
  }
}

/**
 * A stand-in that takes RIWI's place in the registry, so a test can prove RIWI
 * is *not* called after a successful external evaluation. A spread of a class
 * instance would drop its prototype methods, which is why this is a real class.
 */
export class StubRiwi implements EvaluationProvider {
  readonly id = "riwi";
  readonly displayName = "RIWI";
  readonly type = "internal" as const;
  readonly version = "stub";
  readonly model = null;
  readonly capabilities: readonly ProviderCapability[] = [
    "text-evaluation",
    "writing-evaluation",
    "speaking-evaluation",
    "grammar-evaluation",
    "vocabulary-evaluation",
    "assignment-evaluation",
  ];
  readonly requiredSecrets: readonly string[] = [];
  readonly promptVersion = "stub";
  readonly rubricVersion = "stub";
  callCount = 0;

  private fail(): Promise<ProviderResult> {
    this.callCount += 1;
    return Promise.resolve(providerFail("provider_error", "stub riwi failure"));
  }

  evaluateWriting() {
    return this.fail();
  }
  evaluateSpeaking() {
    return this.fail();
  }
  evaluateGrammar() {
    return this.fail();
  }
  evaluateVocabulary() {
    return this.fail();
  }
  evaluateAssignment() {
    return this.fail();
  }
}
