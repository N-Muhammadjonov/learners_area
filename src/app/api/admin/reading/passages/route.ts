import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { readingPassages } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { createPassageSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createPassageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const [created] = await db.insert(readingPassages).values(parsed.data).returning();
  return NextResponse.json({ ok: true, id: created!.id });
}
