import "server-only";
import { createLlmEvaluationProvider, httpFailure, type CompletionResult } from "../shared/llm-provider";

/**
 * First-class OpenAI adapter (Responses API). Only the transport is vendor
 * specific; prompts, validation and safety rules are shared (../shared). The
 * shared prompt text — including the speaking rule "You have no audio: never
 * comment on pronunciation" — lives in ../shared/prompts.ts.
 */
export const openAiProvider = createLlmEvaluationProvider({
  id: "openai",
  displayName: "OpenAI",
  version: "1",
  model: () => process.env.OPENAI_EVALUATION_MODEL?.trim() || null,
  requiredSecrets: () => ["OPENAI_API_KEY", "OPENAI_EVALUATION_MODEL"],
  async transport({ system, user, maxOutputTokens, signal, model }): Promise<CompletionResult> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model, store: false, instructions: system, input: user,
        text: { format: { type: "json_object" } }, max_output_tokens: maxOutputTokens,
      }),
    });
    if (!response.ok) return httpFailure(response.status, "OpenAI");
    const raw = await response.text();
    if (raw.length > 200_000) return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation response is too large", retryable: false } };
    const body = JSON.parse(raw) as { status?: string; output?: Array<{ type?: string; content?: Array<{ type: string; text?: string }> }> };
    if (body.status !== "completed") return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation did not complete", retryable: false } };
    const content = body.output?.filter((item) => item.type === "message").flatMap((item) => item.content ?? []) ?? [];
    if (content.some((item) => item.type === "refusal")) return { ok: false, failure: { reason: "provider_error", detail: "Evaluation was declined", retryable: false } };
    return { ok: true, text: content.filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("") };
  },
});
