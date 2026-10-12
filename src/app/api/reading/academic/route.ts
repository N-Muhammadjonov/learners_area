import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { startAcademicSet } from "@/lib/data/reading-assessments";
const schema = z.object({ setId: z.string().uuid() }).strict();
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const id = await startAcademicSet(user.id, parsed.data.setId);
  return id
    ? NextResponse.json(
        { id },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
