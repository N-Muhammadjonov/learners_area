import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/db/client";
import { telegramLoginIntents } from "@/db/schema";
import { eq, and, gt, sql } from "drizzle-orm";

export function generateToken(): string {
  return randomBytes(32).toString("hex"); // 256 bits of entropy
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLoginIntent(userId?: string) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  // browser nonce binding could be an explicit random nonce stored in an httpOnly cookie
  // and passed back when the browser consumes the intent.
  const browserNonce = generateToken();
  const browserNonceHash = hashToken(browserNonce);
  
  // Expiry in 5 minutes
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  
  const [intent] = await db.insert(telegramLoginIntents).values({
    tokenHash,
    browserNonceHash,
    userId: userId || null,
    expiresAt,
  }).returning({ id: telegramLoginIntents.id });
  
  if (!intent) {
    throw new Error("Failed to create login intent");
  }

  return {
    intentId: intent.id,
    token,
    browserNonce,
    expiresAt,
  };
}

export async function readIntentStatus(intentId: string, browserNonce: string) {
  const nonceHash = hashToken(browserNonce);
  const intent = await db.query.telegramLoginIntents.findFirst({
    where: and(eq(telegramLoginIntents.id, intentId), eq(telegramLoginIntents.browserNonceHash, nonceHash)),
    columns: { status: true, expiresAt: true },
  });
  if (!intent) return null;
  const expired = intent.expiresAt.getTime() <= Date.now();
  return { status: expired && intent.status === "pending" ? "expired" : intent.status, expired };
}

export async function cancelIntent(intentId: string, browserNonce: string) {
  const nonceHash = hashToken(browserNonce);
  const [updated] = await db
    .update(telegramLoginIntents)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(telegramLoginIntents.id, intentId),
        eq(telegramLoginIntents.browserNonceHash, nonceHash),
        eq(telegramLoginIntents.status, "pending"),
        gt(telegramLoginIntents.expiresAt, new Date())
      )
    )
    .returning({ id: telegramLoginIntents.id });
  return Boolean(updated);
}

export async function consumeIntent(intentId: string, browserNonce: string) {
  const nonceHash = hashToken(browserNonce);
  
  const [updated] = await db.update(telegramLoginIntents)
    .set({
      status: "consumed",
      consumedAt: new Date(),
    })
    .where(
      and(
        eq(telegramLoginIntents.id, intentId),
        eq(telegramLoginIntents.browserNonceHash, nonceHash),
        eq(telegramLoginIntents.status, "confirmed"),
        gt(telegramLoginIntents.expiresAt, new Date())
      )
    )
    .returning({
      telegramUserId: telegramLoginIntents.telegramUserId,
      userId: telegramLoginIntents.userId,
    });
    
  return updated;
}
