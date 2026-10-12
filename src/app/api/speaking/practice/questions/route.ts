import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listSpeakingPromptPage, type SpeakingChannel } from "@/lib/data/speaking-practice";

const CHANNELS: readonly SpeakingChannel[] = ["practice_alone", "ai"];

/**
 * GET /api/speaking/practice/questions — one bounded page of speaking prompts.
 *
 * Server-side pagination, part/topic narrowing and search for Speaking Practice and Speaking Practice
 * with AI. Both pages used to receive the entire published bank in one server render, so what a learner
 * could reach was decided by how much the server was willing to ship: at 10 000 prompts that was 10 007
 * rows read and 6.15 MB, growing with the corpus (docs/UNBOUNDED-READS.md).
 *
 * Narrowing happens here against the full published corpus, which is what keeps every prompt reachable
 * instead of only the first page of them. Publication rules and the channel's `availableIn` eligibility
 * are applied in the query, so a draft can never surface and no previously eligible question is lost.
 *
 * A cursor this server did not mint is refused with 400 rather than silently restarting at page 1, which
 * would re-serve prompts the learner had already seen and could strand the rest of the walk.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const rawChannel = params.get("channel");
  const channel: SpeakingChannel = rawChannel === "ai" ? "ai" : "practice_alone";
  if (rawChannel !== null && !CHANNELS.includes(rawChannel as SpeakingChannel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const part = params.get("part");
  const topic = params.get("topic");
  const search = (params.get("q") ?? "").trim().slice(0, 120);
  const cursor = params.get("cursor");

  try {
    const page = await listSpeakingPromptPage({
      channel,
      ...(part ? { part } : {}),
      ...(topic ? { topic } : {}),
      ...(search ? { search } : {}),
      ...(cursor === null ? {} : { cursor }),
    });
    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /cursor/i.test(error.message)) {
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    throw error;
  }
}
