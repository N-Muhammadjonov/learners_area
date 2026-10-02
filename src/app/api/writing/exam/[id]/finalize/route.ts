import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { finalizeExamPaper } from "@/lib/services/writing/exam";

export const dynamic = "force-dynamic";
const body = z.object({ reason: z.enum(["submitted", "abandoned"]) }).strict();

/** POST /api/writing/exam/:id/finalize — submit or leave. Idempotent. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again.", retryable: true } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Could not finish this paper." } }, { status: 400 });
  const paper = await finalizeExamPaper(user.id, id, parsed.data.reason);
  if (!paper) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  return NextResponse.json({ ok: true, paper });
}
