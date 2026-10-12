import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { startListeningAttempt } from "@/lib/data/listening-attempt-write";
import { isUuid } from "@/lib/validation/ids";
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!detail.pkg.payload.questions.length)
    return NextResponse.json({ error: "authored_runtime_only" }, { status: 409 });
  const attemptId = await startListeningAttempt(user.id, id);
  return NextResponse.json(
    { id: attemptId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
