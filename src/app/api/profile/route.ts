import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { updateProfileNameSchema } from "@/lib/validation/profile";

export async function PATCH(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateProfileNameSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // The only update field is the authenticated user's display name. Identity,
  // contact, role, admission, ownership and permission fields are not writable.
  const [updated] = await db
    .update(users)
    .set({ name: parsed.data.name })
    .where(eq(users.id, user.id))
    .returning({ name: users.name });

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, name: updated.name });
}
