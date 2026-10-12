import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { lexicalAssistanceAllowed, modeForListeningProduct } from "@/lib/listening/lexical-policy";
import { listeningProductOf } from "@/lib/data/listening-product";
import { isUuid } from "@/lib/validation/ids";
const headers = { "Cache-Control": "private, no-store" };
/**
 * Spelling-only lookup for a Listening word that has no occurrence.
 *
 * A spelling alone cannot say which sense the speaker meant ("bank" of a river
 * vs. a bank account), so this route never returns a catalogue meaning. It only
 * confirms access and answers `unresolved`; the UI shows "Meaning not checked yet".
 * Words with a checked sense are resolved through /api/vocabulary/lookup by occurrence.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const sourceId = req.nextUrl.searchParams.get("sourceId") ?? "";
  const term = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!isUuid(sourceId) || !term || term.length > 120) return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
  try {
    const detail = await fullListeningDetail(sourceId, user.role);
    if (!detail) return NextResponse.json({ error: "source_not_found" }, { status: 404, headers });
    // The source's own product decides the mode: a General section is a learning activity, an
    // Academic full test with an attempt in progress stays sealed.
    if (!lexicalAssistanceAllowed(modeForListeningProduct((await listeningProductOf(sourceId)) ?? "unclassified"), await listeningExamState(user, sourceId)))
      return NextResponse.json({ error: "lexical_assistance_locked" }, { status: 403, headers });
    return NextResponse.json({ status: "unresolved", contextual: null }, { headers });
  } catch {
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers });
  }
}
