"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { SetSummary } from "@/lib/services/writing/translation";
import { TRANSLATION_BANDS, TRANSLATION_QUESTION_TYPES, type TranslationQuestionType } from "@/lib/writing/translation-rules";

/** Setup (PDF p.8): Random essay or Choose topic, question family, target band. */
export function TranslationStartForm({ dict, sets }: { dict: Dictionary; sets: SetSummary[] }) {
  const t = dict.writingWorkspace.translation;
  const router = useRouter();
  const [path, setPath] = useState<"random" | "topic">("random");
  const [type, setType] = useState<TranslationQuestionType | "">("");
  const [band, setBand] = useState<number | "">("");
  const [setId, setSetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => sets.filter((s) => (!type || s.questionType === type) && (!band || s.targetBand === band)), [sets, type, band]);
  const available = (qt: TranslationQuestionType) => sets.some((s) => s.questionType === qt);

  const start = async () => {
    setBusy(true); setError(null);
    const payload = path === "topic" ? { setId } : { random: { ...(type ? { questionType: type } : {}), ...(band ? { targetBand: band } : {}) } };
    try {
      const res = await fetch("/api/writing/translation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json().catch(() => null)) as { id?: string } | null;
      if (res.ok && data?.id) { router.push(`/writing/translation/${data.id}`); return; }
      setError(res.status === 404 ? t.noMatch : t.startError);
    } catch { setError(t.startError); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5" data-translation-setup>
      <div role="radiogroup" aria-label={t.eyebrow} className="grid gap-3 sm:grid-cols-2">
        {(["random", "topic"] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={path === p} onClick={() => setPath(p)}
            className={`card motion-lift flex min-h-11 flex-col items-start gap-1 p-4 text-left ${path === p ? "border-signal-600 ring-2 ring-signal-600/30" : ""}`} data-translation-path={p}>
            <span className="font-display text-lg text-ink-900">{p === "random" ? t.pathRandom : t.pathTopic}</span>
            <span className="text-sm text-ink-500">{p === "random" ? t.pathRandomBody : t.pathTopicBody}</span>
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink-900">{t.questionType}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip active={type === ""} onClick={() => setType("")}>{t.anyType}</Chip>
          {TRANSLATION_QUESTION_TYPES.map((qt) => (
            <Chip key={qt} active={type === qt} onClick={() => setType(qt)} disabled={!available(qt)} data={qt}>{t.types[qt]}</Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink-900">{t.targetBand}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip active={band === ""} onClick={() => setBand("")}>{t.anyBand}</Chip>
          {TRANSLATION_BANDS.map((b) => <Chip key={b} active={band === b} onClick={() => setBand(b)} disabled={!sets.some((s) => s.targetBand === b)}>{t.band} {b}</Chip>)}
        </div>
      </fieldset>

      {path === "topic" && (
        <ul className="grid gap-2 sm:grid-cols-2" data-translation-sets>
          {filtered.length === 0 ? <li className="text-sm text-ink-500">{t.noMatch}</li> : filtered.map((s) => (
            <li key={s.id}>
              <label className={`card flex min-h-11 cursor-pointer items-start gap-3 p-3 ${setId === s.id ? "border-signal-600" : ""}`}>
                <input type="radio" name="translation-set" value={s.id} checked={setId === s.id} onChange={() => setSetId(s.id)} className="mt-1" />
                <span className="flex flex-col">
                  <span className="font-semibold text-ink-900">{s.title}</span>
                  <span className="text-sm text-ink-500">{s.topic} · {t.types[s.questionType]} · {t.band} {s.targetBand} · {s.sentences} {t.sentences}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <button type="button" className="btn-primary min-h-11 self-start" disabled={busy || (path === "topic" && !setId)} onClick={() => void start()} data-translation-start>{busy ? t.starting : t.start}</button>
        {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      </div>
    </div>
  );
}

function Chip({ active, onClick, disabled, children, data }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; data?: string }) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} data-chip={data}
      className={`min-h-11 rounded-full border px-4 text-sm disabled:opacity-40 ${active ? "border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30" : "border-ink-100 text-ink-700"}`}>
      {children}
    </button>
  );
}
