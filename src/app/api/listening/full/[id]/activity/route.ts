import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { listeningActivityRuns } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  allowedListeningSpeeds,
  listeningExamState,
  fullListeningDetail,
} from "@/lib/data/full-listening";
import { gradePackage, normalized } from "@/lib/listening/package";
import { isUuid } from "@/lib/validation/ids";
const schema = z.object({
  activity: z.number().int().min(2).max(5),
  answers: z.record(z.string().max(20), z.string().max(4000)),
  complete: z.boolean(),
  speedRate: z.number().optional(),
});
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
  if (!detail.pkg.payload.questions.length)
    return NextResponse.json({ error: "authored_runtime_only" }, { status: 409 });
  if ((await listeningExamState(user, id)).examInProgress)
    return NextResponse.json({ error: "exam_in_progress" }, { status: 409 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { activity, answers, complete, speedRate } = parsed.data;
  const p = detail.pkg.payload;
  const ids =
    activity === 2
      ? p.questions.map((q) => String(q.number))
      : activity === 3
        ? p.keyword1.map((q) => String(q.q))
        : activity === 4
          ? p.studyPack ? p.studyPack.recall.map(part => String(part.part)) : p.keyword2.map((q) => String(q.q))
          : p.vocabulary.flatMap((x, i) => x.quiz ? [String(i)] : []);
  if (Object.keys(answers).some((n) => !ids.includes(n)))
    return NextResponse.json({ error: "foreign_question" }, { status: 400 });
  if (complete && ids.some((n) => !answers[n]?.trim()))
    return NextResponse.json({ error: "answer_every_item" }, { status: 400 });
  if (
    speedRate !== undefined &&
    (activity !== 2 ||
      !(await allowedListeningSpeeds(user.id, id)).includes(speedRate))
  )
    return NextResponse.json({ error: "speed_locked" }, { status: 403 });
  let score: number | null = null;
  if (complete) {
    if (activity === 2)
      score =
        speedRate === undefined
          ? ids.length
          : gradePackage(p, answers).filter((x) => x.correct).length;
    else if (activity === 3)
      score = p.keyword1.filter(
        (x) =>
          normalized(answers[x.q] ?? "") === normalized(x.link.split(";")[0]!),
      ).length;
    else if (activity === 4 && p.studyPack) score = null;
    else if (activity === 4)
      score = p.keyword2.filter(
        (x) => "correct" in x ? answers[x.q] === String(x.correct) : normalized(answers[x.q] ?? "") === normalized(x.answer),
      ).length;
    else
      score = p.vocabulary.filter(
        (x, i) => x.quiz ? answers[i] === String(x.quiz.correct) : false,
      ).length;
  }
  const [run] = await db
    .insert(listeningActivityRuns)
    .values({
      userId: user.id,
      testId: id,
      activity,
      speedRate: speedRate ?? null,
      answers,
      completed: complete,
      score,
      total: ids.length,
    })
    .returning({ id: listeningActivityRuns.id });
  return NextResponse.json(
    { ok: true, id: run!.id, score, total: ids.length },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
