"use client";

import { fetchPrivateJson } from "@/lib/client/private-resource";
import { privateResources } from "@/lib/client/private-resource";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { VocabSentence } from "./types";

type PickerWord = { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string };
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
  const [entryId, setEntryId] = useState<string>(initialWords[0]?.id ?? "");
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
    setWordsStatus("loading");
    try {
      // Bounded read: deadline + one transient retry; 401 returns to the server gate.
      const payload = await fetchPrivateJson<Record<string, any>>("/api/vocabulary/sentences?view=words&limit=100", { onAuthFailure: () => router.refresh(), retries: 0 });
      const nextWords: PickerWord[] = payload.words ?? [];
      setWords(nextWords);
      setEntryId((current) => current && nextWords.some((word) => word.id === current) ? current : nextWords[0]?.id ?? "");
      setWordsStatus("ready");
    } catch {
      setWordsStatus("error");
    }
  }, [router]);

  useEffect(() => {
    void loadSentences();
    void loadWords();
  }, [loadSentences, loadWords]);

  async function submit() {
    if (!entryId || text.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/vocabulary/${entryId}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: text.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "bad", text: t.use.unavailable });
      } else if (payload.accepted) {
        setMessage({ tone: "good", text: `${t.use.accepted} · ${t.board.points}: +${payload.points ?? 0} · ${t.use.checkedBy}: ${payload.checkedBy ?? "RIWI"}` });
        setText("");
      } else {
        setMessage({ tone: "info", text: `${t.use.rejected} · ${t.use.checkedBy}: ${payload.checkedBy ?? "RIWI"}` });
      }
      if (res.ok) privateResources.invalidate("vocabulary:");
      onSaved(res.ok && payload.accepted === true && Number(payload.points) > 0);
      void loadSentences();
    } catch {
      setMessage({ tone: "bad", text: t.use.unavailable });
      onSaved(false);
    } finally {
      setBusy(false);
    }
  }

  const selected = words.find((word) => word.id === entryId);

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
                {t.use.pick}
                <select
                  className="input"
                  aria-label={t.use.pick}
                  data-sentence-word
                  value={entryId}
                  onChange={(event) => setEntryId(event.target.value)}
                >
                  {words.map((word) => (
                    <option key={word.id} value={word.id}>
                      {word.term}
                    </option>
                  ))}
                </select>
              </label>
              {selected && <p className="self-end text-xs text-ink-500">{selected.definitionEn}</p>}
            </div>

            <label className="mt-3 flex flex-col gap-1 text-xs text-ink-500">
              {t.use.placeholder}
              <textarea
                className="input min-h-[90px]"
                data-sentence-input
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
