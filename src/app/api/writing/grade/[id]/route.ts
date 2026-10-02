import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { runGrade } from "@/lib/services/writing/grade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/writing/grade/:id — learner-initiated retry of a saved essay. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const outcome = await runGrade(id, user.id, await getLocale());
  if (outcome.ok) return NextResponse.json({ ok: true, id, status: "evaluated" });
  if (outcome.error === "not_found") return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  const retryable = outcome.error !== "external_required";
  return NextResponse.json({ ok: false, id, status: outcome.error === "in_progress" ? "pending" : "failed", error: { code: outcome.error, message: "AI grading did not complete. Your essay is saved.", retryable } });
}
