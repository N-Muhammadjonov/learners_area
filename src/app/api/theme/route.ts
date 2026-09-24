import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "@/components/shell/ThemeToggle";

/**
 * Persist the Day / Night preference server-side so the next page is rendered
 * in the right palette with no flash of the wrong theme.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const theme: Theme | null =
    body?.theme === "night" ? "night" : body?.theme === "day" ? "day" : null;
  if (!theme) return NextResponse.json({ error: "invalid_theme" }, { status: 400 });

  cookies().set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true, theme });
}
