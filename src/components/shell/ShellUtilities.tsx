"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { FOCUS_STORAGE_KEY } from "@/lib/theme";
import { isManagementRoute } from "./Sidebar";
import { ReportProblem } from "@/components/support/ReportProblem";
import { IconClose, IconSparkles, IconTarget } from "@/components/ui/icons";

export { FOCUS_STORAGE_KEY };

/**
 * Focus mode — and it now does something you can see.
 *
 * The old toggle flipped an attribute and hid a couple of decorative blocks,
 * which is why the owner reported it as "unclear what it does". Focus now:
 *
 *   * appears only where focusing is useful — a practice or attempt route. It is
 *     deliberately absent from Management, People, Audit and Settings, where
 *     hiding navigation would just be a way to get lost;
 *   * removes the sidebar and the non-essential topbar controls and centres the
 *     workspace on a comfortable measure;
 *   * states its own name: the control reads "Focus mode" before you press it
 *     and "Exit Focus" while it is on, and a small badge says Focus ON;
 *   * can always be left — the button stays visible, and so does Escape. A
 *     student can never be trapped in a chrome-less screen.
 *
 * `F` toggles it too, but only when the keystroke is not going into a field: a
 * student typing the letter f into an answer must not lose their navigation.
 *
 * The preference is a UI choice and lives in localStorage — never in anything
 * that could be mistaken for progress, and it is re-read on every mount, so a
 * hard refresh can never strand someone in a hidden-navigation state.
 */

/** Routes where hiding the chrome genuinely helps. */
const FOCUS_ROUTES = [
  "/reading",
  "/listening",
  "/writing",
  "/speaking",
  "/grammar",
  "/vocabulary",
  "/mocks",
  "/coach",
];

export function ShellUtilities({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const [on, setOn] = useState(false);

  const useful = FOCUS_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`)) && !isManagementRoute(pathname);

  useEffect(() => {
    const stored = window.localStorage.getItem(FOCUS_STORAGE_KEY) === "on";
    setOn(stored && useful);
    document.documentElement.dataset.focus = stored && useful ? "on" : "off";
  }, [useful, pathname]);

  // Leaving a practice route must not leave the shell in a hidden state.
  useEffect(() => {
    if (!useful) {
      document.documentElement.dataset.focus = "off";
    }
  }, [useful]);

  useEffect(() => {
    if (!useful) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (typing) return;
      if (event.key === "Escape" && document.documentElement.dataset.focus === "on") {
        setFocus(false);
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setFocus(document.documentElement.dataset.focus !== "on");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function setFocus(next: boolean) {
    setOn(next);
    document.documentElement.dataset.focus = next ? "on" : "off";
    window.localStorage.setItem(FOCUS_STORAGE_KEY, next ? "on" : "off");
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 flex flex-col items-end gap-2"
      style={{ zIndex: "var(--z-sticky)" }}
      data-shell-utilities
    >
      {on && (
        <span className="pointer-events-auto rounded-full border border-gold/50 bg-paper-raised px-3 py-1 text-[0.75rem] font-semibold uppercase tracking-wide text-ink-700 shadow-card">
          {dict.focus.onLabel}
        </span>
      )}
      {useful && (
        <button
          type="button"
          data-focus-toggle
          aria-pressed={on}
          title={on ? dict.focus.exit : `${dict.focus.enter} (F)`}
          onClick={() => setFocus(!on)}
          className={`pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-medium shadow-card transition-colors ${
            on
              ? "border-gold/60 bg-gold text-ink-950 hover:bg-gold-light"
              : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"
          }`}
        >
          {on ? <IconClose className="text-[18px]" /> : <IconTarget className="text-[18px]" />}
          <span className="hidden sm:inline">{on ? dict.focus.exit : dict.focus.enter}</span>
        </button>
      )}
      {pathname !== "/coach" && (
        <Link
          href="/coach"
          data-coach-fab
          className="pointer-events-auto flex min-h-[46px] items-center gap-2 rounded-full border border-gold/45 bg-paper-raised px-4 text-[0.9375rem] font-medium text-ink-700 shadow-card transition-colors hover:bg-paper-sunken hover:text-ink-900"
        >
          <IconSparkles className="text-[18px] text-gold" />
          <span>{dict.nav.coach}</span>
        </Link>
      )}
      <div className="pointer-events-auto max-w-[min(22rem,calc(100vw-2rem))]">
        <ReportProblem dict={dict} floating />
      </div>
    </div>
  );
}
