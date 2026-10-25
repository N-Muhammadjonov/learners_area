"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandBlock } from "./BrandBlock";
import { SidebarNav } from "./SidebarNav";
import { ReportProblem } from "@/components/support/ReportProblem";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";

/**
 * Small-screen navigation.
 *
 * The desktop sidebar is `hidden` below `lg`, so without this there is literally
 * no way to move around the product on a phone. This is a real drawer: it closes
 * on Escape, on navigation and on a backdrop click, it locks background scroll
 * while open, and both the opening control and the close control are 44px-class
 * hit targets.
 *
 * It renders the *same* brand block and the *same* navigation list as the
 * desktop sidebar, so the two can never drift into showing different menus.
 */
export function MobileNav({ dict, role, email }: { dict: Dictionary; role: Role; email?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        data-mobile-nav-toggle
        aria-label={dict.nav.menu}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="shell-icon-btn md:hidden"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div data-mobile-nav-overlay className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={dict.nav.menu}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/50"
          />
          <div
            id="mobile-nav-drawer"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto border-r border-ink-100 bg-paper-raised px-4 py-5"
          >
            <div className="mb-6 flex items-start justify-between gap-3">
              <BrandBlock size={40} />
              <button type="button" aria-label={dict.common.cancel} onClick={() => setOpen(false)} className="shell-icon-btn -mr-1 -mt-1">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <SidebarNav dict={dict} role={role} email={email} />
            {/* The same contextual report form, reachable on a phone too. */}
            <div className="mt-6">
              <ReportProblem dict={dict} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
