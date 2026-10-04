import "server-only";
import { createLlmEvaluationProvider, httpFailure, type CompletionResult } from "../shared/llm-provider";
import { PinnedHttpsError, requestPinnedHttps, type HostLookup } from "../shared/ssrf";

/**
 * First-class Anthropic (Claude) adapter. The Messages API is NOT
 * chat-completions compatible (separate `system`, `x-api-key` header, content
 * blocks, `stop_reason`), so it gets its own transport. Prompts, validation and
 * safety rules are the shared ones.
 *
 * Server env: ANTHROPIC_API_KEY, ANTHROPIC_EVALUATION_MODEL.
 */
export function createAnthropicProvider(deps: { lookup?: HostLookup; request?: typeof requestPinnedHttps } = {}) {
  return createLlmEvaluationProvider({
    id: "anthropic",
    displayName: "Anthropic",
    version: "1",
    model: () => process.env.ANTHROPIC_EVALUATION_MODEL?.trim() || null,
    requiredSecrets: () => ["ANTHROPIC_API_KEY", "ANTHROPIC_EVALUATION_MODEL"],
    async transport({ system, user, maxOutputTokens, signal, model }): Promise<CompletionResult> {
      let response: Awaited<ReturnType<typeof requestPinnedHttps>>;
      try {
        response = await (deps.request ?? requestPinnedHttps)("https://api.anthropic.com/v1/messages", {
          "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        }, JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          system,
          messages: [{ role: "user", content: user }],
        }), {
          allowHosts: ["api.anthropic.com"], lookup: deps.lookup, signal,
          timeoutMs: 20_000, maxResponseBytes: 200_000,
        });
      } catch (error) {
        if (error instanceof PinnedHttpsError) {
          const reason = error.code === "timeout" ? "timeout"
            : error.code === "aborted" ? "cancelled"
              : ["host_unavailable", "url_refused"].includes(error.code) ? "provider_unavailable"
                : "invalid_response";
          return { ok: false, failure: { reason, detail: "Provider request could not complete safely", retryable: reason === "timeout" || reason === "provider_unavailable" } };
        }
        throw error;
      }
      if (response.status < 200 || response.status >= 300) return httpFailure(response.status, "Anthropic");
      const raw = response.text;
      if (raw.length > 200_000) return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation response is too large", retryable: false } };
      const body = JSON.parse(raw) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
      if (body.stop_reason === "refusal") return { ok: false, failure: { reason: "provider_error", detail: "Evaluation was declined", retryable: false } };
      if (body.stop_reason !== "end_turn") return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation did not complete", retryable: false } };
      return { ok: true, text: (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("") };
    },
  });
}

export const anthropicProvider = createAnthropicProvider();
