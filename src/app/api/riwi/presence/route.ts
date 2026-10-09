import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!checkRequestOrigin(request).allowed) return new NextResponse(null, { status: 403 });
  // Authoritative identity lookup records online use before returning the user.
  const user = await requireActiveUser();
  if (!user) return new NextResponse(null, { status: 401 });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
