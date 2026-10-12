import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { EXAM_MAX_CHARS, saveExamDraft } from "@/lib/services/writing/exam";

export const dynamic = "force-dynamic";
const body = z.object({
  position: z.union([z.literal(1), z.literal(2)]),
  content: z.string().max(EXAM_MAX_CHARS),
  revision: z.number().int().min(1).max(1_000_000),
}).strict();

/** PUT /api/writing/exam/:id/draft — debounced autosave of one task's text. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again.", retryable: true } }, { status: 401 });
  if (!isUuid(id)) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Could not save this text.", retryable: false } }, { status: 400 });
  const r = await saveExamDraft(user.id, id, parsed.data.position, parsed.data.content, parsed.data.revision);
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "closed" ? 409 : 413;
    return NextResponse.json({ error: { code: r.code, message: r.code === "closed" ? "This paper is closed." : "Could not save this text.", retryable: false } }, { status });
  }
  return NextResponse.json(r);
}
