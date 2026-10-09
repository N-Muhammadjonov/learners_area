import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { completeSpeakingAiItem } from "@/lib/data/speaking-ai-sessions";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answered"), attemptId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("skipped") }).strict(),
]);

/** Ownership-checked, idempotent advancement of exactly one immutable plan item. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await completeSpeakingAiItem(db, user.id, id, itemId, parsed.data);
  return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
}
