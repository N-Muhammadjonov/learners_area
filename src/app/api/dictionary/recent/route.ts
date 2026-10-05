import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { recentSearches, clearRecentSearches } from "@/lib/dictionary/store";
import { apiError, privateHeaders } from "@/lib/dictionary/api";
export async function GET() {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    return NextResponse.json(
      { recent: await recentSearches(user.id) },
      { headers: privateHeaders },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function DELETE() {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    await clearRecentSearches(user.id);
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (e) {
    return apiError(e);
  }
}
