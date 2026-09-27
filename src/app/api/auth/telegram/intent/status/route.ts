import { NextRequest, NextResponse } from "next/server";
import { readIntentStatus } from "@/lib/auth/telegram-intent";
import { isUuid } from "@/lib/validation/ids";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const nonce = req.nextUrl.searchParams.get("nonce");
  if (!id || !nonce || !isUuid(id)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const intent = await readIntentStatus(id, nonce);
    if (!intent) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ status: intent.status, expired: intent.expired });
  } catch (error) {
    console.error("[telegram] intent status failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
