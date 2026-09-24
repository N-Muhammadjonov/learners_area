import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { THEME_COOKIE, isTheme, type Theme } from "@/lib/theme";

/**
 * Persist the Day / Night preference server-side so the next page is rendered
 * in the right palette with no flash of the wrong theme.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const theme: Theme | null = isTheme(body?.theme) ? body.theme : null;
  if (!theme) return NextResponse.json({ error: "invalid_theme" }, { status: 400 });

  cookies().set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true, theme });
}
