import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ownershipTransfers, users } from "@/db/schema";
import { requireOwner } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/data/audit";
import { notifyUsers } from "@/lib/data/notifications";

/**
 * POST /api/owner/transfer — hand the centre to another account.
 *
 * Deliberately hard to do by accident:
 *   - only the current OWNER may call it (role read from the database);
 *   - the owner's own password is required again, so an unattended browser
 *     cannot transfer the business;
 *   - the target must be an existing, active, non-suspended account;
 *   - the owner role is never granted through the generic role endpoint.
 *
 * The transfer is written to `ownership_transfers` *and* the audit log, so the
 * history of the business survives the people in it.
 */
const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  /** What the outgoing owner becomes. Never "owner": that would be two owners. */
  keepRole: z.enum(["admin", "teacher", "student"]),
});

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const actorRow = await db.query.users.findFirst({ where: eq(users.id, owner.id) });
  if (!actorRow?.passwordHash) {
    return NextResponse.json({ error: "no_password_on_account" }, { status: 409 });
  }
  const passwordOk = await verifyPassword(parsed.data.password, actorRow.passwordHash);
  if (!passwordOk) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const target = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (!target) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  if (target.id === owner.id) return NextResponse.json({ error: "already_owner" }, { status: 409 });
  if (target.accountStatus !== "active") {
    return NextResponse.json({ error: "target_not_active" }, { status: 409 });
  }

  await db.update(users).set({ role: "owner" }).where(eq(users.id, target.id));
  await db.update(users).set({ role: parsed.data.keepRole }).where(eq(users.id, owner.id));
  await db.insert(ownershipTransfers).values({
    fromUserId: owner.id,
    toUserId: target.id,
    previousOwnerRole: parsed.data.keepRole,
  });

  await recordAudit({
    actorUserId: owner.id,
    action: "ownership.transferred",
    targetType: "user",
    targetId: target.id,
    metadata: { previousOwnerRole: parsed.data.keepRole },
  });
  await notifyUsers([target.id, owner.id], {
    type: "OWNERSHIP_TRANSFERRED",
    title: "Ownership transferred",
    body: `The centre is now owned by ${target.name}.`,
    href: "/owner",
  });

  return NextResponse.json({ ok: true });
}
