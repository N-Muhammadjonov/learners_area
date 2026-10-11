import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { speakingFacets, type SpeakingChannel } from "@/lib/data/speaking-practice";

/**
 * GET /api/speaking/practice/facets — server-side Part and Topic discovery.
 *
 * The Part → Topic → Questions browse needs two facts that cannot come from a page of prompts: how many
 * published questions each part really holds, and the real list of topics in the chosen part. Both were
 * previously computed in the browser from the whole shipped bank, which is exactly what made the read
 * unbounded. They are counted here, over the full corpus, as bounded aggregates.
 *
 * Topic groups are themselves paged, and `topicCount` reports the true total, so a centre that authors
 * more topics than one response carries can tell the difference between "these are all of them" and
 * "this is the first page" — rather than silently believing a truncated list was complete.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const channel: SpeakingChannel = params.get("channel") === "ai" ? "ai" : "practice_alone";
  const part = params.get("part");
  const search = (params.get("q") ?? "").trim().slice(0, 120);

  const facets = await speakingFacets({
    channel,
    ...(part ? { part } : {}),
    ...(search ? { search } : {}),
  });
  return NextResponse.json(facets, { headers: { "cache-control": "no-store" } });
}
