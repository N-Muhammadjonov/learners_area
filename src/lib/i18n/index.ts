import { cookiePolicyForRequest, type RequestLike } from "@/lib/auth/cookie-policy";
import en from "./en";
import uz from "./uz";
import type { Dictionary } from "./en";

export const LOCALE_COOKIE = "la_locale";
export const LOCALES = ["uz", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const dictionaries: Record<Locale, Dictionary> = { en, uz };

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Read an explicitly supplied cookie header in operator/test tools. */
export async function getLocale(cookieHeader = ""): Promise<Locale> {
  const raw = /(?:^|;\s*)la_locale=([^;]*)/.exec(cookieHeader)?.[1];
  return isLocale(raw) ? raw : "uz";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/**
 * The language preference, with the same transport rules as the session cookie
 * (see src/lib/auth/cookie-policy.ts) — a `Lax` cookie is not stored inside the
 * preview's cross-site frame, and then the interface would silently forget the
 * language the student chose.
 */
export function localeCookieOptions(req: RequestLike) {
  return {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    ...cookiePolicyForRequest(req),
  };
}
