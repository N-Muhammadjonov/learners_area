import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { abortUploadIntent } from "@/lib/data/uploads";

/**
 * DELETE /api/uploads/:id — cancel an in-flight or completed-but-unclaimed
 * upload. Marks the intent aborted and removes the object from storage, so a
 * cancelled upload does not leave an orphan (and a billable one) behind.
 *
 * Refuses to abort an intent that a resource already claims — that object is
 * live content, and deleting it would break a saved resource.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) return NextResponse.json({ error: "invalid_input" }, { status: 403 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const limited = enforce(RULES.uploadIntent, clientKey(req));
  if (limited) return limited;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const result = await abortUploadIntent(user.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: "cannot_abort" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
