import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startListeningAttempt } from "@/lib/data/listening-attempt-write";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStartableTest } from "@/lib/data/listening";

const schema = z.object({ testId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  if(!await listeningSequenceAccess(user,parsed.data.testId))return NextResponse.json({error:'sequence_locked'},{status:403});
  const test = await getStartableTest(parsed.data.testId);
  if (!test) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const id = await startListeningAttempt(user.id, parsed.data.testId);
  if (!id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ id });
}
