"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The library filter bar.
 *
 * The filters live in the URL, not in component state, and that is the point: a
 * student can narrow the library to "Passage 2, technology, Matching Headings",
 * send that link to a classmate or open it again tomorrow and get the same
 * screen. State that only exists inside React is state that disappears on the
 * first refresh — which is exactly how a filtered list ends up looking empty and
 * broken after a hard reload.
 *
 * Every control here is a link, deliberately. `router.push`/`replace` was tried
 * first and did not move the URL when only the query string changed on the same
 * route (the RSC request answered 200 and the address bar stayed put), while a
 * link to the same target navigates correctly. Links also mean the filters work
 * before React hydrates, can be opened in a new tab, and are readable by a
 * screen reader as navigation — none of which is true of a click handler.
 *
 * One trap is worth writing down because it cost an afternoon: `scroll={false}`
 * on these links stops the same-route navigation from committing at all on
 * Next 15.5 — the click lands, the RSC request is made and answers 200, and the
 * URL never changes. The filters therefore use plain links, and keeping the page
 * from jumping is the browser's job (the grid re-renders in place).
 */
export function ReadingFilters({
  dict,
  topics,
  types,
  current,
}: {
  dict: Dictionary;
  topics: { code: string; count: number; label: string }[];
  types: { code: string; count: number; label: string }[];
  /** The filters as the server read them — no `useSearchParams` needed. */
  current: { status: string; topic: string; type: string; query: string };
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState(current.query);

  // The search box follows the URL when it changes underneath (the back button,
  // "clear filters", a topic link) but never fights the person typing.
  useEffect(() => {
    setQuery(current.query);
  }, [current.query]);

  function hrefWith(next: Partial<{ status: string; topic: string; type: string; query: string }>) {
    const search = new URLSearchParams();
    const merged = { ...current, ...next };
    if (merged.status) search.set("status", merged.status);
    if (merged.topic) search.set("topic", merged.topic);
    if (merged.type) search.set("type", merged.type);
    if (merged.query) search.set("q", merged.query);
    const queryString = search.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  }

  const statusOptions: { value: string; label: string }[] = [
    { value: "", label: dict.readingHub.filterAll },
    { value: "passage1", label: dict.readingHub.filterPassage.replace("{n}", "1") },
    { value: "passage2", label: dict.readingHub.filterPassage.replace("{n}", "2") },
    { value: "passage3", label: dict.readingHub.filterPassage.replace("{n}", "3") },
    { value: "not_started", label: dict.readingHub.filterNotStarted },
    { value: "in_progress", label: dict.readingHub.filterInProgress },
    { value: "completed", label: dict.readingHub.filterCompleted },
  ];

  const hasFilters = Boolean(current.status || current.topic || current.type || current.query);
  const optionHref = (key: "topic" | "type", value: string) =>
    hrefWith(key === "topic" ? { topic: value } : { type: value });

  return (
    <div className="panel flex flex-col gap-4" data-reading-filters>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <form
          className="flex w-full flex-col gap-1.5 lg:max-w-sm"
          onSubmit={(event) => event.preventDefault()}
          role="search"
        >
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{dict.readingHub.library}</span>
            <input
              className="input h-[var(--control-h)]"
              type="search"
              name="q"
              value={query}
              data-reading-search
              placeholder={dict.readingHub.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <Link
              href={hrefWith({ query: query.trim() })}
              className="btn-secondary h-[var(--control-h-sm)]"
              data-reading-search-submit
              replace
            >
              {dict.shell.search}
            </Link>
            {query.trim() !== "" && (
              <button type="button" className="btn-ghost h-[var(--control-h-sm)]" onClick={() => setQuery("")} data-reading-search-clear>
                {dict.shell.clear}
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="field-label">{dict.readingHub.filterTopic}</span>
            <details className="dropdown" data-reading-filter="topic">
              <summary className="input flex h-[var(--control-h)] cursor-pointer items-center justify-between gap-2">
                <span>{topics.find((item) => item.code === current.topic)?.label ?? dict.readingHub.filterTopicAll}</span>
                <span aria-hidden className="text-ink-300">▾</span>
              </summary>
              <ul className="dropdown-menu" role="listbox">
                <li>
                  <Link href={hrefWith({ topic: "" })} className="dropdown-item" replace data-reading-topic-option="">
                    {dict.readingHub.filterTopicAll}
                  </Link>
                </li>
                {topics.map((item) => (
                  <li key={item.code}>
                    <Link
                      href={optionHref("topic", item.code)}
                      className={item.code === current.topic ? "dropdown-item dropdown-item-active" : "dropdown-item"}
                      replace
                      data-reading-topic-option={item.code}
                      aria-current={item.code === current.topic ? "true" : undefined}
                    >
                      {item.label}
                      <span className="dropdown-count">{item.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="field-label">{dict.readingHub.filterType}</span>
            <details className="dropdown" data-reading-filter="type">
              <summary className="input flex h-[var(--control-h)] cursor-pointer items-center justify-between gap-2">
                <span>{types.find((item) => item.code === current.type)?.label ?? dict.readingHub.filterTypeAll}</span>
                <span aria-hidden className="text-ink-300">▾</span>
              </summary>
              <ul className="dropdown-menu dropdown-menu-wide" role="listbox">
                <li>
                  <Link href={hrefWith({ type: "" })} className="dropdown-item" replace data-reading-type-option="">
                    {dict.readingHub.filterTypeAll}
                  </Link>
                </li>
                {types.map((item) => (
                  <li key={item.code}>
                    <Link
                      href={optionHref("type", item.code)}
                      className={item.code === current.type ? "dropdown-item dropdown-item-active" : "dropdown-item"}
                      replace
                      data-reading-type-option={item.code}
                      aria-current={item.code === current.type ? "true" : undefined}
                    >
                      {item.label}
                      <span className="dropdown-count">{item.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label mr-1">{dict.readingHub.filterStatus}</span>
        {statusOptions.map((option) => (
          <Link
            key={option.value || "all"}
            href={hrefWith({ status: option.value })}
            className={current.status === option.value ? "chip chip-active" : "chip"}
            data-reading-status={option.value || "all"}
            aria-pressed={current.status === option.value}
            replace
          >
            {option.label}
          </Link>
        ))}

        {hasFilters && (
          <Link
            href={pathname}
            className="btn-ghost ml-auto h-[var(--control-h-sm)]"
            data-reading-reset
            replace
          >
            {dict.readingHub.filterReset}
          </Link>
        )}
      </div>
    </div>
  );
}
