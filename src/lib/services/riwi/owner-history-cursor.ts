import "server-only";
import { z } from "zod";

export const RIWI_OWNER_HISTORY_PAGE_SIZE = 25;
export const RIWI_OWNER_HISTORY_MAX_PAGE_SIZE = 100;
export const RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH = 2048;

export type RiwiOwnerHistoryCollection = "knowledge_sources" | "learning_signals" | "audit_entries" | "provider_experiments";
export type RiwiOwnerHistoryPosition = { sortAt: Date; id: string };

const cursorSchema = z.object({
  version: z.literal(1),
  actorId: z.string().uuid(),
  role: z.literal("owner"),
  collection: z.enum(["knowledge_sources", "learning_signals", "audit_entries", "provider_experiments"]),
  after: z.object({ sortAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict(),
}).strict();

export class RiwiOwnerHistoryCursorError extends Error {
  constructor() {
    super("riwi_owner_history_cursor_invalid");
  }
}

export function ownerHistoryPageLimit(value: number | undefined, fallback = RIWI_OWNER_HISTORY_PAGE_SIZE): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > RIWI_OWNER_HISTORY_MAX_PAGE_SIZE) {
    throw new RiwiOwnerHistoryCursorError();
  }
  return value;
}

export function decodeOwnerHistoryCursor(
  cursor: string | null | undefined,
  actor: { id: string; role: string },
  collection: RiwiOwnerHistoryCollection,
): RiwiOwnerHistoryPosition | null {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (actor.role !== "owner" || cursor.length > RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new RiwiOwnerHistoryCursorError();
  }
  try {
    const decodedText = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decodedText, "utf8").toString("base64url") !== cursor) throw new RiwiOwnerHistoryCursorError();
    const parsed = cursorSchema.safeParse(JSON.parse(decodedText));
    if (!parsed.success || parsed.data.actorId !== actor.id || parsed.data.collection !== collection) {
      throw new RiwiOwnerHistoryCursorError();
    }
    return { sortAt: new Date(parsed.data.after.sortAt), id: parsed.data.after.id };
  } catch {
    throw new RiwiOwnerHistoryCursorError();
  }
}

export function encodeOwnerHistoryCursor(input: {
  actor: { id: string; role: string };
  collection: RiwiOwnerHistoryCollection;
  after: RiwiOwnerHistoryPosition;
}): string {
  if (input.actor.role !== "owner" || !Number.isFinite(input.after.sortAt.getTime())) throw new RiwiOwnerHistoryCursorError();
  const encoded = Buffer.from(JSON.stringify({
    version: 1,
    actorId: input.actor.id,
    role: "owner",
    collection: input.collection,
    after: { sortAt: input.after.sortAt.toISOString(), id: input.after.id },
  })).toString("base64url");
  if (encoded.length > RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH) throw new RiwiOwnerHistoryCursorError();
  return encoded;
}
