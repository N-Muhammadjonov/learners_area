import { NextResponse, NextRequest } from "next/server";
import { db } from "@/db/client";
import { telegramLoginIntents } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const intent = await db.query.telegramLoginIntents.findFirst({
      where: eq(telegramLoginIntents.id, id),
      columns: {
        status: true,
        expiresAt: true,
      }
    });

    if (!intent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: intent.status,
      expired: new Date() > intent.expiresAt
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
