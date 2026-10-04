import { NextRequest } from "next/server";
import { handleRiwiChatPost } from "@/lib/services/riwi/chat-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleRiwiChatPost(request);
}
