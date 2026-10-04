import "server-only";
import { createLlmEvaluationProvider, httpFailure, normalizeCompletionUsage, type CompletionResult } from "../shared/llm-provider";
import { PinnedHttpsError, requestPinnedHttps, type HostLookup } from "../shared/ssrf";

/**
 * First-class OpenAI adapter (Responses API). Only the transport is vendor
 * specific; prompts, validation and safety rules are shared (../shared). The
 * shared prompt text — including the speaking rule "You have no audio: never
 * comment on pronunciation" — lives in ../shared/prompts.ts.
 */
export function createOpenAiProvider(deps: { lookup?: HostLookup; request?: typeof requestPinnedHttps } = {}) {
  return createLlmEvaluationProvider({
    id: "openai",
    displayName: "OpenAI",
    version: "1",
    model: () => process.env.OPENAI_EVALUATION_MODEL?.trim() || null,
    requiredSecrets: () => ["OPENAI_API_KEY", "OPENAI_EVALUATION_MODEL"],
    async transport({ system, user, maxOutputTokens, signal, model }): Promise<CompletionResult> {
      let response: Awaited<ReturnType<typeof requestPinnedHttps>>;
      try {
        response = await (deps.request ?? requestPinnedHttps)("https://api.openai.com/v1/responses", {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
          "Content-Type": "application/json",
        }, JSON.stringify({
          model, store: false, instructions: system, input: user,
          text: { format: { type: "json_object" } }, max_output_tokens: maxOutputTokens,
        }), {
          allowHosts: ["api.openai.com"], lookup: deps.lookup, signal,
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
      if (response.status < 200 || response.status >= 300) return httpFailure(response.status, "OpenAI");
      const raw = response.text;
      if (raw.length > 200_000) return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation response is too large", retryable: false } };
      const body = JSON.parse(raw) as {
        status?: string;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
        output?: Array<{ type?: string; content?: Array<{ type: string; text?: string }> }>;
      };
      const usage = normalizeCompletionUsage(body.usage?.input_tokens, body.usage?.output_tokens);
      if (body.status !== "completed") return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation did not complete", retryable: false }, ...(usage ? { usage } : {}) };
      const content = body.output?.filter((item) => item.type === "message").flatMap((item) => item.content ?? []) ?? [];
      if (content.some((item) => item.type === "refusal")) return { ok: false, failure: { reason: "provider_error", detail: "Evaluation was declined", retryable: false }, ...(usage ? { usage } : {}) };
      return {
        ok: true,
        text: content.filter((item) => item.type === "output_text").map((item) => item.text ?? "").join(""),
        ...(usage ? { usage } : {}),
      };
    },
  });
}

export const openAiProvider = createOpenAiProvider();
