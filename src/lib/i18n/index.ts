import { cookies } from "next/headers";
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

/** Server-side: read the visitor's locale cookie (defaults to Uzbek). */
export function getLocale(): Locale {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : "uz";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export const localeCookieOptions = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
};
