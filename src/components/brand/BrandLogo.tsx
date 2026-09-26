import { BRAND, brandLogoFor, type BrandLogoKind } from "@/lib/config/brand";

/**
 * The one component that renders approved Learners Area artwork.
 *
 * Every placement — sidebar, mobile drawer, auth pages, brand preview — goes
 * through here, so the asset paths live in `BrandConfig` and nowhere else.
 *
 * How the theme switch works, and why it is done this way:
 *
 *   Both supplied variants are rendered and the *theme* picks one in CSS
 *   (`[data-theme="night"]` is on `<html>`, set on the server before the first
 *   byte). That means the correct file is displayed on first paint with no
 *   hydration step, and toggling Day/Night swaps the artwork instantly without a
 *   round trip, a re-fetch or a moment where the image is missing. The artwork
 *   itself is never touched: no `filter: invert()`, no recolouring, no generated
 *   variant — the light theme shows the supplied light file, the dark theme shows
 *   the supplied dark file.
 *
 * Sizing: the height comes from the caller's classes, the width follows the real
 * aspect ratio (`w-auto`), and `object-contain` guarantees no stretching.
 */
export function BrandLogo({
  kind = "mark",
  className = "",
  imgClassName = "",
  alt,
  eager = false,
  decorative = false,
}: {
  kind?: BrandLogoKind;
  /** Classes for the wrapper (put the height here). */
  className?: string;
  /** Extra classes for the image itself. */
  imgClassName?: string;
  /** Overrides the accessible name; defaults to the configured site name. */
  alt?: string;
  /** Above-the-fold artwork should not wait for lazy loading. */
  eager?: boolean;
  /** True when the artwork repeats a text label that is already announced. */
  decorative?: boolean;
}) {
  const label = decorative ? "" : (alt ?? BRAND.siteName);
  const dayAsset = brandLogoFor(kind, "day");
  const nightAsset = brandLogoFor(kind, "night");
  const hidden = decorative ? (true as const) : undefined;
  const loading = eager ? ("eager" as const) : ("lazy" as const);
  /*
   * A plain <img>, on purpose.
   *
   * The artwork is already exactly the size it is displayed at and is served
   * from our own origin, so the image optimizer would add a request, a cache
   * layer and a re-encode of an approved file for nothing. Declared here rather
   * than loosened globally: every other image in the project still has to face
   * the rule.
   */
  /* eslint-disable @next/next/no-img-element */

  // The master artwork is supplied once; there is no second variant to swap in.
  if (dayAsset === nightAsset) {
    return (
      <span className={`inline-flex items-center ${className}`} data-brand-logo={kind}>
        <img
          src={dayAsset}
          alt={label}
          aria-hidden={hidden}
          loading={loading}
          decoding="async"
          className={`h-full w-auto object-contain ${imgClassName}`}
        />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${className}`} data-brand-logo={kind}>
      <img
        src={dayAsset}
        alt={label}
        aria-hidden={hidden}
        loading={loading}
        decoding="async"
        className={`brand-asset-light h-full w-auto object-contain ${imgClassName}`}
      />
      <img
        src={nightAsset}
        alt={label}
        aria-hidden={hidden}
        loading={loading}
        decoding="async"
        className={`brand-asset-dark h-full w-auto object-contain ${imgClassName}`}
      />
    </span>
  );
}
