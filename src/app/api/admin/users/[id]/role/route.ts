import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdministrator } from "@/lib/auth/current-user";
import { canGrantRole, isRole, outranks, ROLES } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/data/audit";
import { notifyUsers } from "@/lib/data/notifications";

/**
 * PATCH /api/admin/users/:id/role — change a person's role.
 *
 * Rules (all enforced here, not in the UI):
 *   - the actor must be an administrator, checked against the database;
 *   - you may only grant roles your own role may grant (an admin can never
 *     create an owner);
 *   - you may not change the role of someone who outranks you, so a suspended
 *     admin cannot demote the owner;
 *   - the owner role is never granted here: ownership moves through the
 *     dedicated transfer workflow so a single mistaken click cannot hand over
 *     the business.
 */
const schema = z.object({ role: z.enum(ROLES) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await requireAdministrator();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const nextRole = parsed.data.role;

  if (!isRole(nextRole)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (nextRole === "owner") {
    return NextResponse.json({ error: "owner_requires_transfer" }, { status: 409 });
  }
  if (!canGrantRole(actor.role, nextRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (id === actor.id) {
    // Self-service role changes would let an admin escalate without a second
    // pair of eyes; administrators keep their own role.
    return NextResponse.json({ error: "cannot_change_own_role" }, { status: 409 });
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.role === "owner" || !outranks(actor.role, target.role)) {
    return NextResponse.json({ error: "outranked" }, { status: 403 });
  }

  await db
    .update(users)
    .set({ role: nextRole })
    .where(and(eq(users.id, id)));

  await recordAudit({
    actorUserId: actor.id,
    action: "role.changed",
    targetType: "user",
    targetId: id,
    metadata: { from: target.role, to: nextRole },
  });
  await notifyUsers([id], {
    type: "ROLE_CHANGED",
    title: `Your role is now ${nextRole}`,
    href: "/app",
  });

  return NextResponse.json({ ok: true, role: nextRole });
}
