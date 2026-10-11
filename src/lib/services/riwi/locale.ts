import type { Locale } from "@/lib/i18n";

/** A language preference changes presentation only, never identity or scope. */
export function riwiPresentationLocale(preference: string | undefined, profile: string | null | undefined): Locale {
  if (preference === "en" || preference === "uz") return preference;
  return profile === "en" ? "en" : "uz";
}

export function riwiLocaleFromRequest(request: Request, profile: string | null | undefined): Locale {
  const preference = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("la_locale="))?.slice("la_locale=".length);
  return riwiPresentationLocale(preference, profile);
}
