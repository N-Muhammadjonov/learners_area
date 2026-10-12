import {
  BRAND,
  BRAND_MARK,
  brandLogoFor,
  type BrandLogoKind,
} from "@/lib/config/brand";

/** Theme-specific transparent marks; original presentation masters stay intact.
 * CSS selects the variant on first paint without a hydration round trip. */
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
  if (kind === "horizontal") {
    return (
      <span
        className={`inline-flex items-center gap-3 ${className}`}
        data-brand-logo={kind}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
      >
        <BrandLogo
          kind="mark"
          className="h-full shrink-0"
          imgClassName={imgClassName}
          eager={eager}
          decorative
        />
        <span className="font-display text-2xl font-bold tracking-tight">
          {BRAND.siteName}
        </span>
      </span>
    );
  }

  /*
   * Screen sizes come from the derivative table, not from the master. The mark
   * master is 1254px and about 1.3 MB; the file actually served is a 96px
   * derivative of it (see scripts/build-brand-derivatives.mjs). Declared width
   * and height mean the browser reserves the box before the image arrives, so
   * nothing on the page shifts when it loads.
   */
  const sized = kind === "mark" ? BRAND_MARK : null;
  const dayAsset = sized ? sized.day.src : brandLogoFor(kind, "day");
  const nightAsset = sized ? sized.night.src : brandLogoFor(kind, "night");
  const dayAsset2x = sized ? sized.day.src2x : undefined;
  const nightAsset2x = sized ? sized.night.src2x : undefined;
  const intrinsic = sized
    ? { width: sized.day.width, height: sized.day.height }
    : {};
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
      <span
        className={`inline-flex items-center ${className}`}
        data-brand-logo={kind}
      >
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
    <span
      className={`inline-flex items-center ${className}`}
      data-brand-logo={kind}
    >
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
        srcSet={
          nightAsset2x ? `${nightAsset} 1x, ${nightAsset2x} 2x` : undefined
        }
        alt={label}
        aria-hidden={hidden}
        loading={loading}
        decoding="async"
        {...(sized ? { width: sized.night.width, height: sized.night.height } : intrinsic)}
        className={`brand-asset-dark h-full w-auto object-contain ${imgClassName}`}
      />
    </span>
  );
}
