import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { saveDraftAnswers } from "@/lib/data/reading";
import { blockIfOver } from "@/lib/http/rate-limit";

/**
 * Autosave for an open reading attempt.
 *
 * Reading is a twenty-minute task, and until this endpoint existed the answers
 * lived in one browser tab. A reload, a closed lid or a bumped router wiped the
 * whole attempt while the library card still offered to "resume" it.
 *
 * Three limits, all deliberate:
 *   * the attempt must belong to the signed-in student and still be in progress
 *     (`saveDraftAnswers` re-checks both against the database, so a forged id or
 *     a finished attempt writes nothing);
 *   * only questions from that attempt's own passage are accepted;
 *   * draft rows carry no score — grading happens once, at submit.
 */
const schema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().max(500) })).max(60),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Autosave fires often by design; the ceiling is generous but not absent, so a
  // stuck client cannot hammer the database.
  const limited = blockIfOver({ name: "reading_draft", limit: 240, windowMs: 60_000 }, `reading_draft:${user.id}`);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await saveDraftAnswers(id, user.id, parsed.data.answers);
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result.reason === "already_submitted") return NextResponse.json({ error: "already_submitted" }, { status: 409 });

  return NextResponse.json({ saved: result.saved, at: new Date().toISOString() });
}
