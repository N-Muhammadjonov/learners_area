import { submitGrammarObjective } from "@/lib/data/grammar-attempt-write";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const result = await submitGrammarObjective(user.id, id, body);
  return result.ok ? NextResponse.json(result)
    : NextResponse.json({ error: result.error }, { status: result.status });
}
