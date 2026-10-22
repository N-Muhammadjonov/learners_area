"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Never replace a module's own Back/Breadcrumbs.
 * This is a separate explicit route back to the 3D campus. */
export function BackToCampus() {
  const pathname=usePathname();
  if (pathname === "/app" || !pathname.startsWith("/app/") ||
      /^\/app\/(?:admin|owner|teacher|management)(?:\/|$)/.test(pathname)) return null;
  return (
    <Link href="/app" prefetch={false} data-back-to-campus
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-950/70 px-3 py-2 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
      aria-label="3D xaritaga qaytish" title="Xaritaga qaytish">
      <span aria-hidden="true">↶</span>
      <span className="hidden sm:inline">Xaritaga qaytish</span>
      <span className="sm:hidden">Xarita</span>
    </Link>
  );
}
