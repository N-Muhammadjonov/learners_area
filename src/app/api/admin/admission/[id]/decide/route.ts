import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/auth/current-user";
import { decideAccessRequest } from "@/lib/data/admission";

/**
 * POST /api/admin/admission/:id/decide — approve or reject one request.
 *
 * Authorization is re-derived from the database on every call, so a demoted or
 * suspended administrator loses this capability immediately even if their
 * browser still shows the button. The request id decides *who* is affected; the
 * body may only choose the decision and the note.
 */
const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).nullish(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requireAdministrator();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await decideAccessRequest({
    requestId: params.id,
    actorUserId: actor.id,
    decision: parsed.data.decision,
    note: parsed.data.note ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  }

  return NextResponse.json({ ok: true, status: result.status });
}
