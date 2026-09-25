"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

export { THEME_COOKIE };
export type { Theme };

/**
 * Day / Night switch.
 *
 * The server already rendered the correct palette (it reads the theme cookie
 * before the first byte), so this button only has to keep three things in sync:
 * the `data-theme` attribute, the cookie that survives a reload on another
 * device-less visit, and its own accessible label.
 */
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
    // The server writes the cookie, because only it knows the transport: inside the
    // preview's cross-site frame a client-written `SameSite=Lax` cookie is dropped
    // and Night Mode would forget itself on the next reload.
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
      data-theme-toggle={theme}
      className="flex h-9 w-9 items-center justify-center rounded-sm border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
    >
      <span aria-hidden>{theme === "night" ? "☾" : "☀"}</span>
    </button>
  );
}
