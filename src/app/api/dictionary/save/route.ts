import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { saveDictionarySense } from "@/lib/dictionary/save";
import { apiError, privateHeaders } from "@/lib/dictionary/api";
const schema = z
  .object({
    lexemeId: z.string().uuid(),
    senseId: z.string().uuid(),
    releaseId: z.string().regex(/^rel-v1-[a-f0-9]{24}$/),
    folderId: z.string().uuid().nullable().default(null),
  })
  .strict();
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const b = parsed.data;
    const result = await saveDictionarySense(
      user.id,
      b.lexemeId,
      b.senseId,
      b.releaseId,
      b.folderId,
    );
    return NextResponse.json(result, {
      status: result.ok ? 200 : 404,
      headers: privateHeaders,
    });
  } catch (e) {
    return apiError(e);
  }
}
