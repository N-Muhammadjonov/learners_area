/** Pure parser for non-sensitive role/status invalidation signals.
 * The event carries only a user UUID. Neither role nor account status in a
 * client event is ever trusted to grant access.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAccessChangeUserId(payload: string | undefined): string | null {
  if (!payload || payload.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    const userId = (parsed as Record<string, unknown>).userId;
    return typeof userId === "string" && UUID.test(userId) ? userId : null;
  } catch {
    return null;
  }
}
