"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { IconMoon, IconSun } from "@/components/ui/icons";

export { THEME_COOKIE };
export type { Theme };

/**
 * Day / Night — two labelled controls, not one ambiguous icon.
 *
 * The owner reported the old control as "an unclear icon-only control", and the
 * problem was not the icon: a single button that silently swaps between two
 * states cannot say which one you are in. This is a segmented control: both
 * options are visible, the current one is visibly selected (border, surface and
 * the gold accent, plus `aria-pressed`), and the label is a word.
 *
 * The server already rendered the correct palette (it reads the theme cookie
 * before the first byte), so this control only has to keep three things in sync:
 * the `data-theme` attribute, the cookie that survives a reload, and its own
 * selected state.
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
    setTheme((document.documentElement.dataset.theme as Theme | undefined) ?? "day");
  }, []);

  async function select(next: Theme) {
    if (next === theme) return;
    setTheme(next);
    // Paint first: the switch must feel instant, and the cookie is only how the
    // choice survives the next request.
    applyTheme(next);
    // The server writes the cookie, because only it knows the transport: inside
    // the preview's cross-site frame a client-written `SameSite=Lax` cookie is
    // dropped and Night Mode would forget itself on the next reload.
    await fetch("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => undefined);
  }

  const options: { value: Theme; label: string; Icon: typeof IconSun }[] = [
    { value: "day", label: dayLabel, Icon: IconSun },
    { value: "night", label: nightLabel, Icon: IconMoon },
  ];

  return (
    <div
      role="group"
      aria-label={currentLabel}
      data-theme-toggle={theme}
      className="flex items-center gap-0.5 rounded-[10px] border border-ink-100 bg-paper-sunken p-0.5"
    >
      {options.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            data-theme-option={value}
            aria-pressed={selected}
            title={label}
            onClick={() => void select(value)}
            className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium transition-colors ${
              selected
                ? "bg-paper-raised text-ink-900 shadow-card ring-1 ring-gold/50"
                : "text-ink-300 hover:text-ink-700"
            }`}
          >
            <Icon className={`text-[16px] ${selected ? "text-gold" : ""}`} />
            {/* The word is the point: an icon alone cannot say which mode is on. */}
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
