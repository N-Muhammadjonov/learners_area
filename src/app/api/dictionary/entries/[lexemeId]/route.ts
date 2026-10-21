import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  pinnedRelease,
  entryById,
  rememberSearch,
} from "@/lib/dictionary/store";
import { savedSenseIds } from "@/lib/dictionary/save";
import { apiError, privateHeaders } from "@/lib/dictionary/api";
import {dictionaryPresentation} from "@/lib/dictionary/presentation";
import { isUuid } from "@/lib/validation/ids";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ lexemeId: string }> },
) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: privateHeaders },
    );
  const { lexemeId } = await params;
  if (!isUuid(lexemeId))
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const release = await pinnedRelease(
      req.nextUrl.searchParams.get("release_id"),
    );
    const entry = await entryById(lexemeId, release);
    if (!entry)
      return NextResponse.json(
        { error: "entry_not_found" },
        { status: 404, headers: privateHeaders },
      );
    const saved = await savedSenseIds(
      user.id,
      entry.senses.map((s) => s.sense_id),
    );
    return NextResponse.json(
      { entry, presentation:dictionaryPresentation(entry), saved: saved.map((s) => s.sense_id) },
      { headers: privateHeaders },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ lexemeId: string }> },
) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { lexemeId } = await params;
  const b = await req.json().catch(() => null);
  if (
    !isUuid(lexemeId) ||
    !b ||
    typeof b.query !== "string" ||
    b.query.length > 80 ||
    !["EN", "UZ"].includes(b.direction) ||
    typeof b.releaseId !== "string"
  )
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const release = await pinnedRelease(b.releaseId);
    if (!(await entryById(lexemeId, release)))
      return NextResponse.json({ error: "entry_not_found" }, { status: 404 });
    await rememberSearch(user.id, b.query, b.direction, lexemeId);
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (e) {
    return apiError(e);
  }
}
