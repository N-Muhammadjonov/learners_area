import { NextRequest } from "next/server";
import { handleObjectiveExplanation } from "@/lib/services/riwi/objective-explanation-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { return handleObjectiveExplanation(request); }
