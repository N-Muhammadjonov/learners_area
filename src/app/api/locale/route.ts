import { NextRequest, NextResponse } from "next/server";
import { LOCALE_COOKIE, isLocale, localeCookieOptions } from "@/lib/i18n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, body.locale, localeCookieOptions(req));
  return res;
}
