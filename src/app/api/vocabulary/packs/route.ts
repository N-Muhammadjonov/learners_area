import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { addTopicPack } from "@/lib/services/vocabulary/engine";
import { TOPIC_PACKS, isPackId } from "@/lib/services/vocabulary/packs";

/** The authored packs a student can add in one action. */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    packs: TOPIC_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label,
      wordCount: pack.words.length,
    })),
  });
}

const schema = z.object({ packId: z.string().max(60) });

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isPackId(parsed.data.packId)) {
    return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  }

  const result = await addTopicPack(user.id, parsed.data.packId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, added: result.added, duplicates: result.duplicates, points: result.points });
}
