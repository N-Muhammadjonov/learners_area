import { NextRequest, NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/auth/current-user";
import { setRosterLink } from "@/lib/reporter/roster";

/**
 * POST /api/admin/roster — assign/unassign a student to a teacher's Reporter roster.
 * Owner/admin only (role re-read from the database). Form post; the response is a
 * redirect back to the roster page with a status word only (no raw codes shown).
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdministrator();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const teacherId = String(form?.get("teacherId") ?? "");
  const studentId = String(form?.get("studentId") ?? "");
  const action = String(form?.get("action") ?? "");
  if (action !== "assign" && action !== "unassign") return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await setRosterLink(actor, { teacherId, studentId, assigned: action === "assign" });
  const status = !result.ok ? "failed" : result.changed ? "saved" : "unchanged";
  const target = new URL("/admin/roster", req.url);
  if (/^[0-9a-f-]{36}$/i.test(teacherId)) target.searchParams.set("teacher", teacherId);
  target.searchParams.set("status", status);
  return NextResponse.redirect(target, 303);
}
