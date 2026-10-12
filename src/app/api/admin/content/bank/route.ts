import { NextRequest, NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { contentBankVocabulary, searchContentBank } from "@/lib/content/bank";
import { isPublicationState } from "@/lib/services/cms/publication";

/**
 * GET /api/admin/content/bank
 *
 * The staff-facing content bank: every canonical content item, filtered by module,
 * content type, publication state, track, identity, title, date or version.
 *
 * Staff-only, and deliberately NOT a learner surface: it answers over drafts and
 * archived revisions too, which is exactly what a management view needs and exactly
 * what a learner read must never receive. Nothing here is a second store — the rows are
 * aggregated from `content_versions`.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const stateParam = params.get("state");
  const hasStateParam = params.get("hasState");
  const date = (value: string | null): Date | undefined => {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };
  const versionNo = params.get("versionNo");
  const limit = params.get("limit");
  const offset = params.get("offset");

  if (params.get("vocabulary") === "1") {
    const vocabulary = await contentBankVocabulary();
    return NextResponse.json({ ok: true, vocabulary }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const result = await searchContentBank({
    module: params.get("module") ?? undefined,
    contentType: params.get("contentType") ?? undefined,
    latestState: isPublicationState(stateParam) ? stateParam : undefined,
    hasState: isPublicationState(hasStateParam) ? hasStateParam : undefined,
    track: params.get("track") ?? undefined,
    sourceRef: params.get("sourceRef") ?? undefined,
    title: params.get("title") ?? undefined,
    q: params.get("q") ?? undefined,
    updatedFrom: date(params.get("from")),
    updatedTo: date(params.get("to")),
    versionNo: versionNo && /^\d+$/.test(versionNo) ? Number(versionNo) : undefined,
    limit: limit && /^\d+$/.test(limit) ? Number(limit) : undefined,
    offset: offset && /^\d+$/.test(offset) ? Number(offset) : undefined,
  });

  return NextResponse.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
