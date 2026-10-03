import "server-only";
import { createLlmEvaluationProvider, httpFailure, type CompletionResult } from "../shared/llm-provider";

/**
 * First-class Anthropic (Claude) adapter. The Messages API is NOT
 * chat-completions compatible (separate `system`, `x-api-key` header, content
 * blocks, `stop_reason`), so it gets its own transport. Prompts, validation and
 * safety rules are the shared ones.
 *
 * Server env: ANTHROPIC_API_KEY, ANTHROPIC_EVALUATION_MODEL.
 */
export const anthropicProvider = createLlmEvaluationProvider({
  id: "anthropic",
  displayName: "Anthropic",
  version: "1",
  model: () => process.env.ANTHROPIC_EVALUATION_MODEL?.trim() || null,
  requiredSecrets: () => ["ANTHROPIC_API_KEY", "ANTHROPIC_EVALUATION_MODEL"],
  async transport({ system, user, maxOutputTokens, signal }): Promise<CompletionResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      redirect: "error",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal,
      body: JSON.stringify({
        model: process.env.ANTHROPIC_EVALUATION_MODEL!.trim(),
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!response.ok) return httpFailure(response.status, "Anthropic");
    const raw = await response.text();
    if (raw.length > 200_000) return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation response is too large", retryable: false } };
    const body = JSON.parse(raw) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (body.stop_reason === "refusal") return { ok: false, failure: { reason: "provider_error", detail: "Evaluation was declined", retryable: false } };
    if (body.stop_reason !== "end_turn") return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation did not complete", retryable: false } };
    return { ok: true, text: (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("") };
  },
});
