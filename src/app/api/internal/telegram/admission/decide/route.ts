import { NextResponse, NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { decideAccessRequest } from "@/lib/data/admission";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const { actorTelegramId, requestId, decision, note } = await req.json();
    if (!actorTelegramId || !requestId || !decision) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const actor = await db.query.users.findFirst({
      where: eq(users.telegramId, actorTelegramId)
    });

    if (!actor || (actor.role !== "admin" && actor.role !== "owner")) {
      return NextResponse.json({ error: "Unauthorized actor" }, { status: 403 });
    }

    const result = await decideAccessRequest({
      requestId,
      actorUserId: actor.id,
      decision,
      note
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: result.status });
  } catch (error) {
    console.error("Internal telegram admission decide error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
