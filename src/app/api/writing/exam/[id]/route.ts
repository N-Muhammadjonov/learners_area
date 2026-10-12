import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { getExamPaper } from "@/lib/services/writing/exam";

export const dynamic = "force-dynamic";

/** GET /api/writing/exam/:id — the paper with the server-derived remaining seconds. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const paper = isUuid(id) ? await getExamPaper(user.id, id) : null;
  if (!paper) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  return NextResponse.json({ ok: true, paper }, { headers: { "cache-control": "no-store" } });
}
