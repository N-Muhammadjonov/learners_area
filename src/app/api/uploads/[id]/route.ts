import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { abortUploadIntent } from "@/lib/data/uploads";

/**
 * DELETE /api/uploads/:id — cancel an in-flight or completed-but-unclaimed
 * upload. Marks the intent aborted and removes the object from storage, so a
 * cancelled upload does not leave an orphan (and a billable one) behind.
 *
 * Refuses to abort an intent that a resource already claims — that object is
 * live content, and deleting it would break a saved resource.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await abortUploadIntent(session.sub, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: "cannot_abort" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
