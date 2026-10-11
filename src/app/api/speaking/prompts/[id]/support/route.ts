import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { findPublishedPromptSupport, type SpeakingChannel } from "@/lib/data/speaking-practice";
import { studySupportSchema } from "@/lib/speaking/study-support";

/**
 * GET /api/speaking/prompts/:id/support — study support for ONE prompt, on demand.
 *
 * `study_support` holds the model answer, the ideas and the vocabulary HTML: the heaviest part of a
 * prompt row, and the reason the payload grew with the bank rather than with what the learner was
 * actually reading. A learner reads one question's support at a time, so it is fetched when that
 * question is selected instead of being shipped for every prompt in the corpus.
 *
 * Publication state and the channel's `availableIn` eligibility are enforced in the query, so this is
 * not a way to read a draft or a prompt the current page is not allowed to serve. The result is
 * validated with the same schema the client already parses, so a malformed row cannot reach the
 * learner unvalidated.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const channel: SpeakingChannel = req.nextUrl.searchParams.get("channel") === "ai" ? "ai" : "practice_alone";

  const row = await findPublishedPromptSupport(id, channel);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = studySupportSchema.safeParse(row.studySupport ?? {});
  if (!parsed.success) {
    // A malformed stored row is a 502, not a silently empty panel: the learner asked for support and
    // the server could not honestly provide it.
    return NextResponse.json({ error: "invalid_study_support" }, { status: 502 });
  }
  return NextResponse.json({ promptId: row.id, support: parsed.data }, { headers: { "cache-control": "no-store" } });
}
