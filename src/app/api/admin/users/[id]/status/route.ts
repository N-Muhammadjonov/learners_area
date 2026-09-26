import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAdministrator } from "@/lib/auth/current-user";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { outranks } from "@/lib/auth/roles";
import { setAccountStatus } from "@/lib/data/admission";

/**
 * POST /api/admin/users/:id/status — suspend or re-activate an account.
 *
 * Suspension takes effect on the target's next request because every private
 * path reads the status from the database (see src/lib/auth/current-user.ts).
 * An owner can never be suspended by an administrator, and nobody can suspend
 * themselves — that would be an outage, not a decision.
 */
const schema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  reason: z.string().trim().max(500).nullish(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await requireAdministrator();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  if (id === actor.id) {
    return NextResponse.json({ error: "cannot_change_own_status" }, { status: 409 });
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.role === "owner" || !outranks(actor.role, target.role)) {
    return NextResponse.json({ error: "outranked" }, { status: 403 });
  }

  const result = await setAccountStatus({
    userId: id,
    status: parsed.data.status,
    actorUserId: actor.id,
    reason: parsed.data.reason ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, status: parsed.data.status });
}
