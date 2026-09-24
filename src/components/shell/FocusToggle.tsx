"use client";

import { useEffect, useState } from "react";

/**
 * Focus Mode.
 *
 * Hides non-essential chrome (sidebar, mobile drawer button, decorative
 * sections marked `.focus-hide`) while leaving every exam control in place —
 * the timer, the question navigation and the submit button are never hidden.
 * The preference is a harmless UI choice, so localStorage is the right store
 * (never points, progress or mastery).
 */
export const FOCUS_STORAGE_KEY = "la_focus";

export function FocusToggle({
  enterLabel,
  exitLabel,
  hint,
}: {
  enterLabel: string;
  exitLabel: string;
  hint: string;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(FOCUS_STORAGE_KEY) === "on";
    setOn(stored);
    document.documentElement.dataset.focus = stored ? "on" : "off";
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    document.documentElement.dataset.focus = next ? "on" : "off";
    window.localStorage.setItem(FOCUS_STORAGE_KEY, next ? "on" : "off");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? exitLabel : enterLabel}
      title={`${on ? exitLabel : enterLabel} — ${hint}`}
      className={`flex h-9 w-9 items-center justify-center rounded-sm border text-sm ${
        on
          ? "border-signal-600 bg-signal-600 text-signal-contrast"
          : "border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
      }`}
    >
      <span aria-hidden>◎</span>
    </button>
  );
}
