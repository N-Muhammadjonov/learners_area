"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isManagementRoute } from "@/lib/nav/mode";

/** A real Main link also works after opening a module directly or refreshing. */
export function BackToCampus() {
  const pathname = usePathname().replace(/\/+$/, "");
  if (!pathname.startsWith("/app/") || isManagementRoute(pathname)) return null;
  return (
    <Link href="/app" prefetch={false} data-back-to-campus
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-ink-100 bg-paper-raised px-3 py-2 text-sm font-semibold text-ink-900 transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-600"
      aria-label="Main">
      <span aria-hidden="true">←</span>
      <span>Main</span>
    </Link>
  );
}
