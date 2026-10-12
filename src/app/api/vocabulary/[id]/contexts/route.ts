import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listVocabularyContexts } from "@/lib/services/vocabulary/engine";
import { isUuid } from "@/lib/validation/ids";

const headers = { "Cache-Control": "private, no-store" };

/** GET /api/vocabulary/:id/contexts — where the learner met this saved sense. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
  const result = await listVocabularyContexts(user.id, id);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  return NextResponse.json(result, { headers });
}
