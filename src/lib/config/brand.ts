/**
 * Product identity in one place.
 *
 * The centre may be renamed or sold, so the visible name must be configuration
 * rather than a string copied into a hundred components. Nothing here is a
 * secret: these are display strings, and they deliberately cannot change
 * database relations, routes, provider ids or stored history. An evaluation
 * always keeps the evaluator name it was produced under.
 *
 * Server and client may both read this module (it holds no secret), which is why
 * the name is exposed as a *public* variable while every credential stays in the
 * server-only modules.
 */

export type Brand = {
  /** Full product name shown in the shell, page titles and emails. */
  siteName: string;
  /** Compact name for tight spaces (mobile header, badges). */
  siteShortName: string;
  /** One-letter mark used in the logo square. */
  initial: string;
  /** Visible name of the internal evaluator. Stored per evaluation, never re-read. */
  aiDisplayName: string;
  /** Support contact shown to students; empty string hides it. */
  supportEmail: string;
  /** Public Telegram contact/channel; empty string hides it. */
  telegramContact: string;
  /** Public marketing strapline. */
  tagline: string;
};

function readEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export function getBrand(): Brand {
  const siteName = readEnv("NEXT_PUBLIC_SITE_NAME", "Learners Area");
  return {
    siteName,
    siteShortName: readEnv("NEXT_PUBLIC_SITE_SHORT_NAME", siteName),
    initial: siteName.trim().charAt(0).toUpperCase() || "L",
    aiDisplayName: readEnv("AI_DISPLAY_NAME", "RIWI"),
    supportEmail: readEnv("NEXT_PUBLIC_SUPPORT_EMAIL", ""),
    telegramContact: readEnv("NEXT_PUBLIC_TELEGRAM_CONTACT", ""),
    tagline: readEnv("NEXT_PUBLIC_TAGLINE", "Bilingual IELTS preparation inside a private centre."),
  };
}

/** Convenience for server components that only need the name. */
export const BRAND = getBrand();
