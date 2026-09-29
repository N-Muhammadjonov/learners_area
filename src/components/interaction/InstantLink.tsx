import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Internal link contract: keep Next's URL/history/deep-link behavior and let
 * automatic prefetch stop at the nearest static loading boundary. Private page
 * data is never moved into a client-side shared cache by this primitive.
 */
export function InstantLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={prefetch ?? null} data-instant-navigation />;
}
