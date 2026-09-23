import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale, localeCookieOptions } from "@/lib/i18n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }
  cookies().set(LOCALE_COOKIE, body.locale, localeCookieOptions);
  return NextResponse.json({ ok: true });
}
