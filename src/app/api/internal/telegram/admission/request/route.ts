import { NextResponse, NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { createAccessRequest } from "@/lib/data/admission";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const { telegramUserId, name, message } = await req.json();
    if (!telegramUserId || !name) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    let user = await db.query.users.findFirst({
      where: eq(users.telegramId, telegramUserId)
    });

    if (!user) {
      const [newUser] = await db.insert(users).values({
        telegramId: telegramUserId,
        name: name,
        accountStatus: "pending",
      }).returning();
      user = newUser;
    }

    if (!user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // Create the access request
    const request = await createAccessRequest({
      userId: user.id,
      message: message,
    });

    return NextResponse.json({ success: true, requestId: request?.id, userId: user.id });
  } catch (error) {
    console.error("Internal telegram admission request error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
