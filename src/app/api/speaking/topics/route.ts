import { NextRequest, NextResponse } from "next/server";
import { actorOf, requireAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { speakingTopicDraft, speakingTopicIdentity } from "@/lib/speaking/topic-draft";
import { manageSpeakingTopic, SpeakingTopicConflict } from "@/lib/speaking/manage-topic";
export async function POST(req: NextRequest) {
  if (!await requireActiveUser()) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!await requireAdministrator()) return NextResponse.json({error:"forbidden"},{status:403});
  const parsed = speakingTopicDraft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error:"invalid_input"},{status:400});
  try { return NextResponse.json({ok:true, prompts:await manageSpeakingTopic(parsed.data)}); }
  catch (e) { if (e instanceof SpeakingTopicConflict) return NextResponse.json({error:"topic_conflict"},{status:409}); throw e; }
}
export async function DELETE(req: NextRequest) {
  if (!await requireActiveUser()) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!await requireAdministrator()) return NextResponse.json({error:"forbidden"},{status:403});
  const parsed = speakingTopicIdentity.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error:"invalid_input"},{status:400});
  const administrator=await requireAdministrator();
  if(!administrator)return NextResponse.json({error:"forbidden"},{status:403});
  try { await manageSpeakingTopic({archive:parsed.data,actor:actorOf(administrator)}); return NextResponse.json({ok:true}); }
  catch (e) { if (e instanceof SpeakingTopicConflict) return NextResponse.json({error:"topic_conflict"},{status:409}); throw e; }
}
