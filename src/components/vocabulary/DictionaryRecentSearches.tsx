"use client";

import { dictionaryPos } from "@/lib/dictionary/labels";
import { useEffect, useRef, useState } from "react";

export type DictionaryRecentSearch = {
  lexeme_id: string;
  query_display: string;
  direction: "EN" | "UZ";
  display_lemma: string;
  translation_uz: string;
  cefr?: string | null;
  part_of_speech?: string;
};

export function DictionaryRecentSearches({
  recent,
  title,
  clearLabel,
  onOpen,
  onClear,
}: {
  recent: DictionaryRecentSearch[];
  title: string;
  clearLabel: string;
  onOpen: (entry: DictionaryRecentSearch) => void;
  onClear: () => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    const measure = () => {
      const first = region.current?.querySelector<HTMLElement>(
        "[data-dictionary-recent-row]",
      );
      if (!first) return;
      const bounds = first.getBoundingClientRect();
      // Measure after the heading. Visual viewport also accounts for zoom and
      // the mobile keyboard; retaining one row keeps history accessible.
      const available =
        (window.visualViewport?.height ?? window.innerHeight) - bounds.top - 24;
      const rowHeight = Math.max(88, bounds.height) + 8;
      setLimit(
        Math.max(1, Math.min(5, Math.floor((available + 8) / rowHeight))),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (region.current) observer?.observe(region.current);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [recent]);

  return (
    <div
      ref={region}
      data-dictionary-recent
      className="rounded-2xl bg-sky-50/70 dark:bg-signal-50/50 p-3 sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {recent.length > 0 && (
          <button
            type="button"
            className="btn-ghost shrink-0 text-sky-600 dark:text-sky-400"
            onClick={onClear}
          >
            {clearLabel}
          </button>
        )}
      </div>
      {recent.slice(0, limit).map((entry) => (
        <button
          key={entry.lexeme_id}
          type="button"
          data-dictionary-recent-row
          className="mt-2 block w-full rounded-2xl border border-ink-100 bg-paper-raised p-4 text-left"
          onClick={() => onOpen(entry)}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 flex-wrap gap-x-4">
              <strong className="text-lg">{entry.query_display}</strong>
              <strong className="text-lg text-sky-600 dark:text-sky-400">
                {entry.display_lemma}
              </strong>
              {entry.part_of_speech && (
                <span className="rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-700">
                  {dictionaryPos(entry.part_of_speech)}
                </span>
              )}
            </span>
            {entry.cefr && (
              <span className="shrink-0 rounded-lg bg-sky-50 dark:bg-signal-50 px-2 py-1 text-sm font-semibold text-sky-600 dark:text-sky-400">
                {entry.cefr}
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-ink-500">
            {entry.translation_uz}
          </span>
        </button>
      ))}
    </div>
  );
}
