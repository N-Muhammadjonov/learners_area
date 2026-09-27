export const BROADCAST_AUDIENCES = [
  "all_bot_users",
  "active_students",
  "pending_applicants",
  "teachers",
  "admins",
] as const;

export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export function isBroadcastAudience(value: unknown): value is BroadcastAudience {
  return typeof value === "string" && (BROADCAST_AUDIENCES as readonly string[]).includes(value);
}
