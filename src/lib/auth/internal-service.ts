import "server-only";
import { NextResponse } from "next/server";

export function verifyInternalBotRequest(req: Request): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 });
  }

  const token = authHeader.substring(7);
  const secret = process.env.BOT_SERVICE_SECRET;

  if (!secret) {
    console.error("BOT_SERVICE_SECRET is not configured on the server");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return null; // OK
}
