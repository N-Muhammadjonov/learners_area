import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const RIWI_OWNER_HISTORY_PAGE_SIZE = 25;
export const RIWI_OWNER_HISTORY_MAX_PAGE_SIZE = 100;
export const RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH = 2048;

export type RiwiOwnerHistoryCollection =
  | "knowledge_sources"
  | "learning_signals"
  | "learning_reviews"
  | "audit_entries"
  | "provider_experiments";
export type RiwiOwnerHistoryPosition = { sortAt: Date; id: string };

const cursorSchema = z.object({
  version: z.literal(1),
  actorId: z.string().uuid(),
  role: z.literal("owner"),
  collection: z.enum(["knowledge_sources", "learning_signals", "learning_reviews", "audit_entries", "provider_experiments"]),
  scopeId: z.string().uuid().optional(),
  filter: z.string().min(1).max(120).optional(),
  after: z.object({ sortAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict(),
}).strict();

export class RiwiOwnerHistoryCursorError extends Error {
  constructor() {
    super("riwi_owner_history_cursor_invalid");
  }
}

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new RiwiOwnerHistoryCursorError();
  return createHmac("sha256", secret).update("riwi-owner-history-cursor:v1").digest();
}

function signatureFor(payload: string): Buffer {
  return createHmac("sha256", signingKey()).update(payload).digest();
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
  scopeId?: string,
  filter?: string | null,
): RiwiOwnerHistoryPosition | null {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (actor.role !== "owner" || cursor.length > RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH) {
    throw new RiwiOwnerHistoryCursorError();
  }
  const token = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!token) throw new RiwiOwnerHistoryCursorError();
  try {
    const [, payload, encodedSignature] = token;
    const suppliedSignature = Buffer.from(encodedSignature!, "base64url");
    if (suppliedSignature.toString("base64url") !== encodedSignature) throw new RiwiOwnerHistoryCursorError();
    const expectedSignature = signatureFor(payload!);
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw new RiwiOwnerHistoryCursorError();
    }

    const decodedText = Buffer.from(payload!, "base64url").toString("utf8");
    if (Buffer.from(decodedText, "utf8").toString("base64url") !== payload) throw new RiwiOwnerHistoryCursorError();
    const parsed = cursorSchema.safeParse(JSON.parse(decodedText));
    if (
      !parsed.success
      || parsed.data.actorId !== actor.id
      || parsed.data.collection !== collection
      || parsed.data.scopeId !== scopeId
      || (parsed.data.filter ?? null) !== (filter ?? null)
    ) {
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
  scopeId?: string;
  filter?: string | null;
  after: RiwiOwnerHistoryPosition;
}): string {
  if (
    input.actor.role !== "owner"
    || !z.string().uuid().safeParse(input.actor.id).success
    || !Number.isFinite(input.after.sortAt.getTime())
    || !z.string().uuid().safeParse(input.after.id).success
    || (input.scopeId !== undefined && !z.string().uuid().safeParse(input.scopeId).success)
    || (input.filter !== undefined && input.filter !== null && !z.string().min(1).max(120).safeParse(input.filter).success)
  ) {
    throw new RiwiOwnerHistoryCursorError();
  }
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    actorId: input.actor.id,
    role: "owner",
    collection: input.collection,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    ...(input.filter ? { filter: input.filter } : {}),
    after: { sortAt: input.after.sortAt.toISOString(), id: input.after.id },
  })).toString("base64url");
  const encoded = `${payload}.${signatureFor(payload).toString("base64url")}`;
  if (encoded.length > RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH) throw new RiwiOwnerHistoryCursorError();
  return encoded;
}
