import { touchMeaningfulActivity } from "@/lib/services/activity";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitListeningAttempt } from "@/lib/data/listening-attempt-write";
import { requireActiveUser } from "@/lib/auth/current-user";

const schema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().max(500) })).max(200),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await submitListeningAttempt(user.id, id, parsed.data.answers);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : result.error === "already_submitted" ? 409 : 400 });
  }
  await touchMeaningfulActivity(user.id);
  return NextResponse.json({ ok: true, ...result });
}
