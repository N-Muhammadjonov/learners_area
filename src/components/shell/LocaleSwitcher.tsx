"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";

/**
 * The Day/Night switch's neighbour: the language switch.
 *
 * Two things here are accessibility, not decoration:
 *
 *   - the visible label is the two-letter code because that is what fits a
 *     toolbar, but the button's accessible name is the full language, and `lang`
 *     is set on each so a screen reader pronounces "O'zbekcha" as Uzbek rather
 *     than reading Uzbek letters with English phonetics;
 *   - `aria-pressed` says which language is active. The colour alone would leave
 *     a screen reader with two identical-looking buttons — and the active state
 *     used to be white text on the accent, which is unreadable in Night Mode
 *     where the accent is gold. It now uses the token that exists for exactly
 *     this: `--accent-contrast`, navy on gold after dark.
 */
export function LocaleSwitcher({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [requestPending, setRequestPending] = useState(false);
  const [error, setError] = useState(false);
  const t = dict.locale;
  const pending = isPending || requestPending;

  async function setLocale(next: Locale) {
    if (next === locale || pending) return;
    setRequestPending(true);
    setError(false);
    try {
      const response = await requestResponse("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
    if (!response) return;
      if (!response.ok) throw new Error("Locale update failed");
      startTransition(() => router.refresh());
    } catch {
      setError(true);
    } finally {
      setRequestPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1" data-locale-switcher>
      <div
        role="group"
        aria-label={t.switchLabel}
        aria-busy={pending || undefined}
        className="flex overflow-hidden rounded-sm border border-ink-100 text-xs font-medium"
      >
        {(["uz", "en"] as const).map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            onClick={() => { void setLocale(code); }}
            disabled={pending}
            aria-pressed={code === locale}
            aria-label={t[code]}
            className={`px-2.5 py-1 uppercase ${
              code === locale
                ? "bg-signal-600 text-signal-contrast"
                : "bg-paper-raised text-ink-500 hover:bg-paper-sunken"
            }`}
          >
            {code}
          </button>
        ))}
      </div>
      {pending && <span role="status" className="sr-only">{dict.loadingPage.label}</span>}
      {error && <span role="alert" className="text-xs text-band-bad">{dict.auth.errorNetwork}</span>}
    </div>
  );
}
