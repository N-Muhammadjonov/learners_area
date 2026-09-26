import { NextResponse, NextRequest } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { listPendingAccessRequests } from "@/lib/data/admission";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const requests = await listPendingAccessRequests();
    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Internal telegram admission pending error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
