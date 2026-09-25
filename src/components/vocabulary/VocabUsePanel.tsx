"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { VocabSentence } from "./types";

type PickerWord = { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string };

/**
 * USE IT — active production, checked by RIWI.
 *
 * The student writes a sentence with a word; the sentence is stored in the bank
 * first and labelled truthfully ("manual"), then evaluated. An accepted sentence
 * is the largest award in the section and moves mastery to ACTIVE, because using
 * a word in your own writing is real evidence. If the evaluator is unavailable
 * the sentence is kept and marked as not evaluated — the bank never claims a
 * judgement that did not happen.
 */
export function VocabUsePanel({
  dict,
  initial,
  onSaved,
}: {
  dict: Dictionary;
  initial: VocabSentence[];
  onSaved: () => void;
}) {
  const t = dict.vocabulary;
  const [sentences, setSentences] = useState<VocabSentence[]>(initial);
  const [words, setWords] = useState<PickerWord[]>([]);
  const [entryId, setEntryId] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/vocabulary/sentences");
      const payload = await res.json().catch(() => null);
      if (cancelled || !payload?.ok) return;
      setWords(payload.words ?? []);
      setSentences(payload.sentences ?? []);
      if (!entryId && payload.words?.length) setEntryId(payload.words[0].id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!entryId || text.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/vocabulary/${entryId}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: text.trim() }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setMessage({ tone: "bad", text: t.use.unavailable });
    } else if (payload.accepted) {
      setMessage({
        tone: "good",
        text: `${t.use.accepted} · ${t.board.points}: +${payload.points ?? 0} · ${t.use.checkedBy}: ${payload.checkedBy ?? "RIWI"}`,
      });
      setText("");
    } else {
      setMessage({
        tone: "info",
        text: `${t.use.rejected} · ${t.use.checkedBy}: ${payload.checkedBy ?? "RIWI"}`,
      });
    }

    const refreshed = await fetch("/api/vocabulary/sentences");
    const latest = await refreshed.json().catch(() => null);
    if (latest?.ok) {
      setSentences(latest.sentences ?? []);
      setWords(latest.words ?? []);
    }
    onSaved();
  }

  const selected = words.find((word) => word.id === entryId);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <h2 className="text-sm font-medium text-ink-900">{t.use.title}</h2>
        <p className="mt-1 text-xs text-ink-500">{t.use.hint}</p>

        {words.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">{t.use.noWords}</p>
        ) : (
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
        {sentences.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">{t.use.empty}</p>
        ) : (
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
