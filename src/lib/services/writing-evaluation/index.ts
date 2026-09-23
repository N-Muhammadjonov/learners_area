import { DemoWritingEvaluationProvider } from "./demo-provider";
import type { WritingEvaluationService } from "./types";
import { flags } from "@/lib/config/flags";

export * from "./types";

/**
 * Provider switch. When REAL_AI_ENABLED is turned on, wire a real model
 * call in here behind the same WritingEvaluationService interface — every
 * caller (the submit route, tests) only ever depends on the interface.
 */
export function getWritingEvaluationService(): WritingEvaluationService {
  if (flags.realAiEnabled) {
    // Real provider intentionally not implemented in this environment —
    // no model/API key is wired up here. Fall through to the demo
    // provider rather than silently pretending to call one.
    console.warn(
      "REAL_AI_ENABLED is true but no real WritingEvaluationService is configured; using the demo provider."
    );
  }
  return new DemoWritingEvaluationProvider();
}
