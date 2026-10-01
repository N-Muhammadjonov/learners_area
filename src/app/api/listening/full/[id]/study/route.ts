import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { gradePackage } from "@/lib/listening/package";
import { isUuid } from "@/lib/validation/ids";
const input = z.object({
  answers: z.record(
    z.string().regex(/^([1-9]|[1-3][0-9]|40)$/),
    z.string().max(500),
  ),
});
/** Self-study is never recorded as an IELTS attempt or used to unlock exam-only progress. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const detail = await fullListeningDetail(id, user.role);
  if (!detail)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (
    !parsed.success ||
    !Object.values(parsed.data.answers).some((value) => value.trim())
  )
    return NextResponse.json({ error: "answer_required" }, { status: 400 });
  const results = gradePackage(detail.pkg.payload, parsed.data.answers);
  return NextResponse.json(
    {
      score: results.filter((r) => r.correct).length,
      total: 40,
      results: results
        .filter((r) => parsed.data.answers[r.number]?.trim())
        .map((r) => ({
          ...r,
          key: detail.pkg.payload.questions.find((q) => q.number === r.number)!
            .key,
        })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
