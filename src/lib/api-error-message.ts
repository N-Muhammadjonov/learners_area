import type { Dictionary } from "@/lib/i18n/en";

/**
 * Turns a server error payload (`{ error: "forbidden" }`, a validator sentence,
 * or nothing) into a localized human sentence. Raw codes are never returned —
 * they stay in the network response and server logs (master §O, §47, §59).
 */
export function apiErrorMessage(raw: unknown, status: number | undefined, dict: Dictionary): string {
  const t = dict.apiErrors;
  const code = typeof raw === "string" ? raw : "";
  switch (code) {
    case "unauthenticated":
      return t.unauthenticated;
    case "forbidden":
      return t.forbidden;
    case "not_found":
      return t.notFound;
    case "rate_limited":
      return t.rateLimited;
    case "conflict":
    case "already_decided":
      return t.conflict;
    case "upload_not_owned_or_finalized":
      return t.uploadNotReady;
  }
  if (status === 401) return t.unauthenticated;
  if (status === 403) return t.forbidden;
  if (status === 404) return t.notFound;
  if (status === 409) return t.conflict;
  if (status === 429) return t.rateLimited;
  if (status === 400 || status === 422 || code === "invalid_input") return t.invalid;
  return t.generic;
}
