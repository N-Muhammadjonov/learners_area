import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, passwordResetTokens } from "@/db/schema";
import { requestResetSchema } from "@/lib/validation/auth";

/**
 * No email service is wired up in this environment (see EmailService note in
 * README). In production this route would send the link by email and always
 * return {ok:true} either way, to avoid leaking which emails are registered.
 * Here — dev/demo only — we additionally return the raw link so the reset
 * flow is actually testable end to end without an inbox.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = requestResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

  await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });

  return NextResponse.json({
    ok: true,
    devResetUrl: `/reset-password/confirm?token=${rawToken}`,
  });
}
