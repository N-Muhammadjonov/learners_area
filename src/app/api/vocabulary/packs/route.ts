import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { addTopicPack } from "@/lib/services/vocabulary/engine";
import { findTopicPackForLearner, listTopicPacksForLearner } from "@/lib/content/vocabulary-packs";

/**
 * The authored packs a student can add in one action. Read from the database
 * (canonical content), so adding a pack is a content operation, not a deployment.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const packs = await listTopicPacksForLearner();
  return NextResponse.json({
    ok: true,
    packs: packs.map((pack) => ({
      id: pack.id,
      label: { en: pack.label, uz: pack.labelUz ?? pack.label },
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
  if (!parsed.success) return NextResponse.json({ error: "unknown_pack" }, { status: 400 });
  // Validated against the same list the learner was shown, so a pack that exists
  // in neither the database nor the built-in set is refused with the same answer.
  const pack = await findTopicPackForLearner(parsed.data.packId);
  if (!pack) return NextResponse.json({ error: "unknown_pack" }, { status: 400 });

  const result = await addTopicPack(user.id, parsed.data.packId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, added: result.added, duplicates: result.duplicates, points: result.points });
}
