"use client";

import { useEffect, useState } from "react";

/**
 * Day / Night switch.
 *
 * The server already rendered the correct palette (it reads the theme cookie
 * before the first byte), so this button only has to keep three things in sync:
 * the `data-theme` attribute, the cookie that survives a reload on another
 * device-less visit, and its own accessible label.
 */
export const THEME_COOKIE = "la_theme";
export type Theme = "day" | "night";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle({
  nightLabel,
  dayLabel,
  currentLabel,
}: {
  nightLabel: string;
  dayLabel: string;
  currentLabel: string;
}) {
  const [theme, setTheme] = useState<Theme>("day");

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme | undefined) ?? "day";
    setTheme(current);
  }, []);

  async function toggle() {
    const next: Theme = theme === "night" ? "day" : "night";
    setTheme(next);
    applyTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Best-effort server sync so the next server-rendered page agrees with the
    // screen the reader is looking at right now.
    await fetch("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => undefined);
  }

  const label = theme === "night" ? dayLabel : nightLabel;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={`${currentLabel}: ${label}`}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-sm border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
    >
      <span aria-hidden>{theme === "night" ? "☾" : "☀"}</span>
    </button>
  );
}
