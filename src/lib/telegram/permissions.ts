/**
 * Bot Admin permissions are a separate authority from website roles.
 *
 * A Learners Area ADMIN is not a bot admin. A hidden button is not a check.
 * These functions are pure so every route and every test can share one rule.
 */

export const BOT_PERMISSIONS = [
  "VIEW_USERS",
  "MANAGE_USERS",
  "ADMISSIONS",
  "SUPPORT",
  "DIRECT_MESSAGE",
  "BROADCAST",
  "VIEW_STATS",
  "VIEW_AUDIT",
] as const;

/** Never stored on a bot-admin row. Only the primary Telegram owner has these. */
export const OWNER_ONLY_PERMISSIONS = [
  "MANAGE_BOT_ADMINS",
  "DANGEROUS_USER_DELETE",
  "BOT_SETTINGS",
] as const;

export type BotPermission = (typeof BOT_PERMISSIONS)[number];
export type OwnerOnlyPermission = (typeof OWNER_ONLY_PERMISSIONS)[number];
export type AnyBotPermission = BotPermission | OwnerOnlyPermission;

const BOT_PERMISSION_SET = new Set<string>(BOT_PERMISSIONS);
const OWNER_ONLY_SET = new Set<string>(OWNER_ONLY_PERMISSIONS);

export function isBotPermission(value: unknown): value is BotPermission {
  return typeof value === "string" && BOT_PERMISSION_SET.has(value);
}

export function isReservedBotPermission(value: unknown): value is OwnerOnlyPermission {
  return typeof value === "string" && OWNER_ONLY_SET.has(value);
}

export function isAnyBotPermission(value: unknown): value is AnyBotPermission {
  return isBotPermission(value) || isReservedBotPermission(value);
}

/** Drop anything that is not an explicit, grantable bot permission. */
export function sanitizeGrantablePermissions(values: unknown): BotPermission[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<BotPermission>();
  for (const value of values) {
    if (isBotPermission(value)) seen.add(value);
  }
  return [...seen];
}

export type BotAccess = {
  isPrimaryOwner: boolean;
  permissions: readonly BotPermission[];
};

/**
 * Primary owner passes every check. A bot admin passes only an explicitly
 * granted, non-owner permission. Website role is not an input — on purpose.
 */
export function actorCan(actor: BotAccess, permission: AnyBotPermission): boolean {
  if (actor.isPrimaryOwner) return true;
  if (isReservedBotPermission(permission)) return false;
  return actor.permissions.includes(permission);
}

/** A bot admin cannot grant, widen, or keep owner-only powers. */
export function canEditBotAdmin(actor: BotAccess): boolean {
  return actor.isPrimaryOwner;
}

export function permissionsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
