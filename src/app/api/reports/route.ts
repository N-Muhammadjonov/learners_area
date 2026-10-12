import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { generateReport } from "@/lib/reporter/service";

export const dynamic = "force-dynamic";

/**
 * RIWI Reporter download. GET so a plain form/link can download; every call is
 * authorised for the signed-in, approved account (role read from the database),
 * audited, and returned privately (no-store). Unrelated to /api/support/reports.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const key of ["scope", "subject", "period", "from", "to", "format", "lang"]) {
    const v = q.get(key);
    if (v !== null && v !== "") raw[key] = v;
  }
  const result = await generateReport({ id: user.id, role: user.role, name: user.name }, raw);
  // Form submissions (ui=1) return to the page with a localised message instead of raw JSON.
  if (!result.ok && q.get("ui") === "1") {
    return new NextResponse(null, { status: 303, headers: { Location: `/app/reports?error=${encodeURIComponent(result.code)}`, "Cache-Control": "no-store" } });
  }
  if (!result.ok) return NextResponse.json({ error: { code: result.code } }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Report-Id": result.snapshot.reportId,
    },
  });
}
