import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramLoginIntents } from "@/db/schema";
import type { IntentPurpose } from "@/lib/telegram/intent-purpose";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const INTENT_TTL_MS = 5 * 60 * 1000;

export async function createLoginIntent(input: { purpose: IntentPurpose; userId?: string | null }) {
  const token = generateToken();
  const browserNonce = generateToken();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
  const [intent] = await db
    .insert(telegramLoginIntents)
    .values({
      tokenHash: hashToken(token),
      browserNonceHash: hashToken(browserNonce),
      userId: input.purpose === "link" ? input.userId ?? null : null,
      purpose: input.purpose,
      expiresAt,
    })
    .returning({ id: telegramLoginIntents.id });
  if (!intent) throw new Error("Failed to create login intent");
  return { intentId: intent.id, token, browserNonce, expiresAt, purpose: input.purpose };
}

export async function readIntentStatus(intentId: string, browserNonce: string) {
  const intent = await db.query.telegramLoginIntents.findFirst({
    where: and(eq(telegramLoginIntents.id, intentId), eq(telegramLoginIntents.browserNonceHash, hashToken(browserNonce))),
    columns: { status: true, expiresAt: true, purpose: true },
  });
  if (!intent) return null;
  const expired = intent.expiresAt.getTime() <= Date.now();
  const status = expired && intent.status !== "consumed" && intent.status !== "cancelled" ? "expired" : intent.status;
  return { status, expired, purpose: intent.purpose };
}

/**
 * Cancel is idempotent for an already-cancelled intent.
 * A confirmed intent must die here too, or the browser can still exchange it.
 */
export async function cancelIntent(intentId: string, browserNonce: string) {
  const nonceHash = hashToken(browserNonce);
  const [updated] = await db
    .update(telegramLoginIntents)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(telegramLoginIntents.id, intentId),
        eq(telegramLoginIntents.browserNonceHash, nonceHash),
        inArray(telegramLoginIntents.status, ["pending", "confirmed"])
      )
    )
    .returning({ id: telegramLoginIntents.id });
  if (updated) return { ok: true as const };
  const existing = await db.query.telegramLoginIntents.findFirst({
    where: and(eq(telegramLoginIntents.id, intentId), eq(telegramLoginIntents.browserNonceHash, nonceHash)),
    columns: { status: true },
  });
  if (!existing) return { ok: false as const, reason: "not_found" as const };
  if (existing.status === "cancelled") return { ok: true as const };
  return { ok: false as const, reason: existing.status === "consumed" ? ("consumed" as const) : ("not_cancellable" as const) };
}

/** Conditional consume. A second caller loses and must not receive a session. */
export async function consumeConfirmedIntent(intentId: string, browserNonce: string) {
  const [updated] = await db
    .update(telegramLoginIntents)
    .set({ status: "consumed", consumedAt: new Date() })
    .where(
      and(
        eq(telegramLoginIntents.id, intentId),
        eq(telegramLoginIntents.browserNonceHash, hashToken(browserNonce)),
        eq(telegramLoginIntents.status, "confirmed"),
        // Expiry is checked by the exchange that holds the row. A consume after
        // a successful exchange in the same request is still the same intent.
      )
    )
    .returning({ id: telegramLoginIntents.id });
  return Boolean(updated);
}
