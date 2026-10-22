"use client";

import { ModuleEmoji } from "@/components/ui/ModuleEmoji";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { FOCUS_STORAGE_KEY } from "@/lib/theme";
import { subscribeFocusEntry } from "@/lib/interaction/focus-entry";
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
 *   * can always be left — Escape always exits, and the launcher below is always
 *     visible, so the button is one press away. A student can never be trapped in
 *     a chrome-less screen;
 *   * enters itself when a real Reading or Listening attempt starts (see
 *     `@/lib/interaction/focus-entry`) unless the learner exited Focus for that
 *     same attempt.
 *
 * The utilities are collapsed behind one launcher on purpose: three floating
 * controls in the corner covered the workspace the owner asked to keep clear.
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
  "/app/reading",
  "/app/listening",
  "/app/writing",
  "/app/speaking",
  "/app/grammar",
  "/app/vocabulary",
  "/app/mocks",
  "/app/coach",
];

export function ShellUtilities({ dict }: { dict: Dictionary }) {
  const pathname = usePathname();
  const [on, setOn] = useState(false);
  /** The utility stack starts collapsed: one launcher, not three floating controls. */
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  /**
   * Focus auto-entry bookkeeping, per attempt:
   *   - `announcedAttempt` is the attempt the learner is currently inside;
   *   - `dismissedAttempt` is the one they exited Focus for, and it stays dismissed
   *     until they either leave that attempt or turn Focus back on themselves.
   * The pair is what makes "auto-enter on start" and "never trap the learner"
   * compatible, and neither ever leaves this mounted shell.
   */
  const announcedAttempt = useRef<string | null>(null);
  const dismissedAttempt = useRef<string | null>(null);
  /** The path an attempt auto-entered Focus on, so the stored preference is not
   * re-applied over it when the path change and the announcement land together. */
  const autoEnteredPath = useRef<string | null>(null);

  const useful = (pathname === "/app" || FOCUS_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) && !isManagementRoute(pathname);
  const current = useRef({ pathname, useful });
  useEffect(() => {
    current.current = { pathname, useful };
  }, [pathname, useful]);

  useEffect(() => {
    // This path was already answered by an attempt announcement; re-applying the
    // stored preference here would immediately undo it.
    if (autoEnteredPath.current === pathname) return;
    const stored = window.localStorage.getItem(FOCUS_STORAGE_KEY) === "on";
    setOn(stored && useful);
    document.documentElement.dataset.focus = stored && useful ? "on" : "off";
  }, [useful, pathname]);

  /**
   * An attempt screen announcing itself is the only thing that may switch Focus
   * on automatically. The signal must match the screen being shown, the screen
   * must be a practice route, and a dismissal for that same attempt always wins —
   * so an exit is respected for as long as the learner stays in that attempt.
   */
  useEffect(
    () =>
      subscribeFocusEntry((intent) => {
        if (intent.pathname !== current.current.pathname || !current.current.useful) return;
        if (dismissedAttempt.current === intent.attemptId) return;
        announcedAttempt.current = intent.attemptId;
        autoEnteredPath.current = intent.pathname;
        applyFocus(true, { persist: false });
      }),
    [],
  );

  // A collapsed stack must never survive a navigation and hover over the next screen.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // A pointer press outside the utility stack collapses it. Presses inside
  // (Focus, Coach, the report form) keep it open; focus returns to the launcher
  // only if it was inside the stack, so typing elsewhere is never interrupted.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const container = containerRef.current;
      if (!container || container.contains(event.target as Node)) return;
      const hadFocus = container.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) launcherRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Escape closes the stack as well as leaving Focus, and it must work even on a
  // route where Focus is not offered.
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

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
        applyFocus(false, { byUser: true });
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        applyFocus(document.documentElement.dataset.focus !== "on", { byUser: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /**
   * `byUser` marks a real choice, so it is remembered and it ends any dismissal
   * for the current attempt. The automatic entry on an attempt start changes the
   * screen, not the stored preference, and never fights a dismissal.
   */
  function applyFocus(next: boolean, options: { persist?: boolean; byUser?: boolean } = {}) {
    if (options.byUser) dismissedAttempt.current = next ? null : announcedAttempt.current;
    setOn(next);
    document.documentElement.dataset.focus = next ? "on" : "off";
    if (options.persist !== false) window.localStorage.setItem(FOCUS_STORAGE_KEY, next ? "on" : "off");
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed bottom-4 right-4 flex flex-col items-end gap-2"
      style={{ zIndex: "var(--z-sticky)" }}
      data-shell-utilities
    >
      {on && (
        <span className="pointer-events-auto rounded-full border border-gold/50 bg-paper-raised px-3 py-1 text-[0.75rem] font-semibold uppercase tracking-wide text-ink-700 shadow-card">
          {dict.focus.onLabel}
        </span>
      )}
      {open && (
        <div
          id="shell-utilities-panel"
          role="group"
          aria-label={dict.shell.utilities}
          data-shell-utilities-panel
          className="pointer-events-auto flex flex-col items-end gap-2"
        >
          {useful && (
            <button
              type="button"
              data-focus-toggle
              aria-pressed={on}
              title={on ? dict.focus.exit : `${dict.focus.enter} (F)`}
              onClick={() => applyFocus(!on, { byUser: true })}
              className={`flex min-h-[46px] items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-medium shadow-card transition-colors ${
                on
                  ? "border-gold/60 bg-gold text-ink-950 hover:bg-gold-light"
                  : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"
              }`}
            >
              {on ? <IconClose className="text-[18px]" /> : <IconTarget className="text-[18px]" />}
              <span>{on ? dict.focus.exit : dict.focus.enter}</span>
            </button>
          )}
          {pathname !== "/app/coach" && (
            <Link
              href="/app/coach"
              data-coach-fab
              className="flex min-h-[46px] items-center gap-2 rounded-full border border-gold/45 bg-paper-raised px-4 text-[0.9375rem] font-medium text-ink-700 shadow-card transition-colors hover:bg-paper-sunken hover:text-ink-900"
            >
              <IconSparkles className="text-[18px] text-gold" />
              <span>{dict.nav.coach}</span>
            </Link>
          )}
          <div className="max-w-[min(22rem,calc(100vw-2rem))]">
            <ReportProblem dict={dict} floating />
          </div>
        </div>
      )}
      <button
        type="button"
        ref={launcherRef}
        data-utilities-launcher
        aria-expanded={open}
        aria-controls="shell-utilities-panel"
        title={dict.shell.utilities}
        onClick={() => setOpen((value) => !value)}
        className={`pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border p-0 text-[0.9375rem] font-medium shadow-card transition-colors ${
          open ? "border-signal-600 bg-signal-600 text-signal-contrast" : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"
        }`}
      >
        {open ? <IconClose className="text-[18px]" /> : <ModuleEmoji kind="eject" />}
        <span className="sr-only">{dict.shell.utilities}</span>
      </button>
    </div>
  );
}
