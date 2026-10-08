import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { readingPassages } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { createPassageSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isAdministrator(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createPassageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const [created] = await db.insert(readingPassages).values({...parsed.data,publicationState:"draft"}).returning();
  return NextResponse.json({ ok: true, id: created!.id });
}
