export const LIVE_PARTNER_RULES_VERSION = 1;
export type LivePartnerState = "offline" | "available" | "outgoing_invite" | "incoming_invite" | "connecting" | "in_call" | "reconnecting";
export type LivePartnerErrorCode =
  | "rules_outdated" | "rules_required" | "not_eligible" | "profile_incomplete" | "in_call" | "not_available"
  | "partner_busy" | "invalid_target" | "invite_not_found" | "invite_closed" | "session_not_found" | "session_ended";
export class LivePartnerError extends Error {
  constructor(public readonly code: LivePartnerErrorCode) { super(code); this.name = "LivePartnerError"; }
}
export const LIVE_PARTNER_ERROR_STATUS: Record<LivePartnerErrorCode, number> = {
  rules_outdated: 409, rules_required: 409, not_eligible: 403, profile_incomplete: 409, in_call: 409, not_available: 409,
  partner_busy: 409, invalid_target: 400, invite_not_found: 404, invite_closed: 409, session_not_found: 404, session_ended: 409,
};
