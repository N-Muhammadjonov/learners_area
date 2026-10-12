import "server-only";
import { z } from "zod";
import { providerCapabilitySchema } from "../../schema";
import type { EvaluationProvider } from "../../types";
import { createLlmEvaluationProvider, httpFailure, TEXT_CAPABILITIES, type CompletionResult } from "../shared/llm-provider";
import { assertPublicHost, checkProviderBaseUrl } from "../shared/ssrf";

/**
 * Generic chat-completions adapter — ONLY for endpoints that genuinely speak the
 * `POST {baseURL}/chat/completions` protocol (Bearer key, `messages`,
 * `choices[0].message.content`). Vendors with a different API get a first-class
 * adapter in its own folder instead. Nothing here assumes a specific vendor.
 *
 * Configuration is SERVER-SIDE ONLY — the deployment env `AI_COMPATIBLE_PROVIDERS`
 * (JSON array). A learner, a request body or the database can never supply an
 * endpoint. Each entry:
 *   { "id": "acme", "displayName": "Acme AI", "baseURL": "https://api.acme.example/v1",
 *     "model": "acme-large", "secretRef": "AI_ACME_API_KEY",
 *     "capabilities": ["writing-evaluation", "structured-output"] }
 * `secretRef` is the NAME of the env var holding the key — never the key itself.
 * Optional `AI_COMPATIBLE_ALLOWED_HOSTS` (comma list) pins the permitted hosts.
 */

// First-class adapter ids are additionally excluded at registration (../index.ts).
const RESERVED_IDS = new Set(["riwi", "none"]);

export const compatibleEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/).refine((id) => !RESERVED_IDS.has(id), "reserved id"),
  displayName: z.string().trim().min(1).max(60),
  baseURL: z.string().url().max(300),
  model: z.string().trim().min(1).max(120),
  // An env var NAME. A value that looks like a key (or anything else) is refused.
  secretRef: z.string().regex(/^AI_[A-Z0-9_]{2,60}$/),
  capabilities: z.array(providerCapabilitySchema).max(12).optional(),
}).strict();
export type CompatibleEntry = z.infer<typeof compatibleEntrySchema>;

export type CompatibleConfigIssue = { index: number; reason: string };

export function parseCompatibleProviders(raw: string | undefined, allowHostsRaw?: string): { entries: CompatibleEntry[]; issues: CompatibleConfigIssue[] } {
  if (!raw?.trim()) return { entries: [], issues: [] };
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { entries: [], issues: [{ index: -1, reason: "AI_COMPATIBLE_PROVIDERS is not valid JSON" }] };
  }
  if (!Array.isArray(list)) return { entries: [], issues: [{ index: -1, reason: "AI_COMPATIBLE_PROVIDERS must be an array" }] };
  const allowHosts = (allowHostsRaw ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const entries: CompatibleEntry[] = [];
  const issues: CompatibleConfigIssue[] = [];
  const seen = new Set<string>();
  list.slice(0, 10).forEach((item, index) => {
    const parsed = compatibleEntrySchema.safeParse(item);
    // Issues name the failing FIELD only — never echo a configured value.
    if (!parsed.success) return void issues.push({ index, reason: `invalid entry (${parsed.error.issues.map((i) => i.path.join(".") || "entry").join(", ")})` });
    const url = checkProviderBaseUrl(parsed.data.baseURL, allowHosts);
    if (!url.ok) return void issues.push({ index, reason: `baseURL refused: ${url.reason}` });
    if (seen.has(parsed.data.id)) return void issues.push({ index, reason: "duplicate id" });
    seen.add(parsed.data.id);
    entries.push({ ...parsed.data, baseURL: url.url.toString().replace(/\/+$/, "") });
  });
  return { entries, issues };
}

export function createCompatibleProvider(entry: CompatibleEntry, deps: { lookup?: Parameters<typeof assertPublicHost>[1] } = {}): EvaluationProvider {
  const endpoint = new URL(`${entry.baseURL}/chat/completions`);
  return createLlmEvaluationProvider({
    id: entry.id,
    displayName: entry.displayName,
    version: "compat-1",
    model: () => entry.model,
    requiredSecrets: () => [entry.secretRef],
    capabilities: entry.capabilities?.filter((c) => TEXT_CAPABILITIES.includes(c)) ?? TEXT_CAPABILITIES,
    async transport({ system, user, maxOutputTokens, signal, model }): Promise<CompletionResult> {
      // Runtime SSRF check right before every call: every resolved address must be public.
      if (!(await assertPublicHost(endpoint.hostname, deps.lookup))) {
        return { ok: false, failure: { reason: "provider_unavailable", detail: "Endpoint host is not a public address", retryable: false } };
      }
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${process.env[entry.secretRef]!.trim()}`, "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
          max_tokens: maxOutputTokens,
          stream: false,
        }),
      });
      if (!response.ok) return httpFailure(response.status, entry.displayName);
      const raw = await response.text();
      if (raw.length > 200_000) return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation response is too large", retryable: false } };
      const body = JSON.parse(raw) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }> };
      const choice = body.choices?.[0];
      if (choice?.message?.refusal) return { ok: false, failure: { reason: "provider_error", detail: "Evaluation was declined", retryable: false } };
      if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
        return { ok: false, failure: { reason: "invalid_response", detail: "Evaluation did not complete", retryable: false } };
      }
      return { ok: true, text: choice.message.content };
    },
  });
}

/** Providers declared by the deployment. Invalid entries are skipped (and reported to the owner). */
export function compatibleProvidersFromEnv(env: NodeJS.ProcessEnv = process.env, takenIds: readonly string[] = []): EvaluationProvider[] {
  return parseCompatibleProviders(env.AI_COMPATIBLE_PROVIDERS, env.AI_COMPATIBLE_ALLOWED_HOSTS).entries
    .filter((e) => !takenIds.includes(e.id))
    .map((e) => createCompatibleProvider(e));
}
