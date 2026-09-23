import "server-only";

/**
 * AI configuration lives here and nowhere else.
 *
 * Everything is read from the server environment at call time (not at module
 * load), so a deployment can change providers without a code change and tests
 * can exercise several configurations in one process. Nothing in this module
 * is ever imported by a client component: the resolver, the registry and every
 * adapter carry the `server-only` marker, which fails the build if a client
 * component reaches them.
 */

export const RIWI_PROVIDER_ID = "riwi";
export const NO_STT_PROVIDER_ID = "none";

export type CoachConfig = {
  /** AI_PRIMARY_PROVIDER — the configured evaluator. Defaults to the internal one. */
  aiPrimaryProvider: string;
  /** AI_EXTERNAL_ENABLED — a master switch for calling out to a third party. */
  externalEnabled: boolean;
  /** AI_PROVIDER_TIMEOUT_MS */
  timeoutMs: number;
  /** AI_PROVIDER_MAX_ATTEMPTS — retries for *retryable* failures only. */
  maxAttempts: number;
  /** AI_PROVIDER_RETRY_BACKOFF_MS */
  retryBackoffMs: number;
  /** STT_PRIMARY_PROVIDER — deliberately independent of the evaluator. */
  sttPrimaryProvider: string;
};

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "true" || raw === "1";
}

export function readCoachConfig(): CoachConfig {
  return {
    aiPrimaryProvider: readString("AI_PRIMARY_PROVIDER", RIWI_PROVIDER_ID).toLowerCase(),
    externalEnabled: readBool("AI_EXTERNAL_ENABLED", true),
    timeoutMs: readInt("AI_PROVIDER_TIMEOUT_MS", 20_000, 500, 120_000),
    maxAttempts: readInt("AI_PROVIDER_MAX_ATTEMPTS", 2, 1, 5),
    retryBackoffMs: readInt("AI_PROVIDER_RETRY_BACKOFF_MS", 200, 0, 10_000),
    sttPrimaryProvider: readString("STT_PRIMARY_PROVIDER", NO_STT_PROVIDER_ID).toLowerCase(),
  };
}
