import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramFlowDrafts } from "@/db/schema";
import { isTelegramUserId } from "./ids";
import { isUuid } from "@/lib/validation/ids";

const KINDS = new Set(["dm", "broadcast", "search", "admin", "support_reply"]);
const TTL_MS = 10 * 60 * 1000;

export async function createFlowDraft(input: {
  actorTelegramId: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  if (!isTelegramUserId(input.actorTelegramId) || !KINDS.has(input.kind)) {
    return { ok: false as const, error: "invalid_input" };
  }
  const [row] = await db
    .insert(telegramFlowDrafts)
    .values({
      actorTelegramId: input.actorTelegramId,
      kind: input.kind,
      payload: input.payload,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .returning({ id: telegramFlowDrafts.id, expiresAt: telegramFlowDrafts.expiresAt });
  if (!row) return { ok: false as const, error: "invalid_input" };
  return { ok: true as const, id: row.id, expiresAt: row.expiresAt };
}

export async function updateFlowDraft(input: {
  id: string;
  actorTelegramId: string;
  payload: Record<string, unknown>;
}) {
  if (!isUuid(input.id) || !isTelegramUserId(input.actorTelegramId)) {
    return { ok: false as const, error: "invalid_input" };
  }
  const [row] = await db
    .update(telegramFlowDrafts)
    .set({ payload: input.payload, expiresAt: new Date(Date.now() + TTL_MS) })
    .where(
      and(
        eq(telegramFlowDrafts.id, input.id),
        eq(telegramFlowDrafts.actorTelegramId, input.actorTelegramId),
        isNull(telegramFlowDrafts.consumedAt),
        gt(telegramFlowDrafts.expiresAt, new Date())
      )
    )
    .returning({ id: telegramFlowDrafts.id });
  if (!row) return { ok: false as const, error: "not_found" };
  return { ok: true as const, id: row.id };
}

export async function readFlowDraft(input: { id: string; actorTelegramId: string }) {
  if (!isUuid(input.id) || !isTelegramUserId(input.actorTelegramId)) {
    return { ok: false as const, error: "invalid_input" };
  }
  const row = await db.query.telegramFlowDrafts.findFirst({
    where: and(
      eq(telegramFlowDrafts.id, input.id),
      eq(telegramFlowDrafts.actorTelegramId, input.actorTelegramId),
      isNull(telegramFlowDrafts.consumedAt),
      gt(telegramFlowDrafts.expiresAt, new Date())
    ),
  });
  if (!row) return { ok: false as const, error: "not_found" };
  return { ok: true as const, id: row.id, kind: row.kind, payload: row.payload };
}

/** One actor, one target, one expiry. A second claim loses. */
export async function claimFlowDraft(input: { id: string; actorTelegramId: string; kind?: string }) {
  if (!isUuid(input.id) || !isTelegramUserId(input.actorTelegramId)) {
    return { ok: false as const, error: "invalid_input" };
  }
  const filters = [
    eq(telegramFlowDrafts.id, input.id),
    eq(telegramFlowDrafts.actorTelegramId, input.actorTelegramId),
    isNull(telegramFlowDrafts.consumedAt),
    gt(telegramFlowDrafts.expiresAt, new Date()),
  ];
  if (input.kind) filters.push(eq(telegramFlowDrafts.kind, input.kind));
  const [row] = await db
    .update(telegramFlowDrafts)
    .set({ consumedAt: new Date() })
    .where(and(...filters))
    .returning({ id: telegramFlowDrafts.id, kind: telegramFlowDrafts.kind, payload: telegramFlowDrafts.payload });
  if (!row) return { ok: false as const, error: "not_found" };
  return { ok: true as const, id: row.id, kind: row.kind, payload: row.payload };
}
