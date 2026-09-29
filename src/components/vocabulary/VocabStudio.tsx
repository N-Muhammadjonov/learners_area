"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { VocabWordsPanel } from "./VocabWordsPanel";
import { VocabRevisionPanel } from "./VocabRevisionPanel";
import { VocabUsePanel } from "./VocabUsePanel";
import { VocabBoardPanel } from "./VocabBoardPanel";
import type { TabKey, VocabStudioData, VocabWord } from "./types";

const TABS: TabKey[] = ["words", "revision", "games", "use", "board"];

type SearchHit = {
  id: string;
  term: string;
  definitionEn: string;
  translationUz: string | null;
  mastery: string;
  match: string;
};

/**
 * The Vocabulary shell.
 *
 * Layout note: on desktop the study column and the Leaderboard share a row, and
 * the live search dropdown opens inside the study column — i.e. beside the
 * leaderboard. On phones the dropdown is the full width of the screen and the
 * leaderboard moves underneath, which is also where the search input lives.
 */
export function VocabStudio({ dict, data }: { dict: Dictionary; data: VocabStudioData }) {
  const t = dict.vocabulary;
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>(data.initialTab);
  const [dueCount, setDueCount] = useState(data.summary.due);

  const tabLabel: Record<TabKey, string> = useMemo(
    () => ({
      words: t.tab.words,
      revision: t.tab.revision,
      games: t.tab.games,
      use: t.tab.use,
      board: t.tab.board,
    }),
    [t]
  );

  const openTab = useCallback((next: TabKey) => {
    if (next === "games") {
      router.push("/vocabulary/games");
      return;
    }
    setTab(next);
    const url = next === "words" ? "/vocabulary" : `/vocabulary?tab=${next}`;
    window.history.replaceState(null, "", url);
  }, [router]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
          <p className="mt-1 text-sm text-ink-500">{t.search.hint}</p>
        </div>
        <VocabSearch dict={dict} onOpenWord={() => openTab("words")} />
      </div>

      <div
        role="tablist"
        aria-label={t.title}
        className="flex gap-1 overflow-x-auto rounded-md border border-ink-100 bg-paper-raised p-1"
      >
        {TABS.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              data-tab={key}
              onClick={() => openTab(key)}
              className={`whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-signal-600 text-signal-contrast"
                  : "text-ink-500 hover:bg-paper-sunken hover:text-ink-900"
              }`}
            >
              {tabLabel[key]}
              {key === "revision" && dueCount > 0 && (
                <span className="ml-2 rounded-full bg-band-warn/20 px-2 py-0.5 text-xs text-band-warn">
                  {dueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {tab === "words" && (
            <VocabWordsPanel
              dict={dict}
              words={data.words}
              folders={data.folders}
              packs={data.packs}
              summary={data.summary}
              onRefresh={() => router.refresh()}
            />
          )}
          {tab === "revision" && (
            <VocabRevisionPanel
              dict={dict}
              initialDue={data.due}
              onFinished={(remaining, pointsAwarded) => {
                setDueCount(remaining);
                if (pointsAwarded > 0) window.dispatchEvent(new Event("vocab:ledger-changed"));
                if (remaining === 0) router.refresh();
              }}
            />
          )}
          {tab === "use" && <VocabUsePanel dict={dict} initial={data.sentences} onSaved={(awarded) => {
            if (awarded) window.dispatchEvent(new Event("vocab:ledger-changed"));
          }} />}
          {tab === "board" && (
            <VocabBoardPanel dict={dict} standing={data.standing} compact />
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {tab !== "board" && <VocabBoardPanel dict={dict} standing={data.standing} />}
          <div className="card p-4">
            <h2 className="text-sm font-medium text-ink-900">{t.games.casualNote}</h2>
            <p className="mt-2 text-xs text-ink-500">{t.games.hint}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * The long student-only search box.
 *
 * Typing is debounced and the query goes to /api/vocabulary/search, which reads
 * only the caller's own library. The dropdown is a listbox so keyboard users can
 * arrow through the hits and open one with Enter; pressing Escape closes it.
 */
function VocabSearch({ dict, onOpenWord }: { dict: Dictionary; onOpenWord: () => void }) {
  const t = dict.vocabulary;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vocabulary/search?q=${encodeURIComponent(trimmed)}`);
        const payload = await res.json().catch(() => ({ results: [] }));
        if (!cancelled) {
          setHits(Array.isArray(payload.results) ? payload.results : []);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const statusText = busy
    ? dict.common.loading
    : hits.length > 0
      ? `${hits.length} ${t.search.results}`
      : query.trim().length > 0
        ? t.search.empty
        : "";

  return (
    <div ref={boxRef} className="relative w-full lg:max-w-md">
      <label htmlFor="vocab-search" className="sr-only">
        {t.search.title}
      </label>
      <input
        id="vocab-search"
        type="search"
        autoComplete="off"
        className="input"
        placeholder={t.search.placeholder}
        aria-label={t.search.title}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="vocab-search-results"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => query.trim().length > 0 && setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {statusText && (
        <p className="mt-1 text-xs text-ink-300" data-search-status aria-live="polite">
          {statusText}
        </p>
      )}
      {open && (
        <div
          id="vocab-search-results"
          role="listbox"
          aria-label={t.search.title}
          data-search-results
          className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-ink-100 bg-paper-raised p-1 shadow-raised"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-500">{t.search.empty}</p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={false}
                data-search-hit={hit.id}
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left hover:bg-paper-sunken"
                onClick={() => {
                  setOpen(false);
                  onOpenWord();
                }}
              >
                <span className="text-sm font-medium text-ink-900">{hit.term}</span>
                <span className="line-clamp-2 text-xs text-ink-500">{hit.definitionEn}</span>
                {hit.translationUz && <span className="text-xs text-gold">{hit.translationUz}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export type { VocabWord, VocabStudioData };
