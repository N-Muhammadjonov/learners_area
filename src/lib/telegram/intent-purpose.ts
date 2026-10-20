/**
 * Login, registration and linking are different operations.
 * The browser may ask for one of these; the server decides whether that ask is legal.
 * A later request cannot change the purpose stored on the intent.
 */

export const INTENT_PURPOSES = ["login", "register", "link", "replace"] as const;
export type IntentPurpose = (typeof INTENT_PURPOSES)[number];

export function isIntentPurpose(value: unknown): value is IntentPurpose {
  return typeof value === "string" && (INTENT_PURPOSES as readonly string[]).includes(value);
}

export type PurposeDecision =
  | { ok: true; purpose: IntentPurpose; bindUser: boolean }
  | { ok: false; error: "sign_in_required" | "already_signed_in" | "invalid_purpose" };

/**
 * Missing purpose is login. That is the safe default: an unknown caller must
 * not create an account just because the client omitted the field.
 */
export function resolveIntentPurpose(requested: unknown, hasSession: boolean): PurposeDecision {
  const purpose: IntentPurpose = requested == null || requested === "" ? "login" : isIntentPurpose(requested) ? requested : "login";
  if (requested != null && requested !== "" && !isIntentPurpose(requested)) {
    return { ok: false, error: "invalid_purpose" };
  }
  if ((purpose === "link"||purpose==='replace') && !hasSession) return { ok: false, error: "sign_in_required" };
  if (purpose === "register" && hasSession) return { ok: false, error: "already_signed_in" };
  return { ok: true, purpose, bindUser: purpose === "link"||purpose==='replace' };
}

export type ExchangeOutcome =
  | "session"
  | "no_linked_account"
  | "already_active"
  | "already_pending"
  | "pending"
  | "reopened"
  | "suspended"
  | "conflict"
  | "not_confirmed";

/**
 * Whether a failed or incomplete exchange may leave the intent confirmed so the
 * browser can retry. A successful terminal outcome is consumed exactly once.
 */
export function shouldConsume(outcome: ExchangeOutcome): boolean {
  return outcome === "session" || outcome === "already_active" || outcome === "already_pending" || outcome === "pending" || outcome === "reopened" || outcome === "suspended";
}
