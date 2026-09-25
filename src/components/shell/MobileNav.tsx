"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./Sidebar";
import { ReportProblem } from "@/components/support/ReportProblem";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/session";

/**
 * Small-screen navigation.
 *
 * The desktop sidebar is `hidden` below `md`, so without this there is
 * literally no way to move around the app on a phone. This is a real drawer:
 * an overlay that closes on Escape, on navigation, and on backdrop click, with
 * background scroll locked while it is open, and a 44px-class hit target.
 */
export function MobileNav({ dict, role }: { dict: Dictionary; role: Role }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={dict.nav.menu}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-sm border border-ink-100 text-ink-600 hover:bg-paper-sunken hover:text-ink-900 md:hidden"
      >
        <span aria-hidden className="text-lg leading-none">
          ☰
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={dict.nav.menu}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/40"
          />
          <div
            id="mobile-nav-drawer"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-ink-100 bg-paper-raised p-4"
          >
            <div className="flex items-start justify-between">
              <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-signal-600 font-display text-sm text-white">
                  L
                </span>
                <span className="font-display text-lg text-ink-900">{dict.marketing.title}</span>
              </Link>
              <button
                type="button"
                aria-label={dict.common.cancel}
                onClick={() => setOpen(false)}
                className="mb-6 -mr-1 flex h-10 w-10 items-center justify-center rounded-sm text-ink-400 hover:bg-paper-sunken hover:text-ink-900"
              >
                <span aria-hidden className="text-lg leading-none">
                  ✕
                </span>
              </button>
            </div>
            <SidebarNav dict={dict} role={role} />
            {/* The same contextual report form, reachable on a phone too. */}
            <ReportProblem dict={dict} />
          </div>
        </div>
      )}
    </>
  );
}
