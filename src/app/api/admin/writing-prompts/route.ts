import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { writingPrompts } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";

const schema = z.object({
  taskType: z.enum(["task1", "task2"]),
  category: z.string().min(1).max(60),
  prompt: z.string().min(10).max(2000),
  targetWordCount: z.coerce.number().int().min(50).max(500),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isAdministrator(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [created] = await db.insert(writingPrompts).values(parsed.data).returning();
  return NextResponse.json({ ok: true, id: created!.id });
}
