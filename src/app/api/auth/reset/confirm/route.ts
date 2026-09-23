import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users, passwordResetTokens } from "@/db/schema";
import { confirmResetSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = confirmResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date())
    ),
  });

  if (!record) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, record.userId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  return NextResponse.json({ ok: true });
}
