/**
 * Pure rules for the two highest-authority handovers.
 * The database applies these with a conditional update so a second caller loses.
 * A password, session token, or service secret is never an input to a callback.
 */

export const WEBSITE_OWNER_TRANSFER = "website_owner_transfer";
export const KEEP_ROLES = ["admin", "teacher", "student"] as const;
export type KeepRole = (typeof KEEP_ROLES)[number];

export const CALLBACK_PREFIXES = ["wta", "wtr", "bhc", "bha", "bhr"] as const;
export type CallbackPrefix = (typeof CALLBACK_PREFIXES)[number];

const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChallengeStatus = "pending" | "approved" | "rejected" | "expired" | "consumed" | "cancelled";
export type HandoverStatus = "pending" | "current_confirmed" | "rejected" | "expired" | "consumed" | "cancelled";

export function isKeepRole(value: unknown): value is KeepRole {
  return typeof value === "string" && (KEEP_ROLES as readonly string[]).includes(value);
}

/** Exactly one live website owner may exist when the swap commits. */
export function liveOwnerCommitAllowed(liveOwners: number): boolean {
  return liveOwners === 1;
}

/** Callback data is an opaque id. Usernames, passwords and secrets cannot be encoded here. */
export function opaqueCallback(prefix: string, id: string): string | null {
  if (!(CALLBACK_PREFIXES as readonly string[]).includes(prefix)) return null;
  if (!OPAQUE_ID.test(id)) return null;
  const data = `${prefix}:${id}`;
  if (data.length > 64) return null;
  return data;
}

export type InitiateDenial =
  | "forbidden"
  | "invalid_credentials"
  | "no_password_on_account"
  | "telegram_not_linked"
  | "telegram_bot_not_started"
  | "target_not_found"
  | "already_owner"
  | "target_not_active"
  | "bot_owner_mismatch"
  | "target_telegram_missing";

export function canInitiateWebsiteTransfer(input: {
  actorRole: string;
  actorActive: boolean;
  hasPassword: boolean;
  passwordOk: boolean;
  actorTelegramId: string | null;
  actorReachable: boolean;
  actorId: string;
  targetFound: boolean;
  targetId?: string | null;
  targetStatus?: string | null;
  includeBotHandover: boolean;
  actorIsBotOwner: boolean;
  targetTelegramId: string | null;
  targetKnown: boolean;
}): { ok: true } | { ok: false; error: InitiateDenial } {
  if (input.actorRole !== "owner" || !input.actorActive) return { ok: false, error: "forbidden" };
  if (!input.hasPassword) return { ok: false, error: "no_password_on_account" };
  if (!input.passwordOk) return { ok: false, error: "invalid_credentials" };
  if (!input.actorTelegramId) return { ok: false, error: "telegram_not_linked" };
  if (!input.actorReachable) return { ok: false, error: "telegram_bot_not_started" };
  if (!input.targetFound || !input.targetId) return { ok: false, error: "target_not_found" };
  if (input.targetId === input.actorId) return { ok: false, error: "already_owner" };
  if (input.targetStatus !== "active") return { ok: false, error: "target_not_active" };
  if (input.includeBotHandover && !input.actorIsBotOwner) return { ok: false, error: "bot_owner_mismatch" };
  if (input.includeBotHandover && !input.targetTelegramId) return { ok: false, error: "target_telegram_missing" };
  if (input.includeBotHandover && !input.targetKnown) return { ok: false, error: "target_telegram_missing" };
  return { ok: true };
}

export type ChallengeDecision =
  | { action: "commit" }
  | { action: "reject" }
  | { action: "already" }
  | { action: "deny"; error: "wrong_actor" | "expired" | "replay" | "rejected" | "cancelled" | "wrong_purpose" };

export function decideWebsiteChallenge(input: {
  status: ChallengeStatus;
  purpose: string;
  expiresAtMs: number;
  boundTelegramId: string;
  actorTelegramId: string;
  decision: "approve" | "reject";
  nowMs: number;
}): ChallengeDecision {
  if (input.actorTelegramId !== input.boundTelegramId) return { action: "deny", error: "wrong_actor" };
  if (input.purpose !== WEBSITE_OWNER_TRANSFER) return { action: "deny", error: "wrong_purpose" };
  if (input.status === "consumed" || input.status === "approved") {
    return input.decision === "approve" ? { action: "already" } : { action: "deny", error: "replay" };
  }
  if (input.status === "rejected") return { action: "deny", error: "rejected" };
  if (input.status === "cancelled") return { action: "deny", error: "cancelled" };
  if (input.status === "expired" || input.nowMs >= input.expiresAtMs) return { action: "deny", error: "expired" };
  if (input.status !== "pending") return { action: "deny", error: "replay" };
  return input.decision === "reject" ? { action: "reject" } : { action: "commit" };
}

export type HandoverDecision =
  | { action: "confirm_current" }
  | { action: "commit" }
  | { action: "reject" }
  | { action: "already" }
  | { action: "deny"; error: "wrong_actor" | "expired" | "replay" | "rejected" | "cancelled" | "not_ready" };

export function decideHandover(input: {
  status: HandoverStatus;
  expiresAtMs: number;
  fromTelegramId: string;
  toTelegramId: string;
  actorTelegramId: string;
  step: "current_confirm" | "target_accept" | "reject";
  nowMs: number;
}): HandoverDecision {
  const isParty = input.actorTelegramId === input.fromTelegramId || input.actorTelegramId === input.toTelegramId;
  if (!isParty) return { action: "deny", error: "wrong_actor" };
  if (input.status === "consumed") {
    return input.step === "target_accept" && input.actorTelegramId === input.toTelegramId
      ? { action: "already" }
      : { action: "deny", error: "replay" };
  }
  if (input.status === "rejected") return { action: "deny", error: "rejected" };
  if (input.status === "cancelled") return { action: "deny", error: "cancelled" };
  if (input.status === "expired" || input.nowMs >= input.expiresAtMs) return { action: "deny", error: "expired" };
  if (input.step === "reject") {
    if (input.status === "pending" || input.status === "current_confirmed") return { action: "reject" };
    return { action: "deny", error: "replay" };
  }
  if (input.step === "current_confirm") {
    if (input.actorTelegramId !== input.fromTelegramId) return { action: "deny", error: "wrong_actor" };
    if (input.status !== "pending") return { action: "deny", error: "replay" };
    return { action: "confirm_current" };
  }
  if (input.actorTelegramId !== input.toTelegramId) return { action: "deny", error: "wrong_actor" };
  if (input.status !== "current_confirmed") return { action: "deny", error: "not_ready" };
  return { action: "commit" };
}

export function canStartBotHandover(input: {
  actorIsPrimaryOwner: boolean;
  actorTelegramId: string;
  targetTelegramId: string;
  targetKnown: boolean;
}): { ok: true } | { ok: false; error: "forbidden" | "invalid_actor" | "already_owner" | "target_unknown" } {
  if (!input.actorIsPrimaryOwner) return { ok: false, error: "forbidden" };
  if (!/^[0-9]{1,20}$/.test(input.targetTelegramId)) return { ok: false, error: "invalid_actor" };
  if (input.targetTelegramId === input.actorTelegramId) return { ok: false, error: "already_owner" };
  if (!input.targetKnown) return { ok: false, error: "target_unknown" };
  return { ok: true };
}

/** Notice text. Password is not an input, so it cannot leak into Telegram. */
export function websiteTransferNotice(input: {
  targetName: string;
  targetEmail: string;
  keepRole: KeepRole;
  includeBotHandover: boolean;
}) {
  const botLine = input.includeBotHandover
    ? "Bot control handover will also start. The target must still accept. BotFather ownership is not changed."
    : "Learners Area bot control is not changed by this approval.";
  return {
    title: "Ownership transfer request",
    body: [
      `Target: ${input.targetName}`,
      `Email: ${input.targetEmail}`,
      `Outgoing role: ${input.keepRole}`,
      "Expires in 5 minutes.",
      botLine,
    ].join("\n"),
  };
}
