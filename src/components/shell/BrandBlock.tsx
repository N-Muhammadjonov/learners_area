import type { ReactNode } from "react";
import { BRAND, BRAND_MARK } from "@/lib/config/brand";

/**
 * The brand block: the approved mark, then the name and the line under it as
 * real text.
 *
 * Why text and not the horizontal wordmark file: the name is the navigation
 * label of the whole product, and a product name that exists only as pixels is
 * invisible to a screen reader, unselectable, untranslatable, blurry on a
 * fractional-DPI screen and stale the moment somebody renames the centre. The
 * approved artwork is used where it belongs — as the mark.
 *
 * Sizing is deliberate: the mark is displayed at 40–44px, and the file behind it
 * is a 96px derivative of the approved master (`BRAND_MARK`), not the 1254px
 * original. Intrinsic width and height are declared, so the space is reserved
 * before the image arrives and nothing on the page jumps when it loads.
 *
 * Both supplied theme variants are rendered and CSS picks one from
 * `[data-theme]` on `<html>` — which the server set before the first byte. The
 * correct mark is therefore on screen at first paint, with no flash and no
 * hydration step, and neither file is filtered or recoloured to fake the other.
 */
export function BrandBlock({
  className = "",
  size = 44,
  withTagline = true,
  nameSuffix,
}: {
  className?: string;
  /** Display size of the mark in CSS pixels (40–44 on desktop). */
  size?: number;
  withTagline?: boolean;
  /** Optional inline action icon next to the wordmark; only auth pages use it. */
  nameSuffix?: ReactNode;
}) {
  const day = BRAND_MARK.day;
  const night = BRAND_MARK.night;

  /* eslint-disable @next/next/no-img-element */
  return (
    <span className={`flex items-center gap-3 ${className}`} data-sidebar-brand>
      <span className="brand-mark" style={{ width: size, height: size }}>
        <img
          src={day.src}
          srcSet={`${day.src} 1x, ${day.src2x} 2x`}
          width={day.width}
          height={day.height}
          alt=""
          aria-hidden
          decoding="async"
          fetchPriority="high"
          className="brand-asset-light"
        />
        <img
          src={night.src}
          srcSet={`${night.src} 1x, ${night.src2x} 2x`}
          width={night.width}
          height={night.height}
          alt=""
          aria-hidden
          decoding="async"
          fetchPriority="high"
          className="brand-asset-dark"
        />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="brand-name">{BRAND.siteName}{nameSuffix}</span>
        {withTagline && <span className="brand-tagline">{BRAND.brandLine}</span>}
      </span>
    </span>
  );
}
