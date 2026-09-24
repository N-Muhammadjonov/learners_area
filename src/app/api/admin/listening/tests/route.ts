import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { listeningTests } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createListeningTestSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = createListeningTestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const [created] = await db
    .insert(listeningTests)
    .values({ ...parsed.data, createdByUserId: user.id })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
