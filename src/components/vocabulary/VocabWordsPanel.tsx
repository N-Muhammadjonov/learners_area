"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { collocationChips, toDate } from "./types";
import type { Mastery, VocabFolder, VocabPack, VocabWord } from "./types";
import { formatDate } from "@/lib/time";

type Summary = {
  total: number;
  due: number;
  byMastery: Record<string, number>;
  nextDueAt: string | Date | null;
};

const MASTERY_TONE: Record<string, string> = {
  new: "badge bg-ink-100 text-ink-500",
  learning: "badge bg-band-warn/15 text-band-warn",
  known: "badge bg-band-good/10 text-band-good",
  active: "badge bg-signal-100 text-signal-700",
  mastered: "badge bg-gold/20 text-ink-900",
};

/**
 * MY WORDS — the library.
 *
 * Everything on this panel is one library: manual words, bulk pastes, topic
 * packs and words that arrived from Reading or Listening all live in the same
 * table, tagged with their source. The add form sends a batch to the engine, so
 * a pasted list and a single word behave identically (sense-aware dedupe, the
 * 1/3/7/16/35 schedule, and one point award per genuinely new word).
 */
export function VocabWordsPanel({
  dict,
  words,
  folders,
  packs,
  summary,
  onRefresh,
}: {
  dict: Dictionary;
  words: VocabWord[];
  folders: VocabFolder[];
  packs: VocabPack[];
  summary: Summary;
  onRefresh: () => void;
}) {
  const t = dict.vocabulary;
  const [rows, setRows] = useState<VocabWord[]>(words);
  const [total, setTotal] = useState(summary.total);
  const [folderFilter, setFolderFilter] = useState<string | "all">("all");
  const [masteryFilter, setMasteryFilter] = useState<"all" | "due" | "weak">("all");
  const [stateFilter, setStateFilter] = useState<Mastery | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    let list = rows;
    if (folderFilter !== "all") {
      list = list.filter((word) => (folderFilter === "none" ? !word.folderId : word.folderId === folderFilter));
    }
    if (masteryFilter === "due") {
      list = list.filter((word) => toDate(word.nextReviewAt).getTime() <= Date.now());
    } else if (masteryFilter === "weak") {
      list = list.filter(
        (word) => word.correctCount + word.incorrectCount > 0 && word.incorrectCount >= word.correctCount
      );
    }
    if (stateFilter !== "all") list = list.filter((word) => word.mastery === stateFilter);
    if (sourceFilter !== "all") {
      list = list.filter((word) => (sourceFilter === "manual" ? !word.sourceType : word.sourceType === sourceFilter));
    }
    return list;
  }, [rows, folderFilter, masteryFilter, stateFilter, sourceFilter]);

  /**
   * The word map: where the library actually came from and how far along it is.
   * Both halves are counted from the student's own rows and both act as filters,
   * so the map is how you navigate the library rather than a picture of it.
   */
  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const word of rows) {
      const key = word.sourceType ?? "manual";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const byState: { state: Mastery; count: number }[] = useMemo(
    () =>
      (["new", "learning", "known", "active", "mastered"] as const).map((state) => ({
        state,
        count: rows.filter((word) => word.mastery === state).length,
      })),
    [rows]
  );

  const mapFiltered = stateFilter !== "all" || sourceFilter !== "all";

  async function reload() {
    const res = await fetch("/api/vocabulary?limit=200");
    const payload = await res.json().catch(() => null);
    if (payload?.words) {
      setRows(payload.words);
      setTotal(payload.total ?? payload.words.length);
    }
  }

  const known = summary.byMastery.known ?? 0;
  const mastered = summary.byMastery.mastered ?? 0;
  const active = summary.byMastery.active ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t.summary.words} value={total} />
        <Stat label={t.summary.known} value={known} />
        <Stat label={t.summary.active} value={active} />
        <Stat label={t.summary.mastered} value={mastered} />
        <Stat label={t.summary.dueToday} value={summary.due} tone={summary.due > 0 ? "warn" : undefined} />
      </div>

      <div className="card flex flex-col gap-3 p-4" data-word-map>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink-900">{t.map.title}</h2>
          {mapFiltered && (
            <button
              type="button"
              className="text-xs text-signal-600 hover:underline"
              data-word-map-clear
              onClick={() => {
                setStateFilter("all");
                setSourceFilter("all");
              }}
            >
              {t.map.clear}
            </button>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-300">{t.map.byState}</p>
          <div className="flex flex-wrap gap-2">
            {byState.map((row) => (
              <button
                key={row.state}
                type="button"
                data-word-map-state={row.state}
                data-word-map-count={row.count}
                aria-pressed={stateFilter === row.state}
                onClick={() => setStateFilter((current) => (current === row.state ? "all" : row.state))}
                className={`flex items-center gap-2 rounded-sm border px-2 py-1 text-xs ${
                  stateFilter === row.state
                    ? "border-signal-600 bg-signal-50 text-ink-900"
                    : "border-ink-100 text-ink-700 hover:bg-paper-sunken"
                }`}
              >
                <span>{t.mastery[row.state]}</span>
                <span className="font-mono text-ink-500">{row.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-300">{t.map.bySource}</p>
          <div className="flex flex-wrap gap-2">
            {bySource.length === 0 ? (
              <span className="text-xs text-ink-300" data-word-map-empty>
                {t.map.empty}
              </span>
            ) : (
              bySource.map(([source, count]) => (
                <button
                  key={source}
                  type="button"
                  data-word-map-source={source}
                  data-word-map-count={count}
                  aria-pressed={sourceFilter === source}
                  onClick={() => setSourceFilter((current) => (current === source ? "all" : source))}
                  className={`flex items-center gap-2 rounded-sm border px-2 py-1 text-xs ${
                    sourceFilter === source
                      ? "border-signal-600 bg-signal-50 text-ink-900"
                      : "border-ink-100 text-ink-700 hover:bg-paper-sunken"
                  }`}
                >
                  <span>{t.sources[source as keyof typeof t.sources] ?? source}</span>
                  <span className="font-mono text-ink-500">{count}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <p className="text-xs text-ink-300">{t.map.hint}</p>
      </div>

      <AddWords
        dict={dict}
        folders={folders}
        packs={packs}
        onAdded={async (result) => {
          setNotice(
            `${t.add.added}: ${result.added} · ${result.duplicates} ${t.add.duplicates} · +${result.points} ${t.board.points}`
          );
          await reload();
          onRefresh();
        }}
      />

      {notice && (
        <p className="rounded-sm border border-ink-100 bg-paper-sunken px-3 py-2 text-sm text-ink-700" data-vocab-notice>
          {notice}
        </p>
      )}

      <Folders
        dict={dict}
        folders={folders}
        active={folderFilter}
        onPick={setFolderFilter}
        onCreated={async () => {
          await reload();
          onRefresh();
        }}
        onMoved={async () => {
          await reload();
          onRefresh();
        }}
        words={visible}
      />

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink-900">{t.add.list}</h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t.mastery.all}>
            {(["all", "due", "weak"] as const).map((key) => (
              <button
                key={key}
                type="button"
                data-filter={key}
                aria-pressed={masteryFilter === key}
                onClick={() => setMasteryFilter(key)}
                className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                  masteryFilter === key
                    ? "bg-signal-600 text-signal-contrast"
                    : "bg-paper-sunken text-ink-500 hover:text-ink-900"
                }`}
              >
                {key === "all" ? t.mastery.all : key === "due" ? t.mastery.due : t.mastery.weak}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-ink-500">{t.add.empty}</p>
        ) : (
          <ul className="divide-y divide-ink-100" data-vocab-list>
            {visible.map((word) => {
              const open = openId === word.id;
              return (
                <li key={word.id} className="py-3" data-vocab-entry={word.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
                    onClick={() => setOpenId(open ? null : word.id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-900">{word.term}</span>
                      <span className="mt-0.5 block break-words text-xs text-ink-500">
                        {word.definitionEn}
                      </span>
                      {word.translationUz && (
                        <span className="mt-0.5 block text-xs text-ink-700">{word.translationUz}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      {word.sourceType && word.sourceType !== "manual" && (
                        <span className="badge bg-paper-sunken text-ink-500">{word.sourceType}</span>
                      )}
                      <span className={MASTERY_TONE[word.mastery] ?? MASTERY_TONE.new}>
                        {t.mastery[word.mastery]}
                      </span>
                    </span>
                  </button>

                  {open && (
                    <div className="mt-3 grid gap-2 rounded-sm bg-paper-sunken p-3 text-xs text-ink-700 sm:grid-cols-3">
                      <Detail label={t.add.correct} value={String(word.correctCount)} />
                      <Detail label={t.add.missed} value={String(word.incorrectCount)} />
                      <Detail label={t.add.usedInSentences} value={String(word.activeUseCount)} />
                      <Detail label={t.revision.stage} value={String(word.srsStage + 1)} />
                      <Detail label={t.add.interval} value={`${word.intervalDays} ${t.add.days}`} />
                      <Detail
                        label={t.add.nextReview}
                        value={formatDate(word.nextReviewAt)}
                      />
                      {word.exampleSentence && (
                        <p className="sm:col-span-3 italic text-ink-500">{word.exampleSentence}</p>
                      )}
                      {collocationChips(word.collocations).length > 0 && (
                        <p className="flex flex-wrap gap-1.5 sm:col-span-3" data-collocations>
                          {collocationChips(word.collocations).map((phrase) => (
                            <span key={phrase} className="rounded-full bg-paper-raised px-2 py-0.5 text-xs text-ink-700">
                              {phrase}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {total > rows.length && (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={async () => {
              const res = await fetch(`/api/vocabulary?limit=200&offset=${rows.length}`);
              const payload = await res.json().catch(() => null);
              if (payload?.words) setRows((current) => [...current, ...payload.words]);
            }}
          >
            {t.add.more}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="card p-3">
      <p className="text-xs uppercase tracking-wide text-ink-300">{label}</p>
      <p className={`mt-1 font-display text-xl ${tone === "warn" ? "text-band-warn" : "text-ink-900"}`}>
        {value}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-ink-300">{label}: </span>
      <span className="text-ink-900">{value}</span>
    </p>
  );
}

type AddResult = { added: number; duplicates: number; points: number };

function AddWords({
  dict,
  folders,
  packs,
  onAdded,
}: {
  dict: Dictionary;
  folders: VocabFolder[];
  packs: VocabPack[];
  onAdded: (result: AddResult) => void | Promise<void>;
}) {
  const t = dict.vocabulary;
  const [mode, setMode] = useState<"bulk" | "single">("bulk");
  const [bulk, setBulk] = useState("");
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [translation, setTranslation] = useState("");
  const [example, setExample] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState<string | null>(null);

  /**
   * `word — meaning — uzbek` per line. The em dash is the documented separator,
   * but a colon or a plain hyphen works too, because students paste from notes
   * and messages rather than from a form.
   */
  function parseBulk(text: string) {
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+[—–-]{1,2}\s+|\s*:\s*|\s*\|\s*/).map((part) => part.trim());
        const [rawTerm, rawMeaning, rawUz] = parts;
        return {
          term: rawTerm ?? "",
          definitionEn: rawMeaning && rawMeaning.length > 0 ? rawMeaning : rawTerm ?? "",
          translationUz: rawUz && rawUz.length > 0 ? rawUz : null,
        };
      })
      .filter((item) => item.term.length > 0);
  }

  async function submit() {
    setError(null);
    const items =
      mode === "bulk"
        ? parseBulk(bulk)
        : term.trim()
          ? [
              {
                term: term.trim(),
                definitionEn: definition.trim() || term.trim(),
                translationUz: translation.trim() || null,
                exampleSentence: example.trim() || null,
              },
            ]
          : [];

    if (items.length === 0) {
      setError(t.add.nothing);
      return;
    }

    setBusy(true);
    const res = await fetch("/api/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, folderId: folderId || null, sourceType: "manual" }),
    });
    setBusy(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(String((payload as { error?: string }).error ?? dict.errors.unknown));
      return;
    }

    const payload = (await res.json()) as AddResult;
    setBulk("");
    setTerm("");
    setDefinition("");
    setTranslation("");
    setExample("");
    await onAdded(payload);
  }

  async function addPack(packId: string) {
    setPackBusy(packId);
    const res = await fetch("/api/vocabulary/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId }),
    });
    setPackBusy(null);
    if (!res.ok) {
      setError(dict.errors.unknown);
      return;
    }
    const payload = (await res.json()) as AddResult;
    await onAdded(payload);
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-900">{t.add.title}</h2>
        <div className="flex gap-1" role="group" aria-label={t.add.title}>
          {(["bulk", "single"] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-add-mode={key}
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                mode === key ? "bg-signal-600 text-signal-contrast" : "bg-paper-sunken text-ink-500"
              }`}
            >
              {key === "bulk" ? t.add.hint : t.addWord}
            </button>
          ))}
        </div>
      </div>

      {mode === "bulk" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="vocab-bulk" className="sr-only">
            {t.add.hint}
          </label>
          <textarea
            id="vocab-bulk"
            className="input min-h-[110px] font-mono text-xs"
            placeholder={t.add.placeholder}
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
          />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.add.term}
            <input className="input" value={term} onChange={(event) => setTerm(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.add.definition}
            <input
              className="input"
              value={definition}
              onChange={(event) => setDefinition(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.add.translation}
            <input
              className="input"
              value={translation}
              onChange={(event) => setTranslation(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.add.example}
            <input className="input" value={example} onChange={(event) => setExample(event.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-band-bad">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[220px]"
          aria-label={t.folders.title}
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="">{t.folders.unassigned}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <button className="btn-primary" type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? dict.common.saving : t.add.button}
        </button>
      </div>

      {packs.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.packs.title}</h3>
          <p className="mt-1 text-xs text-ink-500">{t.packs.hint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                data-pack={pack.id}
                className="btn-gold text-xs"
                disabled={packBusy === pack.id}
                onClick={() => void addPack(pack.id)}
              >
                {pack.label}
                <span className="text-ink-500">
                  · {pack.wordCount} {t.packs.words}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Folders({
  dict,
  folders,
  active,
  onPick,
  onCreated,
  onMoved,
  words,
}: {
  dict: Dictionary;
  folders: VocabFolder[];
  active: string;
  onPick: (value: string | "all") => void;
  onCreated: () => Promise<void>;
  onMoved: () => Promise<void>;
  words: VocabWord[];
}) {
  const t = dict.vocabulary;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/vocabulary/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(dict.errors.unknown);
      return;
    }
    const payload = (await res.json().catch(() => ({}))) as { existing?: boolean };
    if (payload.existing) setError(t.folders.exists);
    setName("");
    await onCreated();
  }

  async function move() {
    if (selected.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/vocabulary/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds: selected, folderId: moveTarget || null }),
    });
    setBusy(false);
    if (res.ok) {
      setSelected([]);
      await onMoved();
    }
  }

  return (
    <div className="card p-4">
      <h2 className="text-sm font-medium text-ink-900">{t.folders.title}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          data-folder="all"
          aria-pressed={active === "all"}
          onClick={() => onPick("all")}
          className={`rounded-full px-3 py-1 text-xs ${
            active === "all" ? "bg-signal-600 text-signal-contrast" : "bg-paper-sunken text-ink-500"
          }`}
        >
          {t.folders.all}
        </button>
        <button
          type="button"
          data-folder="none"
          aria-pressed={active === "none"}
          onClick={() => onPick("none")}
          className={`rounded-full px-3 py-1 text-xs ${
            active === "none" ? "bg-signal-600 text-signal-contrast" : "bg-paper-sunken text-ink-500"
          }`}
        >
          {t.folders.unassigned}
        </button>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            data-folder={folder.id}
            aria-pressed={active === folder.id}
            onClick={() => onPick(folder.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              active === folder.id ? "bg-signal-600 text-signal-contrast" : "bg-paper-sunken text-ink-500"
            }`}
          >
            {folder.name} · {folder.count}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          {t.folders.name}
          <input
            className="input max-w-[200px]"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => void create()}>
          {t.folders.create}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
        <span className="text-xs text-ink-500">
          {t.add.move}: {selected.length}
        </span>
        <select
          className="input max-w-[200px]"
          aria-label={t.add.move}
          value={moveTarget}
          onChange={(event) => setMoveTarget(event.target.value)}
        >
          <option value="">{t.folders.unassigned}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary"
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => void move()}
        >
          {t.add.move}
        </button>
        <span className="text-xs text-ink-300">
          {words.length} {t.packs.words}
        </span>
      </div>

      {words.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {words.slice(0, 24).map((word) => {
            const picked = selected.includes(word.id);
            return (
              <button
                key={word.id}
                type="button"
                data-pick={word.id}
                aria-pressed={picked}
                onClick={() =>
                  setSelected((current) =>
                    picked ? current.filter((id) => id !== word.id) : [...current, word.id]
                  )
                }
                className={`rounded-sm border px-2 py-0.5 text-xs ${
                  picked
                    ? "border-signal-600 bg-signal-100 text-signal-700"
                    : "border-ink-100 text-ink-500 hover:text-ink-900"
                }`}
              >
                {word.term}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-band-bad">{error}</p>}
    </div>
  );
}
