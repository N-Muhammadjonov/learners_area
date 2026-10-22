"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import type { Dictionary } from "@/lib/i18n/en";
import { requestJson } from "@/lib/http/client-request";
import { IconClose, IconSearch } from "@/components/ui/icons";

/**
 * Search Learners Area.
 *
 * An editable header field on desktop and a compact expanded field on mobile.
 * Ctrl/⌘ K focuses the same input; results stay anchored beneath it.
 *
 * Design rules this follows:
 *   * no request until the query is useful (2 characters) and the user has
 *     stopped typing for a moment. Searching on the first keystroke of every
 *     word is what makes search feel expensive;
 *   * results are authorized on the server (see /api/search). This component
 *     never filters for permission — it only displays what it was given;
 *   * the whole thing is keyboard-operable: ↑ ↓ to choose, Enter to open,
 *     Esc to close. Focus is moved into the field when it opens and returned to
 *     whatever opened it when it closes;
 *   * a failed request says so and stays usable.
 */

type Hit = { type: string; title: string; context: string | null; href: string };
type State = "idle" | "loading" | "ready" | "error";

export function GlobalSearch({ dict }: { dict: Dictionary }) {
  const { navigate } = useInstantInteraction();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<State>("idle");
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const [partial, setPartial] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const openerRef = useRef<HTMLElement | null>(null);
  const restoringFocus = useRef(false);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setState("idle");
    setPartial(false);
    setActive(0);
    // Keyboard users must land back where they were, not at the top of the page.
    if (restoreFocus) {
      restoringFocus.current = true;
      openerRef.current?.focus();
      restoringFocus.current = false;
    }
  }, []);

  // Cmd/Ctrl + K, anywhere in the product.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!open) openerRef.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Desktop search is anchored; Escape and outside pointer close it.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }
    function outside(event: PointerEvent) {
      if (!dialogRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, close]);

  /**
   * The debounce *is* the request policy: one timer, restarted on every
   * keystroke, so the server sees the query the user settled on rather than
   * every prefix of it.
   */
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setState("idle");
      return;
    }
    setHits([]);
    setActive(0);
    setState("loading");
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      void (async () => {
        const result = await requestJson<{ results: Hit[]; partial?: boolean }>(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          method: "GET",
          signal: controller.signal,
        });
        // A cancelled response must never restore results after clear/close or
        // overwrite a newer query, even if the transport already completed.
        if (controller.signal.aborted) return;
        if (result.ok) {
          setHits(result.data.results ?? []);
          setPartial(result.data.partial === true);
          setActive(0);
          setState("ready");
        } else {
          setHits([]);
          setState("error");
        }
      })();
    }, 280);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [query, open, retry]);

  function go(hit: Hit) {
    close(false);
    navigate(hit.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    }
  }

  const typeLabels: Record<string, string> = {
    reading: dict.nav.reading,
    listening: dict.nav.listening,
    dictionary: dict.vocabulary.tab.dictionary,
    module: dict.nav.courseModules,
    section: dict.nav.courseModules,
    video: dict.nav.videoLessons,
    vocabulary: dict.nav.vocabulary,
    lesson: dict.nav.courseModules,
    grammar: dict.nav.grammar,
    writing: dict.nav.writing,
    liveClass: dict.nav.liveClasses,
    speaking: dict.nav.speaking,
    assignment: dict.nav.assignments,
  };

  return (
    <div ref={dialogRef} className="relative min-w-0 lg:w-full lg:max-w-[420px]" data-global-search>
      <button type="button" data-global-search-trigger aria-label={dict.shell.openSearch}
        onClick={(event) => { openerRef.current = event.currentTarget; setOpen(true); }}
        className="flex items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 lg:hidden"
        style={{ width: "var(--icon-btn)", height: "var(--icon-btn)" }}>
        <IconSearch className="text-[20px]" />
      </button>
      <div className={`${open ? "flex absolute right-0 top-0 w-[min(85vw,420px)]" : "hidden"} h-11 items-center gap-2.5 rounded-[10px] border border-ink-100 bg-paper-sunken px-3 lg:static lg:flex lg:w-full`}>
        <IconSearch className="shrink-0 text-[18px]" />
        <input ref={inputRef} value={query}
          onFocus={() => { if (restoringFocus.current) return; if (!open) openerRef.current = inputRef.current; setOpen(true); }}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKeyDown}
          placeholder={dict.shell.searchPlaceholder} aria-label={dict.shell.search}
          role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={open && hits.length ? resultsId : undefined}
          aria-activedescendant={open && hits[active] ? `${resultsId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink-900 outline-none placeholder:text-ink-300" />
        <span className="flex w-16 shrink-0 items-center justify-end gap-2">
        {query && <button type="button" aria-label={dict.shell.clear} onClick={() => { setQuery(""); setHits([]); setState("idle"); inputRef.current?.focus(); }}><IconClose className="text-[14px]" /></button>}
        {open ? <button type="button" onClick={()=>close()} aria-label={dict.shell.closeSearch}>
          <IconClose className="text-[18px]" />
        </button> : <kbd className="shrink-0 rounded border border-ink-100 px-1.5 py-0.5 text-[0.6875rem] text-ink-300">{dict.shell.searchShortcut}</kbd>}
        </span>
      </div>
      {open && <div data-global-search-dialog data-search-state={state}
        className="absolute right-0 top-12 z-50 flex max-h-[65vh] w-[min(85vw,420px)] flex-col overflow-hidden rounded-xl border border-ink-100 bg-paper-raised shadow-raised lg:w-full">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {state === "idle" && (
                <p className="px-3 py-6 text-center text-[0.9375rem] text-ink-300">{dict.shell.searchHint}</p>
              )}
              {state === "loading" && (
                <div className="flex flex-col gap-1" aria-live="polite">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-3">
                      <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-paper-sunken" />
                      <span className="h-4 flex-1 animate-pulse rounded bg-paper-sunken" />
                    </div>
                  ))}
                  <span className="sr-only">{dict.shell.searching}</span>
                </div>
              )}
              {state === "error" && (
                <div role="alert" className="px-3 py-6 text-center text-[0.9375rem]"><p className="text-band-bad">{dict.common.error}</p><button className="btn-secondary mt-3" type="button" onClick={()=>setRetry(value=>value+1)}>{dict.errorPage.retry}</button></div>
              )}
              {state === "ready" && hits.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="text-[1rem] font-medium text-ink-900">{dict.shell.noResults}</p>
                  <p className="mt-1 text-[0.875rem] text-ink-300">{dict.shell.noResultsHint}</p>
                </div>
              )}
              {state === "ready" && hits.length > 0 && (
                <ul id={resultsId} className="flex flex-col gap-0.5" role="listbox" aria-label={dict.shell.search}>
                  {hits.map((hit, index) => (
                    <li key={`${hit.type}-${hit.href}-${index}`}>
                      <button
                        type="button"
                        role="option"
                        id={`${resultsId}-${index}`}
                        tabIndex={-1}
                        aria-selected={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit)}
                        data-search-result
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          index === active ? "bg-paper-sunken" : "hover:bg-paper-sunken"
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-100 text-[0.6875rem] font-semibold uppercase text-ink-300">
                          {(typeLabels[hit.type] ?? hit.type).slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.9375rem] text-ink-900">{hit.title}</span>
                          <span className="block truncate text-[0.8125rem] text-ink-300">
                            {[typeLabels[hit.type], hit.context].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {state === "ready" && partial && <button type="button" className="btn-secondary m-2" onClick={()=>setRetry(value=>value+1)}>{dict.errorPage.retry}</button>}
            </div>

            <div className="border-t border-ink-100 px-4 py-2 text-[0.75rem] text-ink-300">
              {state === "ready" && hits.length > 0
                ? `${(hits.length === 1 ? dict.shell.resultsCountOne : dict.shell.resultsCountMany).replace("{n}", String(hits.length))} · `
                : ""}
              {dict.shell.keyboardHint}
            </div>
      </div>}
    </div>
  );
}
