import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listLivePartnerQuestions } from "@/lib/data/speaking-practice";

/**
 * Server-side search for the Live Partner question bank.
 *
 * The room shows one bounded page. Once a centre publishes more prompts than fit that
 * page, the rest are only reachable by narrowing against the full corpus here — the old
 * client-side filter could only ever see what had already been shipped to the browser.
 * Publication rules are applied in the query, so drafts can never surface.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const search = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  const page = await listLivePartnerQuestions(search ? { search } : {});
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
