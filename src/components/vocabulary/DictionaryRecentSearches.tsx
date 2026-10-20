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
      className="dictionary-recent"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {recent.length > 0 && (
          <button
            type="button"
            className="btn-ghost dictionary-recent-clear"
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
          className="dictionary-recent-row"
          onClick={() => onOpen(entry)}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="dictionary-result-heading"><strong>{entry.display_lemma}</strong>{entry.part_of_speech&&<span className="dictionary-pos">{dictionaryPos(entry.part_of_speech)}</span>}</span>
            {entry.cefr&&<span className="dictionary-level">{entry.cefr}</span>}
          </span>
          <span className="dictionary-preview truncate">{entry.translation_uz}</span>
          {entry.query_display.toLocaleLowerCase()!==entry.display_lemma.toLocaleLowerCase()&&<span className="dictionary-query">{entry.direction}: {entry.query_display}</span>}
        </button>
      ))}
    </div>
  );
}
