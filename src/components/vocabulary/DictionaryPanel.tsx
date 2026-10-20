"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { Entry, Sense } from "@/lib/dictionary/model";
import { dictionaryPos } from "@/lib/dictionary/labels";
import { privateResources } from "@/lib/client/private-resource";
import {
  DictionaryRecentSearches,
  type DictionaryRecentSearch as Recent,
} from "./DictionaryRecentSearches";
import {
  DictionaryFolderDialog,
  type DictionaryFolder,
} from "./DictionaryFolderDialog";

type Hit = {
  lexeme_id: string;
  display_lemma: string;
  part_of_speech: string;
  translation_uz: string;
};
export function DictionaryPanel({
  dict,
  owner = false,
  onEdit,
  onAddSense,
  onAddWord,
}: {
  dict: Dictionary;
  owner?: boolean;
  onEdit?: (entry: Entry, sense: Sense) => void;
  onAddSense?: (entry: Entry) => void;
  onAddWord?: () => void;
}) {
  const t = dict.globalDictionary;
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"EN" | "UZ">("EN");
  const [hits, setHits] = useState<Hit[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [release, setRelease] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [folders, setFolders] = useState<DictionaryFolder[]>([]);
  const [selectedSense, setSelectedSense] = useState<Sense | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const entryCacheKeys=useRef<string[]>([]);
  const mounted = useRef(true);
  const base = owner ? "/api/owner/dictionary" : "/api/dictionary";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for(const key of entryCacheKeys.current)privateResources.invalidate(key);
    };
  }, []);
  const read = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, { ...init, cache: "no-store" });
      if (!response.ok) throw Error(t.unavailable);
      return response.json();
    },
    [t.unavailable],
  );

  useEffect(() => {
    if (owner) return;
    const abort = new AbortController();
    void Promise.all([
      read<{ recent: Recent[] }>("/api/dictionary/recent", {
        signal: abort.signal,
      }),
      read<{ folders: DictionaryFolder[] }>("/api/vocabulary/folders", {
        signal: abort.signal,
      }),
    ])
      .then(([history, result]) => {
        setRecent(history.recent);
        setFolders(result.folders);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(t.unavailable);
      });
    return () => abort.abort();
  }, [owner, read, t.unavailable, retry]);

  useEffect(() => {
    const abort = new AbortController();
    const stamp = ++request.current;
    setEntry(null);
    setSelectedSense(null);
    setActive(-1);
    setHits([]);
    setError("");
    if (!query.trim()) {
      setLoading(false);
      return () => abort.abort();
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void read<{ release_id: string; results: Hit[] }>(
        `${base}/search?q=${encodeURIComponent(query)}&direction=${direction}`,
        { signal: abort.signal },
      )
        .then((result) => {
          if (stamp === request.current) {
            setHits(result.results);
            setRelease(result.release_id);
          }
        })
        .catch(() => {
          if (!abort.signal.aborted && stamp === request.current)
            setError(t.unavailable);
        })
        .finally(() => {
          if (stamp === request.current) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, direction, base, read, t.unavailable, retry]);

  async function open(
    hit: Pick<Hit, "lexeme_id" | "display_lemma">,
    search = query,
    lang = direction,
  ) {
    const stamp = ++request.current;
    setLoading(true);
    setError("");
    try {
      const pin = release ? `?release_id=${encodeURIComponent(release)}` : "";
      const cached=release?privateResources.peek<Entry>(`dictionary:entry:${base}:${release}:${hit.lexeme_id}`):null;
      if(cached&&cached.ageMs<300000){setEntry(cached.data);setSaved([]);}
      const result = await read<{ entry: Entry; saved?: string[] }>(
        `${base}/entries/${hit.lexeme_id}${pin}`,
      );
      if (stamp !== request.current || !mounted.current) return;
      const resource=`dictionary:entry:${base}:${result.entry.release_id}:${hit.lexeme_id}`;
      privateResources.set(resource,result.entry);
      entryCacheKeys.current=entryCacheKeys.current.filter(key=>key!==resource);entryCacheKeys.current.push(resource);
      while(entryCacheKeys.current.length>8)privateResources.invalidate(entryCacheKeys.current.shift()!);
      setEntry(result.entry);
      setRelease(result.entry.release_id);
      setSaved(result.saved ?? []);
      setExpanded([]);
      if (!owner) {
        // History failure must not discard an entry that was successfully loaded.
        try {
          await read(`/api/dictionary/entries/${hit.lexeme_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: search || hit.display_lemma,
              direction: lang,
              releaseId: result.entry.release_id,
            }),
          });
          const history = await read<{ recent: Recent[] }>(
            "/api/dictionary/recent",
          );
          if (stamp === request.current && mounted.current)
            setRecent(history.recent);
        } catch {
          if (stamp === request.current && mounted.current)
            setError(t.unavailable);
        }
      }
    } catch {
      if (stamp === request.current && mounted.current) {setEntry(null);setError(t.unavailable);}
    } finally {
      if (stamp === request.current && mounted.current) setLoading(false);
    }
  }

  async function save(folderId: string | null) {
    if (!entry || !selectedSense || saving) return;
    const senseId = selectedSense.sense_id;
    setSaving(senseId);
    try {
      await read("/api/dictionary/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lexemeId: entry.lexeme_id,
          senseId,
          releaseId: entry.release_id,
          folderId,
        }),
      });
      setSaved((current) => [...new Set([...current, senseId])]);
      setSelectedSense(null);
      privateResources.invalidate("vocabulary:");
    } finally {
      setSaving("");
    }
  }
  async function createFolder(name: string) {
    const result = await read<{ folder: DictionaryFolder }>(
      "/api/vocabulary/folders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    setFolders((current) =>
      current.some((folder) => folder.id === result.folder.id)
        ? current
        : [...current, { ...result.folder, count: 0 }],
    );
    privateResources.invalidate("vocabulary:");
    return result.folder;
  }
  const allOpen =
    entry?.senses.every((sense) => expanded.includes(sense.sense_id)) ?? false;
  const synonyms =
    entry?.relations.filter((relation) =>
      ["synonym", "synonymy"].includes(relation.relation_type.toLowerCase()),
    ) ?? [];
  const related =
    entry?.relations.filter(
      (relation) =>
        !["synonym", "synonymy"].includes(relation.relation_type.toLowerCase()),
    ) ?? [];

  return (
    <section
      className="mx-auto w-full max-w-[1120px] space-y-4"
      data-global-dictionary
    >
      {!entry && (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-ink-100 bg-paper-raised p-2">
          <span aria-hidden className="pl-1 text-ink-500">
            ⌕
          </span>
          <input
            className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
            aria-label={t.search}
            placeholder={t.search}
            maxLength={80}
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="dictionary-results"
            aria-expanded={hits.length > 0}
            aria-activedescendant={
              active >= 0 ? `dictionary-hit-${active}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!hits.length) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) =>
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, hits.length - 1)
                    : Math.max(0, index - 1),
                );
              }
              if (event.key === "Enter" && hits[active >= 0 ? active : 0]) {
                event.preventDefault();
                void open(hits[active >= 0 ? active : 0]!);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="btn-ghost min-h-11 min-w-11 px-2"
              aria-label={t.clear}
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
          <div
            className="flex shrink-0 gap-1"
            role="group"
            aria-label={t.search}
          >
            {(["EN", "UZ"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                className={`${direction === lang ? "btn-primary" : "btn-secondary"} min-h-11 px-3`}
                aria-pressed={direction === lang}
                onClick={() => {
                  setDirection(lang);
                  setRelease("");
                }}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="card flex flex-wrap items-center gap-3 p-4"
        >
          <p>{error}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEntry(null);
              setRelease("");
              setRetry((value) => value + 1);
            }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {!entry && (
        <div
          className={`grid min-w-0 gap-4 ${owner ? "" : "lg:grid-cols-[240px_minmax(0,1fr)]"}`}
        >
          {!owner && (
            <aside className={query.trim() ? "hidden lg:block" : ""}>
              <DictionaryRecentSearches
                recent={recent}
                title={t.recent}
                clearLabel={t.clear}
                onOpen={(item) =>
                  void open(item, item.query_display, item.direction)
                }
                onClear={() => {
                  void read("/api/dictionary/recent", { method: "DELETE" })
                    .then(() => setRecent([]))
                    .catch(() => setError(t.unavailable));
                }}
              />
            </aside>
          )}
          <div className="min-w-0">
            {loading ? (
              <div
                role="status"
                aria-label={dict.common.loading}
                className="space-y-2"
              >
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-20 animate-pulse rounded-xl bg-paper-sunken"
                  />
                ))}
              </div>
            ) : !query.trim() ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-ink-100 bg-sky-50/40 p-6 text-center sm:min-h-64">
                <span aria-hidden className="text-4xl text-sky-600">
                  ⌕
                </span>
                <h2 className="text-lg font-semibold">{t.startTitle}</h2>
                <p className="max-w-md text-sm text-ink-500">{t.startHint}</p>
              </div>
            ) : (
              <>
                <h2 className="mb-2 text-sm font-semibold">{t.results}</h2>
                {!error && hits.length === 0 && (
                  <p className="card p-5">{t.empty}</p>
                )}
                <ul
                  id="dictionary-results"
                  role="listbox"
                  aria-label={t.results}
                  className="space-y-2"
                >
                  {hits.map((hit, index) => (
                    <li
                      key={hit.lexeme_id}
                      role="option"
                      aria-selected={active === index}
                      id={`dictionary-hit-${index}`}
                    >
                      <button
                        type="button"
                        className={`w-full rounded-xl border bg-paper-raised p-3 text-left ${active === index ? "border-signal-600" : "border-ink-100"}`}
                        onClick={() => void open(hit)}
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                            <strong className="break-words text-base">
                              {hit.display_lemma}
                            </strong>
                            <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                              {dictionaryPos(hit.part_of_speech)}
                            </span>
                          </span>
                          <span aria-hidden>›</span>
                        </span>
                        <span className="mt-1 block truncate text-sm text-ink-500">
                          {hit.translation_uz}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
      {entry && (
        <article className="space-y-4" data-dictionary-entry>
          <nav
            className="flex min-h-11 items-center gap-2 text-sm"
            aria-label={t.allSenses}
          >
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                request.current++;
                setEntry(null);
                setSelectedSense(null);
                setLoading(false);
              }}
            >
              {t.back}
            </button>
            <span aria-hidden>›</span>
            <span className="truncate">{entry.display_lemma}</span>
          </nav>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="break-words text-3xl font-bold sm:text-4xl">
                {entry.display_lemma}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {entry.pronunciations.map((pronunciation, index) => (
                  <span key={index} className="text-ink-500">
                    /{pronunciation.ipa}/
                  </span>
                ))}
                <span className="rounded-lg bg-sky-50 px-2 py-1 text-sky-700">
                  {dictionaryPos(entry.part_of_speech)}
                </span>
                <span className="rounded-lg bg-paper-sunken px-2 py-1 text-ink-700">
                  {entry.lexical_type.replaceAll("_", " ")}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary min-h-11"
              onClick={() =>
                setExpanded(
                  allOpen ? [] : entry.senses.map((sense) => sense.sense_id),
                )
              }
            >
              {allOpen ? t.collapseAll : t.expandAll}
            </button>
          </header>
          <div className="space-y-3">
            {entry.senses.map((sense, index) => {
              const isExpanded = expanded.includes(sense.sense_id);
              return (
                <section
                  key={sense.sense_id}
                  className="overflow-hidden rounded-xl border border-ink-100 bg-paper-raised"
                  data-dictionary-sense={sense.sense_id}
                >
                  <h3>
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-start gap-3 p-4 text-left"
                      aria-expanded={isExpanded}
                      aria-controls={`dictionary-sense-${sense.sense_id}`}
                      onClick={() =>
                        setExpanded((current) =>
                          isExpanded
                            ? current.filter((id) => id !== sense.sense_id)
                            : [...current, sense.sense_id],
                        )
                      }
                    >
                      <span aria-hidden className="text-sky-600">
                        {isExpanded ? "⊖" : "⊕"}
                      </span>
                      <strong className="min-w-0 flex-1 break-words text-base">
                        {index + 1}.{" "}
                        {sense.translations
                          .map((translation) => translation.text)
                          .join(" · ")}
                      </strong>
                      <span aria-hidden>{isExpanded ? "⌃" : "⌄"}</span>
                    </button>
                  </h3>
                  {isExpanded && (
                    <div
                      id={`dictionary-sense-${sense.sense_id}`}
                      className="space-y-4 px-4 pb-5 sm:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-6 lg:space-y-0"
                    >
                      <div className="max-w-[70ch] space-y-4">
                        {sense.editorial && sense.editorial.translation_status!=="human_reviewed" && <p className="text-sm text-ink-500">{dict.vocabulary.contextUnverified}</p>}
                        <div>
                          <h4 className="mb-1 text-sm font-semibold">
                            {t.english}
                          </h4>
                          <p className="text-base leading-relaxed">
                            {sense.definition_en}
                          </p>
                        </div>
                        <div>
                          <h4 className="mb-1 text-sm font-semibold text-sky-700">
                            {t.definition}
                          </h4>
                          <p className="text-base leading-relaxed">
                            {sense.definition_uz}
                          </p>
                        </div>
                        {!!sense.editorial?.reference_urls.length && <div className="flex flex-wrap gap-2 text-xs">{sense.editorial.reference_urls.map(url=><a key={url} href={url} target="_blank" rel="noreferrer" className="underline">{new URL(url).hostname.replace(/^www\./,"")}</a>)}</div>}
                        {sense.examples.length > 0 && (
                          <div>
                            <h4 className="mb-2 text-sm font-semibold">
                              {t.examples}
                            </h4>
                            <div className="space-y-2">
                              {sense.examples.slice(0, 2).map((example) => (
                                <blockquote
                                  key={example.example_id}
                                  className="rounded-lg bg-paper-sunken p-3"
                                >
                                  <p>
                                    <span className="mr-2 text-xs font-semibold text-sky-700">
                                      {t.exampleEn}
                                    </span>
                                    {example.text_en}
                                  </p>
                                  <p className="mt-1 text-sm text-ink-500">
                                    <span className="mr-2 text-xs font-semibold">
                                      {t.exampleUz}
                                    </span>
                                    {example.text_uz}
                                  </p>
                                </blockquote>
                              ))}
                            </div>
                          </div>
                        )}
                        {sense.examples.length > 2 && (
                          <details className="rounded-lg border border-ink-100 p-3">
                            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                              {t.moreExamples}
                            </summary>
                            {sense.examples.slice(2).map((example) => (
                              <blockquote
                                key={example.example_id}
                                className="mt-2 rounded-lg bg-paper-sunken p-3"
                              >
                                <p>
                                  {t.exampleEn}: {example.text_en}
                                </p>
                                <p className="mt-1 text-sm text-ink-500">
                                  {t.exampleUz}: {example.text_uz}
                                </p>
                              </blockquote>
                            ))}
                          </details>
                        )}
                      </div>
                      <div className="space-y-3">
                        {owner ? (
                          <>
                            <p className="text-sm text-ink-500">{entry.attribution.some(source => source.source_name === "Learners Area") ? t.custom : t.upstream}</p>
                            <button
                              type="button"
                              className="btn-primary w-full"
                              onClick={() => onEdit?.(entry, sense)}
                            >
                              {t.edit}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary min-h-11 w-full"
                            disabled={
                              !!saving || saved.includes(sense.sense_id)
                            }
                            onClick={() => setSelectedSense(sense)}
                          >
                            {saved.includes(sense.sense_id) ? t.saved : t.save}
                          </button>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {[
                            sense.cefr,
                            sense.register,
                            sense.usage_label,
                            ...(sense.domain_tags ?? []),
                          ]
                            .filter(Boolean)
                            .map((label, n) => (
                              <span
                                key={n}
                                className="rounded-lg bg-paper-sunken px-2 py-1 text-xs text-ink-700"
                              >
                                {label}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {owner && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onAddSense?.(entry)}
            >
              {t.addSense}
            </button>
          )}
          {entry.forms.length > 0 && (
            <details className="card p-4">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {t.forms}
              </summary>
              <p className="leading-relaxed">
                {entry.forms.map((form) => form.surface_form).join(" · ")}
              </p>
            </details>
          )}
          {entry.collocations.length > 0 && (
            <details className="card p-4">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {t.collocations}
              </summary>
              <div className="flex flex-wrap gap-2">
                {entry.collocations.map((item, index) => (
                  <span
                    key={index}
                    className="rounded-lg bg-paper-sunken px-3 py-2"
                  >
                    {item.text}
                  </span>
                ))}
              </div>
            </details>
          )}
          {[
            { label: t.synonyms, rows: synonyms },
            { label: t.relations, rows: related },
          ]
            .filter((section) => section.rows.length > 0)
            .map((section) => (
              <details key={section.label} className="card p-4">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {section.label}
                </summary>
                <div className="flex flex-wrap gap-2">
                  {section.rows.map((relation, index) => (
                    <button
                      type="button"
                      key={index}
                      className="btn-secondary"
                      onClick={() =>
                        void open(
                          {
                            lexeme_id: relation.target_lexeme_id,
                            display_lemma: relation.display_lemma,
                          },
                          relation.display_lemma,
                          "EN",
                        )
                      }
                    >
                      {relation.display_lemma}{" "}
                      <span className="text-xs">
                        {dictionaryPos(relation.part_of_speech)}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            ))}
          <details className="text-xs text-ink-500">
            <summary className="min-h-11 cursor-pointer py-3">
              {t.attribution}
            </summary>
            {entry.attribution.map((source) => (
              <p
                key={source.snapshot_id}
                className="mb-2 max-w-[85ch] break-words leading-relaxed"
              >
                {source.attribution_text}
              </p>
            ))}
          </details>
        </article>
      )}
      {!owner && entry && selectedSense && (
        <DictionaryFolderDialog
          dict={dict}
          entry={entry}
          sense={selectedSense}
          folders={folders}
          saving={!!saving}
          onClose={() => setSelectedSense(null)}
          onSave={save}
          onCreate={createFolder}
        />
      )}
      {owner && (
        <button type="button" className="btn-secondary" onClick={onAddWord}>
          {t.custom}
        </button>
      )}
    </section>
  );
}
