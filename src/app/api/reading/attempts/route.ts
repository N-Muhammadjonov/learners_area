import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startReadingAttempt } from "@/lib/data/reading-attempt-write";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStartablePassage } from "@/lib/data/reading";

const schema = z.object({ passageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // A passage that is a draft, not yet due, or archived is not startable — and
  // the answer is the same 404 as a passage that does not exist, so a withdrawn
  // name cannot be probed for. An attempt that already exists stays readable.
  const passage = await getStartablePassage(parsed.data.passageId);
  if (!passage) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const id = await startReadingAttempt(user.id, parsed.data.passageId);
  if (!id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ id });
}
