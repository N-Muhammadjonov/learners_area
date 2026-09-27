import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireActiveUser, requireOwner } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import {
  cancelWebsiteChallenge,
  initiateWebsiteTransfer,
  readWebsiteChallenge,
} from "@/lib/auth/owner-transfer";
import { RULES, accountKey, enforce } from "@/lib/http/rate-limit";
import { isUuid } from "@/lib/validation/ids";

/**
 * POST /api/owner/transfer — start a handover. It does not change roles.
 *
 * The password is checked here and is not forwarded. Telegram approval, in
 * src/lib/auth/owner-transfer.ts, is what commits the one-transaction swap.
 * If the current owner has no linked numeric Telegram id, this stops.
 */

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  keepRole: z.enum(["admin", "teacher", "student"]),
  includeBotHandover: z.boolean().optional().default(false),
});

function statusFor(error: string) {
  if (error === "forbidden") return 403;
  if (error === "invalid_credentials") return 401;
  if (error === "target_not_found") return 404;
  return 409;
}

function challengeArgs(req: NextRequest, actorId: string) {
  const challengeId = req.nextUrl.searchParams.get("challengeId") ?? "";
  const browserNonce = req.headers.get("x-owner-challenge-nonce") ?? "";
  if (!isUuid(challengeId) || browserNonce.length < 32 || browserNonce.length > 128) return null;
  return { actorId, challengeId, browserNonce };
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const limited = enforce(RULES.ownerTransfer, accountKey(owner.id));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const actorRow = await db.query.users.findFirst({ where: eq(users.id, owner.id) });
  if (!actorRow?.passwordHash) {
    return NextResponse.json({ error: "no_password_on_account" }, { status: 409 });
  }
  const passwordOk = await verifyPassword(parsed.data.password, actorRow.passwordHash);
  if (!passwordOk) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const started = await initiateWebsiteTransfer({
    actorId: owner.id,
    email: parsed.data.email,
    passwordOk,
    hasPassword: true,
    keepRole: parsed.data.keepRole,
    includeBotHandover: parsed.data.includeBotHandover,
  });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: statusFor(started.error) });

  return NextResponse.json(
    {
      ok: true,
      status: "pending",
      challengeId: started.challengeId,
      browserNonce: started.browserNonce,
      expiresAt: started.expiresAt,
      includeBotHandover: started.includeBotHandover,
    },
    { status: 202, headers: { "cache-control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  const actor = await requireActiveUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const args = challengeArgs(req, actor.id);
  if (!args) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const row = await readWebsiteChallenge(args);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const actor = await requireActiveUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const args = challengeArgs(req, actor.id);
  if (!args) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const cancelled = await cancelWebsiteChallenge(args);
  if (!cancelled) return NextResponse.json({ error: "not_pending" }, { status: 409 });
  return NextResponse.json({ ok: true, status: "cancelled" }, { headers: { "cache-control": "no-store" } });
}
