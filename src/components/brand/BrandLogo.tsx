import { BRAND, BRAND_HORIZONTAL, BRAND_MARK, brandLogoFor, type BrandLogoKind } from "@/lib/config/brand";

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
  /*
   * Screen sizes come from the derivative table, not from the master. The mark
   * master is 1254px and about 1.3 MB; the file actually served is a 96px
   * derivative of it (see scripts/build-brand-derivatives.mjs). Declared width
   * and height mean the browser reserves the box before the image arrives, so
   * nothing on the page shifts when it loads.
   */
  const sized =
    kind === "mark" ? BRAND_MARK : kind === "horizontal" ? BRAND_HORIZONTAL : null;
  const dayAsset = sized ? sized.day.src : brandLogoFor(kind, "day");
  const nightAsset = sized ? sized.night.src : brandLogoFor(kind, "night");
  const dayAsset2x = sized ? sized.day.src2x : undefined;
  const nightAsset2x = sized ? sized.night.src2x : undefined;
  const intrinsic = sized ? { width: sized.day.width, height: sized.day.height } : {};
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
          srcSet={dayAsset2x ? `${dayAsset} 1x, ${dayAsset2x} 2x` : undefined}
          alt={label}
          aria-hidden={hidden}
          loading={loading}
          decoding="async"
          {...intrinsic}
          className={`h-full w-auto object-contain ${imgClassName}`}
        />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${className}`} data-brand-logo={kind}>
      <img
        src={dayAsset}
        srcSet={dayAsset2x ? `${dayAsset} 1x, ${dayAsset2x} 2x` : undefined}
        alt={label}
        aria-hidden={hidden}
        loading={loading}
        decoding="async"
        {...intrinsic}
        className={`brand-asset-light h-full w-auto object-contain ${imgClassName}`}
      />
      <img
        src={nightAsset}
        srcSet={nightAsset2x ? `${nightAsset} 1x, ${nightAsset2x} 2x` : undefined}
        alt={label}
        aria-hidden={hidden}
        loading={loading}
        decoding="async"
        {...intrinsic}
        className={`brand-asset-dark h-full w-auto object-contain ${imgClassName}`}
      />
    </span>
  );
}
