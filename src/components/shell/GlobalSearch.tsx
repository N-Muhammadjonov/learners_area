"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import type { Dictionary } from "@/lib/i18n/en";
import { requestJson } from "@/lib/http/client-request";
import { IconClose, IconSearch } from "@/components/ui/icons";

/**
 * Search Learners Area.
 *
 * A dialog rather than a permanent field on small screens, and a dialog on
 * `Ctrl/⌘ K` everywhere — the same surface, one implementation, so the two
 * cannot disagree about behaviour.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setState("idle");
    setActive(0);
    // Keyboard users must land back where they were, not at the top of the page.
    openerRef.current?.focus();
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

  // Escape closes, and the background does not scroll behind the dialog.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          'input, button:not([tabindex="-1"]):not(:disabled)'
        );
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
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
        const result = await requestJson<{ results: Hit[] }>(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          method: "GET",
          signal: controller.signal,
        });
        // A cancelled response must never restore results after clear/close or
        // overwrite a newer query, even if the transport already completed.
        if (controller.signal.aborted) return;
        if (result.ok) {
          setHits(result.data.results ?? []);
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
  }, [query, open]);

  function go(hit: Hit) {
    close();
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
    vocabulary: dict.nav.vocabulary,
    lesson: dict.nav.courseModules,
    grammar: dict.nav.grammar,
    writing: dict.nav.writing,
    liveClass: dict.nav.liveClasses,
    speaking: dict.nav.speaking,
    assignment: dict.nav.assignments,
  };

  return (
    <>
        <button
          type="button"
          data-global-search-trigger
          onClick={(event) => {
            openerRef.current = event.currentTarget;
            setOpen(true);
          }}
          className="hidden h-11 w-full max-w-[420px] items-center gap-2.5 rounded-[10px] border border-ink-100 bg-paper-sunken px-3 text-left text-[0.9375rem] text-ink-300 transition-colors hover:border-ink-300 hover:text-ink-500 lg:flex"
        >
          <IconSearch className="shrink-0 text-[18px]" />
          <span className="min-w-0 flex-1 truncate">{dict.shell.searchPlaceholder}</span>
          <kbd className="shrink-0 rounded border border-ink-100 px-1.5 py-0.5 text-[0.6875rem] text-ink-300">
            Ctrl K
          </kbd>
        </button>
        <button
          type="button"
          data-global-search-trigger
          aria-label={dict.shell.openSearch}
          onClick={(event) => {
            openerRef.current = event.currentTarget;
            setOpen(true);
          }}
          className="flex items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900 lg:hidden"
          style={{ width: "var(--icon-btn)", height: "var(--icon-btn)" }}
        >
          <IconSearch className="text-[20px]" />
        </button>

      {open && (
        <div
          className="fixed inset-0 flex items-start justify-center p-3 sm:p-6"
          style={{ zIndex: "var(--z-modal)" }}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={dict.shell.search}
          data-global-search-dialog
          data-search-state={state}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/60"
          />
          <div
            className="relative mt-[6vh] flex w-full max-w-[720px] flex-col overflow-hidden rounded-[18px] border border-ink-100 bg-paper-raised shadow-raised"
            style={{ maxHeight: "75vh" }}
          >
            <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
              <IconSearch className="shrink-0 text-[20px] text-ink-300" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={dict.shell.searchPlaceholder}
                aria-label={dict.shell.search}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={state === "ready" && hits.length > 0}
                aria-controls={state === "ready" && hits.length > 0 ? resultsId : undefined}
                aria-activedescendant={state === "ready" && hits[active] ? `${resultsId}-${active}` : undefined}
                className="min-w-0 flex-1 bg-transparent text-[1.0625rem] text-ink-900 outline-none placeholder:text-ink-300"
              />
              {query && (
                <button type="button" className="btn-ghost shrink-0" onClick={() => {
                  setQuery("");
                  setHits([]);
                  setActive(0);
                  setState("idle");
                  inputRef.current?.focus();
                }} aria-label={dict.shell.clear}>
                  {dict.shell.clear}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                aria-label={dict.shell.closeSearch}
                className="flex shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-paper-sunken hover:text-ink-900"
                style={{ width: 36, height: 36 }}
              >
                <IconClose className="text-[18px]" />
              </button>
            </div>

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
                <p className="px-3 py-6 text-center text-[0.9375rem] text-band-bad">{dict.common.error}</p>
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
            </div>

            <div className="border-t border-ink-100 px-4 py-2 text-[0.75rem] text-ink-300">
              {state === "ready" && hits.length > 0
                ? `${(hits.length === 1 ? dict.shell.resultsCountOne : dict.shell.resultsCountMany).replace("{n}", String(hits.length))} · `
                : ""}
              {dict.shell.keyboardHint}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
