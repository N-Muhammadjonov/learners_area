import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canRequestAccess } from "@/lib/auth/account-status";
import { createAccessRequest, findOpenRequestForUser } from "@/lib/data/admission";

/**
 * POST /api/admission/request — ask the centre for access.
 *
 * The applicant is taken from the authenticated session, never from the body:
 * there is no way to request access on someone else's behalf, and an applicant
 * cannot approve themselves because approval lives in a different route behind
 * an administrator check.
 */
const schema = z.object({ message: z.string().trim().max(1000).optional() });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!canRequestAccess(user.accountStatus)) {
    return NextResponse.json(
      { error: "not_eligible", status: user.accountStatus },
      { status: 409 }
    );
  }

  const existing = await findOpenRequestForUser(user.id);
  if (existing) return NextResponse.json({ ok: true, requestId: existing.id, alreadyOpen: true });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const request = await createAccessRequest({
    userId: user.id,
    message: parsed.success ? (parsed.data.message ?? null) : null,
  });

  return NextResponse.json({ ok: true, requestId: request?.id ?? null });
}
