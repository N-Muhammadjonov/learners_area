/**
 * Product identity in one place.
 *
 * The centre may be renamed or sold, so the visible name must be configuration
 * rather than a string copied into a hundred components. Nothing here is a
 * secret: these are display strings and public asset paths, and they deliberately
 * cannot change database relations, routes, provider ids or stored history. An
 * evaluation always keeps the evaluator name it was produced under.
 *
 * Server and client may both read this module (it holds no secret), which is why
 * the name is exposed as a *public* variable while every credential stays in the
 * server-only modules.
 *
 * ---------------------------------------------------------------------------
 * Brand artwork
 * ---------------------------------------------------------------------------
 * Six approved files live in ONE canonical directory, `public/brand/`, and their
 * paths are written down exactly once — here. No component may build a logo path
 * itself: swapping an asset later is editing one line in this file, not a search
 * across the codebase.
 *
 * The supplied artwork is final. Nothing in this application recolours, traces,
 * inverts, filters or re-exports it; where a theme needs a different look, the
 * theme picks a different supplied file (`logoMarkDark` vs `logoMarkLight`).
 *
 * The two families exist for a reason:
 *
 *   mark       compact square, for the sidebar and the mobile drawer, where a
 *              wordmark would not fit;
 *   horizontal lock-up with the wordmark, for authentication screens and wide
 *              headers, where there is room to read the name;
 *   master     the full presentation artwork, used where the brand is the
 *              subject rather than part of a navigation row (the owner's brand
 *              preview and the documentation).
 */

export type Brand = {
  /** Full product name shown in the shell, page titles and emails. */
  siteName: string;
  /** Compact name for tight spaces (mobile header, badges). */
  siteShortName: string;
  /** One-letter mark, kept as a last-resort fallback (see BrandLogo). */
  initial: string;
  /** Visible name of the internal evaluator. Stored per evaluation, never re-read. */
  aiDisplayName: string;
  /** Support contact shown to students; empty string hides it. */
  supportEmail: string;
  /** Public Telegram contact/channel; empty string hides it. */
  telegramContact: string;
  /** Public marketing strapline. */
  tagline: string;
  /** The sentence that sits under the name in the sidebar brand block. */
  brandLine: string;
};

/**
 * The six approved assets, by purpose. Keys are purposes, not filenames: a
 * future rename of a file changes the value here and nothing else.
 */
export type BrandAssets = {
  /** Full master artwork — brand presentation, never compact navigation. */
  logoMasterDark: string;
  /** Compact mark for dark/night surfaces. */
  logoMarkDark: string;
  /** Compact mark for light/day surfaces. */
  logoMarkLight: string;
  /** Wordmark lock-up for wide dark/night surfaces. */
  logoHorizontalDark: string;
  /** Wordmark lock-up for wide light/day surfaces. */
  logoHorizontalLight: string;
  /** Browser identity: tab icon, home-screen icon. */
  favicon: string;
};

/** One canonical directory for approved brand artwork. */
export const BRAND_ASSET_DIR = "/brand";

export const BRAND_ASSETS: BrandAssets = {
  logoMasterDark: `${BRAND_ASSET_DIR}/learners-area-logo-master-dark.png`,
  logoMarkDark: `${BRAND_ASSET_DIR}/learners-area-logo-mark-dark.png`,
  logoMarkLight: `${BRAND_ASSET_DIR}/learners-area-logo-mark-light.png`,
  logoHorizontalDark: `${BRAND_ASSET_DIR}/learners-area-logo-horizontal-dark.png`,
  logoHorizontalLight: `${BRAND_ASSET_DIR}/learners-area-logo-horizontal-light.png`,
  favicon: `${BRAND_ASSET_DIR}/learners-area-favicon.png`,
};

/** The artwork families the interface asks for by purpose. */
export type BrandLogoKind = "mark" | "horizontal" | "master";

/** Which theme's artwork a surface needs. */
export type BrandTheme = "day" | "night";

/**
 * Resolves the supplied file for a purpose and a theme.
 *
 * `master` has one supplied variant, so it is returned for both themes rather
 * than synthesised from the other.
 */
export function brandLogoFor(kind: BrandLogoKind, theme: BrandTheme): string {
  switch (kind) {
    case "mark":
      return theme === "night" ? BRAND_ASSETS.logoMarkDark : BRAND_ASSETS.logoMarkLight;
    case "horizontal":
      return theme === "night" ? BRAND_ASSETS.logoHorizontalDark : BRAND_ASSETS.logoHorizontalLight;
    case "master":
      return BRAND_ASSETS.logoMasterDark;
  }
}

/** Every approved asset path, for the audit check and the owner's brand preview. */
export function allBrandAssets(): { key: keyof BrandAssets; path: string }[] {
  return (Object.keys(BRAND_ASSETS) as (keyof BrandAssets)[]).map((key) => ({ key, path: BRAND_ASSETS[key] }));
}

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
    brandLine: readEnv("NEXT_PUBLIC_BRAND_LINE", "Take your learning journey with us"),
  };
}

/** Convenience for server components that only need the name. */
export const BRAND = getBrand();
