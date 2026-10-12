"use client";

import { fetchPrivateJson } from "@/lib/client/private-resource";
import { privateResources } from "@/lib/client/private-resource";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { VocabFolder, VocabSentence } from "./types";

type PickerWord = { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string; folderId?: string | null };
type LoadStatus = "loading" | "ready" | "error";

/**
 * USE IT — active production, checked by RIWI.
 *
 * The student writes a sentence with a word; the sentence is stored in the bank
 * first and labelled truthfully ("manual"), then evaluated. The word picker and
 * sentence history load and retry independently, so one optional history query
 * cannot take the authoring control down.
 */
export function VocabUsePanel({
  dict,
  initial = [],
  initialWords = [],
  onSaved,
}: {
  dict: Dictionary;
  initial?: VocabSentence[];
  initialWords?: PickerWord[];
  onSaved: (awarded: boolean) => void;
}) {
  const t = dict.vocabulary;
  const router = useRouter();
  const [sentences, setSentences] = useState<VocabSentence[]>(initial);
  const [words, setWords] = useState<PickerWord[]>(initialWords);
  const [sentencesStatus, setSentencesStatus] = useState<LoadStatus>("loading");
  const [wordsStatus, setWordsStatus] = useState<LoadStatus>("loading");
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<VocabFolder[]>([]);
  const [entryId, setEntryId] = useState(""); // Empty means automatic folder rotation.
  const [position, setPosition] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const submitRef = useRef(false);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);

  const loadSentences = useCallback(async () => {
    setSentencesStatus("loading");
    try {
      // Bounded read: deadline + one transient retry; 401 returns to the server gate.
      const payload = await fetchPrivateJson<Record<string, any>>("/api/vocabulary/sentences?view=history", { onAuthFailure: () => router.refresh(), retries: 0 });
      setSentences(payload.sentences ?? []);
      setSentencesStatus("ready");
    } catch {
      setSentencesStatus("error");
    }
  }, [router]);

  const loadWords = useCallback(async () => {
    requestRef.current?.abort();
    if (advanceRef.current) clearTimeout(advanceRef.current);
    const generation = ++generationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const deadline = setTimeout(() => controller.abort(), 12_000);
    setWordsStatus("loading");
    setWords([]);
    setPosition(0);
    setEntryId("");
    setText("");
    setMessage(null);
    setBusy(false);
    submitRef.current = false;
    let authRefreshRequested = false;
    async function read<T>(url: string): Promise<T> {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (response.status === 401 && !authRefreshRequested) { authRefreshRequested = true; router.refresh(); }
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error("picker_unavailable");
      return body as T;
    }
    try {
      const folderRead = read<{ folders: VocabFolder[] }>("/api/vocabulary/folders");
      // Page the selected folder on the server, rather than filtering the first
      // 100 words of an unrelated library in the browser.
      const wordRead = (async () => {
        const collected: PickerWord[] = [];
        for (let offset = 0; offset <= 100_000; offset += 100) {
          const query = new URLSearchParams({ view: "words", limit: "100", offset: String(offset) });
          if (folderId) query.set("folderId", folderId);
          const page = await read<{ words: PickerWord[]; hasMore?: boolean }>(`/api/vocabulary/sentences?${query}`);
          collected.push(...page.words);
          if (!page.hasMore) return collected;
        }
        throw new Error("picker_too_large");
      })();
      const results = await Promise.allSettled([folderRead, wordRead]);
      if (generation !== generationRef.current) return;
      if (controller.signal.aborted) throw new Error("picker_timeout");
      if (results[0].status === "fulfilled") setFolders(results[0].value.folders ?? []);
      if (results[0].status === "rejected" || results[1].status === "rejected") throw new Error("picker_unavailable");
      setWords(shuffled(results[1].value));
      setWordsStatus("ready");
    } catch {
      if (generation === generationRef.current) setWordsStatus("error");
    } finally {
      clearTimeout(deadline);
    }
  }, [router, folderId]);

  useEffect(() => { void loadSentences(); }, [loadSentences]);
  useEffect(() => {
    void loadWords();
    return () => {
      generationRef.current += 1;
      requestRef.current?.abort();
      if (advanceRef.current) clearTimeout(advanceRef.current);
    };
  }, [loadWords]);

  async function submit() {
    const currentId = entryId || words[position]?.id;
    if (!currentId || text.trim().length < 3 || submitRef.current || advanceRef.current) return;
    submitRef.current = true;
    setBusy(true);
    setMessage(null);
    const generation = generationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const deadline = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(`/api/vocabulary/${currentId}/use`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: text.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (generation !== generationRef.current) return;
      if (!res.ok) {
        setMessage({ tone: "bad", text: t.use.unavailable });
      } else {
        setMessage({ tone: payload.accepted ? "good" : "info", text: `${payload.accepted ? t.use.accepted : t.use.rejected} · ${t.use.checkedBy}: ${payload.checkedBy ?? "RIWI"}${payload.accepted ? ` · ${t.board.points}: +${payload.points ?? 0}` : ""}` });
        privateResources.invalidate("vocabulary:");
        // Only a completed check advances; a network/evaluator failure keeps
        // the same word and draft available for recovery.
        if (!entryId) {
          advanceRef.current = setTimeout(() => {
            advanceRef.current = null;
            if (generation !== generationRef.current) return;
            if (position + 1 < words.length) setPosition(position + 1);
            else { setWords(shuffled(words, currentId)); setPosition(0); }
            setText("");
            setMessage(null);
            setBusy(false);
          }, 1400);
        } else if (payload.accepted) setText("");
      }
      onSaved(res.ok && payload.accepted === true && Number(payload.points) > 0);
      void loadSentences();
    } catch {
      if (generation !== generationRef.current) return;
      setMessage({ tone: "bad", text: t.use.unavailable });
      onSaved(false);
    } finally {
      clearTimeout(deadline);
      if (generation === generationRef.current) {
        submitRef.current = false;
        if (!advanceRef.current) setBusy(false);
      }
    }
  }

  const selected = entryId ? words.find((word) => word.id === entryId) : words[position];

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <h2 className="text-sm font-medium text-ink-900">{t.use.title}</h2>
        <p className="mt-1 text-xs text-ink-500">{t.use.hint}</p>

        {wordsStatus === "loading" && <div className="mt-3 h-12 animate-pulse rounded-md bg-ink-50" aria-busy="true" data-async-loading="vocabulary-use-picker" />}
        {wordsStatus === "error" && <RegionFailure dict={dict} name="use-words" retry={() => void loadWords()} />}
        {wordsStatus === "ready" && words.length === 0 && <p className="mt-3 text-sm text-ink-500">{t.use.noWords}</p>}
        {wordsStatus === "ready" && words.length > 0 && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink-500">
                {t.use.pickFile}
                <select className="input" aria-label={t.use.pickFile} data-sentence-folder value={folderId} disabled={busy} onChange={(event) => setFolderId(event.target.value)}>
                  <option value="">{t.folders.all}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-500">
                {t.use.pick}
                <select
                  className="input"
                  aria-label={t.use.pick}
                  data-sentence-word
                  value={entryId}
                  disabled={busy}
                  onChange={(event) => { setEntryId(event.target.value); setText(""); setMessage(null); }}
                >
                  <option value="">{t.use.autoWords}</option>
                  {words.map((word) => (
                    <option key={word.id} value={word.id}>
                      {word.term}
                    </option>
                  ))}
                </select>
              </label>

            </div>

            {selected && <p className="mt-3 text-sm text-ink-700" data-sentence-current={selected.id}><strong>{selected.term}</strong> — {selected.definitionEn}</p>}
            <label className="mt-3 flex flex-col gap-1 text-xs text-ink-500">
              {t.use.placeholder}
              <textarea
                className="input min-h-[90px]"
                data-sentence-input
                disabled={busy}
                placeholder={t.use.placeholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                data-sentence-submit
                disabled={busy || text.trim().length < 3}
                onClick={() => void submit()}
              >
                {busy ? dict.common.saving : t.use.submit}
              </button>
              {selected?.translationUz && (
                <span className="text-xs text-ink-500">
                  {t.add.translation}: {selected.translationUz}
                </span>
              )}
            </div>

            {message && (
              <p
                data-sentence-message={message.tone}
                className={`mt-2 text-sm ${
                  message.tone === "good"
                    ? "text-band-good"
                    : message.tone === "bad"
                      ? "text-band-bad"
                      : "text-ink-700"
                }`}
              >
                {message.text}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-medium text-ink-900">{t.use.bank}</h2>
        {sentencesStatus === "loading" && <div className="mt-2 flex flex-col gap-2" aria-busy="true" data-async-loading="vocabulary-sentence-history">
          {[0, 1].map((item) => <div key={item} className="h-10 animate-pulse rounded-md bg-ink-50" />)}
        </div>}
        {sentencesStatus === "error" && <RegionFailure dict={dict} name="sentence-history" retry={() => void loadSentences()} />}
        {sentencesStatus === "ready" && sentences.length === 0 && <p className="mt-2 text-sm text-ink-500">{t.use.empty}</p>}
        {sentencesStatus === "ready" && sentences.length > 0 && (
          <ul className="mt-2 divide-y divide-ink-100" data-sentence-bank>
            {sentences.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <span className="min-w-0">
                  <span className="block break-words text-sm text-ink-900">{row.sentence}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{row.term}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  <span
                    data-sentence-status={row.accepted ? "accepted" : row.origin === "riwi" ? "rejected" : "not_evaluated"}
                    className={
                      row.accepted
                        ? "badge bg-band-good/10 text-band-good"
                        : row.origin === "riwi"
                          ? "badge bg-band-warn/15 text-band-warn"
                          : "badge bg-paper-sunken text-ink-500"
                    }
                  >
                    {row.accepted ? t.use.accepted : row.origin === "riwi" ? t.use.rejected : t.add.manual}
                  </span>
                  {row.pointsAwarded > 0 && (
                    <span className="text-ink-500">
                      +{row.pointsAwarded} {t.board.points}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RegionFailure({ dict, name, retry }: { dict: Dictionary; name: string; retry: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm" role="alert" data-vocabulary-region-error={name}>
      <span className="text-ink-700">{dict.errors.unknown}</span>
      <button type="button" className="btn-secondary" onClick={retry} data-region-retry={name}>{dict.errorPage.retry}</button>
    </div>
  );
}

/** Fisher–Yates; a new cycle cannot immediately repeat its last word. */
function shuffled(words: PickerWord[], lastId?: string): PickerWord[] {
  const deck = [...words];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  if (deck.length > 1 && deck[0]?.id === lastId) [deck[0], deck[1]] = [deck[1]!, deck[0]!];
  return deck;
}
