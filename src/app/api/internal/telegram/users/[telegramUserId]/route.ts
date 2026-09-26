import { NextResponse, NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";

export async function GET(req: NextRequest, { params }: { params: { telegramUserId: string } }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.telegramId, params.telegramUserId),
      columns: {
        id: true,
        role: true,
        name: true,
        accountStatus: true,
        locale: true,
      }
    });

    if (!user) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    return NextResponse.json({ found: true, user });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
