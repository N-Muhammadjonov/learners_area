/**
 * Admission state for the private learning centre.
 *
 * Learners Area is not a public course library: content, RIWI evaluation and
 * private files are only reachable by an approved account. This module is the
 * single definition of what each state allows; the check itself always happens
 * server-side against the database row (never against the session cookie), so
 * suspending an account takes effect on the offender's very next request.
 *
 * Pure module — safe for unit tests and for the client (label maps only).
 */

export const ACCOUNT_STATUSES = ["pending", "active", "rejected", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

/** Only an ACTIVE account may use anything inside the centre. */
export function hasPrivateAccess(status: AccountStatus): boolean {
  return status === "active";
}

/** May this account ask for access (or ask again after a rejection)? */
export function canRequestAccess(status: AccountStatus): boolean {
  return status === "pending" || status === "rejected";
}

/** Only a signed-in account that is not already active needs the waiting screen. */
export function needsAccessScreen(status: AccountStatus): boolean {
  return status !== "active";
}

export const ACCOUNT_STATUS_LABELS: Record<
  AccountStatus,
  { en: string; uz: string; tone: "neutral" | "good" | "warn" | "bad" }
> = {
  pending: { en: "Pending review", uz: "Ko'rib chiqilmoqda", tone: "warn" },
  active: { en: "Active", uz: "Faol", tone: "good" },
  rejected: { en: "Rejected", uz: "Rad etilgan", tone: "bad" },
  suspended: { en: "Suspended", uz: "To'xtatilgan", tone: "bad" },
};
