"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import type { Dictionary } from "@/lib/i18n/en";
import { VocabWordsPanel } from "./VocabWordsPanel";
import { VocabRevisionPanel } from "./VocabRevisionPanel";
import { VocabUsePanel } from "./VocabUsePanel";
import { VocabBoardPanel } from "./VocabBoardPanel";
import type { TabKey, VocabFolder, VocabPack, VocabWord } from "./types";
import { fetchPrivateJson, privateResources } from "@/lib/client/private-resource";

const TABS: TabKey[] = ["words", "revision", "games", "use", "board"];
const LIBRARY_PAGE_SIZE = 50;
type LoadStatus = "idle" | "loading" | "ready" | "error";
type LibraryPage = { words: VocabWord[]; hasMore: boolean };
type LibrarySummary = {
  total: number;
  due: number;
  byMastery: Record<string, number>;
  bySource: Record<string, number>;
  nextDueAt: string | Date | null;
};
type SearchHit = {
  id: string;
  term: string;
  definitionEn: string;
  translationUz: string | null;
  mastery: string;
  match: string;
};

/**
 * Bounded private GET (deadline, no automatic retry). Part 1 contract: a failed
 * region makes exactly one request and shows its own Retry control, which is the
 * only re-request. A 401 sends the route back through the server gate.
 */
function readPrivateJson<T>(url: string, onAuthFailure: () => void): Promise<T> {
  return fetchPrivateJson<T>(url, { onAuthFailure, retries: 0 });
}

/**
 * Repeat-visit reuse: within FRESH_MS a return to Vocabulary renders the
 * user-scoped snapshot without a request; after that the snapshot is shown
 * immediately and refreshed in the background. The revision queue is never
 * served from cache (it is always read fresh).
 */
const FRESH_MS = 30_000;
const LIBRARY_KEY = `vocabulary:library:first:${LIBRARY_PAGE_SIZE}`;
const SUMMARY_KEY = "vocabulary:summary";
const FOLDERS_KEY = "vocabulary:folders";

/** Compact feedback belongs to one resource region, never the private route. */
function RegionFailure({ dict, name, retry }: { dict: Dictionary; name: string; retry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm" role="alert" data-vocabulary-region-error={name}>
      <span className="text-ink-700">{dict.errors.unknown}</span>
      <button type="button" className="btn-secondary" onClick={retry} data-region-retry={name}>{dict.errorPage.retry}</button>
    </div>
  );
}

function RegionSkeleton({ name, label, rows = 2 }: { name: string; label: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label} data-async-loading={name} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => <div key={index} aria-hidden="true" className="h-12 animate-pulse rounded-lg bg-ink-50" />)}
    </div>
  );
}

/**
 * The Vocabulary workspace frame is rendered before any library, folder, point,
 * due-queue, or sentence query starts. Each selected view then owns its own
 * request and retry state; unrelated tabs are never fetched on entry.
 */
export function VocabStudio({ dict, initialTab, packs }: { dict: Dictionary; initialTab: TabKey; packs: VocabPack[] }) {
  const t = dict.vocabulary;
  const router = useRouter();
  const { navigate } = useInstantInteraction();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [seed] = useState(() => ({
    library: privateResources.peek<LibraryPage>(LIBRARY_KEY)?.data ?? null,
    summary: privateResources.peek<LibrarySummary>(SUMMARY_KEY)?.data ?? null,
    folders: privateResources.peek<VocabFolder[]>(FOLDERS_KEY)?.data ?? null,
  }));
  const [dueCount, setDueCount] = useState<number | null>(seed.summary?.due ?? null);
  const [library, setLibrary] = useState<LibraryPage | null>(seed.library);
  const [libraryStatus, setLibraryStatus] = useState<LoadStatus>(seed.library ? "ready" : "idle");
  const [libraryMoreBusy, setLibraryMoreBusy] = useState(false);
  const [libraryMoreError, setLibraryMoreError] = useState(false);
  const [summary, setSummary] = useState<LibrarySummary | null>(seed.summary);
  const [summaryStatus, setSummaryStatus] = useState<LoadStatus>(seed.summary ? "ready" : "idle");
  const [folders, setFolders] = useState<VocabFolder[]>(seed.folders ?? []);
  const [foldersStatus, setFoldersStatus] = useState<LoadStatus>(seed.folders ? "ready" : "idle");
  const [due, setDue] = useState<VocabWord[]>([]);
  const [dueStatus, setDueStatus] = useState<LoadStatus>("idle");
  const inFlight = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());

  const loadLibrary = useCallback(async (force = false) => {
    if (!force && (loaded.current.has("library") || inFlight.current.has("library"))) return;
    inFlight.current.add("library");
    const shown = privateResources.peek<LibraryPage>(LIBRARY_KEY);
    if (!shown || force) setLibraryStatus("loading");
    try {
      const page = await privateResources.read<LibraryPage>(LIBRARY_KEY, async () => {
        const result = await readPrivateJson<{ words: VocabWord[]; hasMore: boolean }>(
          `/api/vocabulary?limit=${LIBRARY_PAGE_SIZE}&offset=0`,
          () => router.refresh(),
        );
        return { words: result.words, hasMore: result.hasMore };
      }, { maxAgeMs: FRESH_MS, force });
      setLibrary(page);
      setLibraryMoreError(false);
      loaded.current.add("library");
      setLibraryStatus("ready");
    } catch {
      loaded.current.delete("library");
      // A failed background refresh keeps the valid snapshot on screen.
      setLibraryStatus(shown && !force ? "ready" : "error");
    } finally {
      inFlight.current.delete("library");
    }
  }, [router]);

  const loadSummary = useCallback(async (force = false) => {
    if (!force && (loaded.current.has("summary") || inFlight.current.has("summary"))) return;
    inFlight.current.add("summary");
    const shown = privateResources.peek<LibrarySummary>(SUMMARY_KEY);
    if (!shown || force) setSummaryStatus("loading");
    try {
      const next = await privateResources.read<LibrarySummary>(SUMMARY_KEY, async () => {
        const result = await readPrivateJson<{ summary: LibrarySummary }>("/api/vocabulary/summary", () => router.refresh());
        return result.summary;
      }, { maxAgeMs: FRESH_MS, force });
      setSummary(next);
      setDueCount(next.due);
      loaded.current.add("summary");
      setSummaryStatus("ready");
    } catch {
      loaded.current.delete("summary");
      setSummaryStatus(shown && !force ? "ready" : "error");
    } finally {
      inFlight.current.delete("summary");
    }
  }, [router]);

  const loadFolders = useCallback(async (force = false) => {
    if (!force && (loaded.current.has("folders") || inFlight.current.has("folders"))) return;
    inFlight.current.add("folders");
    const shown = privateResources.peek<VocabFolder[]>(FOLDERS_KEY);
    if (!shown || force) setFoldersStatus("loading");
    try {
      const next = await privateResources.read<VocabFolder[]>(FOLDERS_KEY, async () => {
        const result = await readPrivateJson<{ folders: VocabFolder[] }>("/api/vocabulary/folders", () => router.refresh());
        return result.folders;
      }, { maxAgeMs: FRESH_MS, force });
      setFolders(next);
      loaded.current.add("folders");
      setFoldersStatus("ready");
    } catch {
      loaded.current.delete("folders");
      setFoldersStatus(shown && !force ? "ready" : "error");
    } finally {
      inFlight.current.delete("folders");
    }
  }, [router]);

  const loadDue = useCallback(async (force = false) => {
    if (!force && (loaded.current.has("due") || inFlight.current.has("due"))) return;
    inFlight.current.add("due");
    setDueStatus("loading");
    try {
      const result = await readPrivateJson<{ due: VocabWord[] }>("/api/vocabulary/due?limit=40", () => router.refresh());
      setDue(result.due);
      loaded.current.add("due");
      setDueStatus("ready");
    } catch {
      loaded.current.delete("due");
      setDueStatus("error");
    } finally {
      inFlight.current.delete("due");
    }
  }, [router]);

  useEffect(() => {
    if (tab === "words") {
      void loadLibrary();
      void loadSummary();
      void loadFolders();
    } else if (tab === "revision") {
      void loadDue();
      void loadSummary();
    }
  }, [tab, loadDue, loadFolders, loadLibrary, loadSummary]);

  const refreshWords = useCallback(async () => {
    // A Words mutation affects only the vocabulary library/summary/folders.
    privateResources.invalidate("vocabulary:");
    await Promise.all([loadLibrary(true), loadSummary(true), loadFolders(true)]);
  }, [loadFolders, loadLibrary, loadSummary]);

  const loadMoreWords = useCallback(async () => {
    if (!library?.hasMore || libraryMoreBusy) return;
    setLibraryMoreBusy(true);
    setLibraryMoreError(false);
    try {
      const result = await readPrivateJson<{ words: VocabWord[]; hasMore: boolean }>(
        `/api/vocabulary?limit=${LIBRARY_PAGE_SIZE}&offset=${library.words.length}`,
        () => router.refresh(),
      );
      setLibrary((current) => {
        if (!current) return current;
        const next = { words: [...current.words, ...result.words], hasMore: result.hasMore };
        privateResources.set(LIBRARY_KEY, next);
        return next;
      });
    } catch {
      setLibraryMoreError(true);
    } finally {
      setLibraryMoreBusy(false);
    }
  }, [library, libraryMoreBusy, router]);

  const tabLabel: Record<TabKey, string> = useMemo(
    () => ({ words: t.tab.words, revision: t.tab.revision, games: t.tab.games, use: t.tab.use, board: t.tab.board }),
    [t],
  );

  const openTab = useCallback((next: TabKey) => {
    if (next === "games") {
      navigate("/vocabulary/games");
      return;
    }
    setTab(next);
    const url = next === "words" ? "/vocabulary" : `/vocabulary?tab=${next}`;
    window.history.replaceState(null, "", url);
  }, [navigate]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" data-vocabulary-workspace>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
          <p className="mt-1 text-sm text-ink-500">{t.search.hint}</p>
        </div>
        <VocabSearch dict={dict} onOpenWord={() => openTab("words")} />
      </div>

      <div role="tablist" aria-label={t.title} className="flex gap-1 overflow-x-auto rounded-md border border-ink-100 bg-paper-raised p-1" data-vocabulary-tabs>
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
              className={`whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-signal-600 text-signal-contrast" : "text-ink-500 hover:bg-paper-sunken hover:text-ink-900"}`}
            >
              {tabLabel[key]}
              {key === "revision" && dueCount !== null && dueCount > 0 && (
                <span className="ml-2 rounded-full bg-band-warn/20 px-2 py-0.5 text-xs text-band-warn">{dueCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {tab === "words" && (
            <>
              <section data-vocabulary-core="library" aria-label={t.tab.words}>
                {libraryStatus === "loading" && !library ? <RegionSkeleton name="vocabulary-library" label={dict.common.loading} rows={3} /> : null}
                {libraryStatus === "error" && <RegionFailure dict={dict} name="library" retry={() => void loadLibrary(true)} />}
                {library && <VocabWordsPanel
                  dict={dict}
                  words={library.words}
                  folders={folders}
                  foldersStatus={foldersStatus}
                  onRetryFolders={() => void loadFolders(true)}
                  packs={packs}
                  summary={summary}
                  summaryStatus={summaryStatus}
                  onRetrySummary={() => void loadSummary(true)}
                  hasMore={library.hasMore}
                  loadingMore={libraryMoreBusy}
                  loadMoreError={libraryMoreError}
                  onLoadMore={() => void loadMoreWords()}
                  onRefresh={refreshWords}
                />}
              </section>
              {!library && libraryStatus === "ready" ? <p className="text-sm text-ink-500">{dict.errors.unknown}</p> : null}
            </>
          )}
          {tab === "revision" && (
            <section data-vocabulary-core="revision" aria-label={t.tab.revision}>
              {dueStatus === "loading" && !loaded.current.has("due") ? <RegionSkeleton name="vocabulary-revision" label={dict.common.loading} rows={2} /> : null}
              {dueStatus === "error" ? <RegionFailure dict={dict} name="revision" retry={() => void loadDue(true)} /> : null}
              {dueStatus === "ready" && <VocabRevisionPanel
                key={`revision-${due.map((word) => word.id).join("|")}`}
                dict={dict}
                initialDue={due}
                onFinished={(remaining, pointsAwarded) => {
                  setDueCount(remaining);
                  // SRS reviews change mastery and due counts only.
                  privateResources.invalidate("vocabulary:");
                  if (pointsAwarded > 0) window.dispatchEvent(new Event("vocab:ledger-changed"));
                  if (remaining === 0) {
                    void loadDue(true);
                    void loadSummary(true);
                  }
                }}
              />}
            </section>
          )}
          {tab === "use" && <VocabUsePanel dict={dict} onSaved={(awarded) => {
            if (awarded) window.dispatchEvent(new Event("vocab:ledger-changed"));
          }} />}
          {tab === "board" && <VocabBoardPanel dict={dict} compact />}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {tab !== "board" && <VocabBoardPanel dict={dict} />}
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

export type { VocabWord };
