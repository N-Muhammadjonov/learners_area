import type { Locale } from "@/lib/i18n";

/**
 * One timezone, one formatter.
 *
 * Everything is stored in UTC (`timestamp with time zone`), and everything is
 * *displayed* in the centre's timezone: Asia/Tashkent (UTC+5, no daylight
 * saving). Doing this in one place matters for a concrete reason beyond
 * tidiness — `toLocaleString()` on a server-rendered page uses the *server's*
 * timezone, so a student in Tashkent would see a live class scheduled in UTC
 * until React hydrated the page. An explicit `timeZone` makes the server and the
 * browser agree, and keeps UZ/EN formatting consistent.
 *
 * The same constant is what the vocabulary points ledger and the grammar mastery
 * rules use to decide which calendar day an action belongs to, so "a new day"
 * means the same thing everywhere.
 */
export const TIMEZONE = "Asia/Tashkent";

function formatter(options: Intl.DateTimeFormatOptions, locale?: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : locale === "en" ? "en-GB" : undefined, {
    timeZone: TIMEZONE,
    ...options,
  });
}

/** `2026-09-26 14:30` in the centre's timezone. */
export function formatDateTime(value: Date | string | number, locale?: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatter({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }, locale).format(date);
}

/** `26/09/2026` (locale-dependent) in the centre's timezone. */
export function formatDate(value: Date | string | number, locale?: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatter({ year: "numeric", month: "2-digit", day: "2-digit" }, locale).format(date);
}

/** `14:30` in the centre's timezone. */
export function formatTime(value: Date | string | number, locale?: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatter({ hour: "2-digit", minute: "2-digit" }, locale).format(date);
}

/** The calendar day (`YYYY-MM-DD`) a moment belongs to, in the centre's timezone. */
export function tashkentDayKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = formatter({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
