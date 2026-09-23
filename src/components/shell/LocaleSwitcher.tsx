"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/lib/i18n";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function setLocale(next: Locale) {
    if (next === locale) return;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex overflow-hidden rounded-sm border border-ink-100 text-xs font-medium">
      {(["uz", "en"] as const).map((code) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          disabled={isPending}
          className={`px-2.5 py-1 uppercase ${
            code === locale ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500 hover:bg-paper-sunken"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
