"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { IconMoon, IconSun } from "@/components/ui/icons";

export { THEME_COOKIE };
export type { Theme };

/**
 * Day / Night — two separate controls, one per mode.
 *
 * The history of this control is worth keeping, because each version was a
 * correction:
 *
 *   1. one icon that silently swapped meaning — "an unclear icon-only control",
 *      because a single button cannot say which mode you are in;
 *   2. a segmented control with the words "Kunduzgi rejim | Tungi rejim" — clear,
 *      but it took a wide slot in a topbar that also has to hold search, language
 *      and the profile;
 *   3. this: two separate buttons, each carrying its own mode. They are not a
 *      toggle — there is no single state to guess, one button is daylight and the
 *      other is night, and the active one is visibly selected.
 *
 * The words did not disappear, they moved to where they do not cost width: the
 * accessible name (`aria-label`) and the tooltip. Keyboard and screen-reader
 * users still get "Kunduzgi rejim" / "Tungi rejim"; the eye gets two 44px targets
 * and a clear selected state.
 *
 * The server already rendered the correct palette (it reads the theme cookie
 * before the first byte), so this control only keeps three things in sync:
 * `data-theme` on `<html>`, the cookie that survives a reload, and its own
 * selected state.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle({ nightLabel, dayLabel, currentLabel, errorLabel }: { nightLabel: string; dayLabel: string; currentLabel: string; errorLabel: string }) {
  const requestResponse = useScopedResponse(25000);

  const [theme, setTheme] = useState<Theme>("day");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme | undefined) ?? "day");
  }, []);

  async function select(next: Theme) {
    if (next === theme || pending) return;
    const previous = theme;
    setPending(true); setFailed(false);
    setTheme(next);
    // Paint first: switching theme must feel instant, and the cookie is only how
    // the choice survives the next request.
    applyTheme(next);
    // The server writes the cookie, because only it knows the transport: inside
    // the preview's cross-site frame a client-written `SameSite=Lax` cookie is
    // dropped and Night Mode would forget itself on the next reload.
    const res = await requestResponse("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
    if (!res) return;
    setPending(false);
    if (!res.ok) {setTheme(previous); applyTheme(previous); setFailed(true);}
  }

  const options: { value: Theme; label: string; Icon: typeof IconSun }[] = [
    { value: "day", label: dayLabel, Icon: IconSun },
    { value: "night", label: nightLabel, Icon: IconMoon },
  ];

  return (
    <div role="group" aria-busy={pending || undefined} aria-label={currentLabel} data-theme-toggle={theme} className="flex items-center gap-1">
      {failed && <span role="alert" className="text-xs text-band-bad">{errorLabel}</span>}
      {options.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            disabled={pending}
            key={value}
            type="button"
            data-theme-option={value}
            aria-pressed={selected}
            aria-label={label}
            title={label}
            onClick={() => void select(value)}
            className={selected ? "theme-btn theme-btn-active" : "theme-btn"}
          >
            <Icon className="text-[18px]" />
          </button>
        );
      })}
    </div>
  );
}
