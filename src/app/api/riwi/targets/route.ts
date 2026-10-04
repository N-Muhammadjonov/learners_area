import { NextRequest } from "next/server";
import { handleRiwiTargetsGet } from "@/lib/services/riwi/targets-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleRiwiTargetsGet(request);
}
