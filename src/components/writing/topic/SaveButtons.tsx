"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useState } from "react";
import type { PackWord } from "@/lib/services/vocabulary/packs";

/** Save one authored topic word through the canonical vocabulary engine (POST /api/vocabulary). */
export function SaveWordButton({ word, packId, initialSaved, labels }: { word: PackWord; packId: string; initialSaved: boolean; labels: { save: string; saved: string; saving: string; error: string } }) {
  const request = useScopedRequest();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    setBusy(true); setError(false);
    try {
      const res = await request<Record<string, unknown>>("/api/vocabulary", {method: "POST", timeoutMs: 25000, body: {
        items: [{ term: word.term, definitionEn: word.definitionEn, translationUz: word.translationUz, exampleSentence: word.example, partOfSpeech: word.partOfSpeech }],
        topicPack: packId, sourceType: "writing_topic_vocabulary",
      }});
      if (!res) return;
      const data = (res.ok ? res.data : null) as { ok?: boolean } | null;
      if (res.ok && data?.ok !== false) setSaved(true); else setError(true);
    } catch { setError(true); }
    setBusy(false);
  };
  if (saved) return <span className="badge bg-signal-100 text-signal-700" data-topic-word-saved>{labels.saved}</span>;
  return (
    <span className="flex flex-col">
      <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => void save()} data-topic-save-word={word.term}>{busy ? labels.saving : labels.save}</button>
      {error && <span role="alert" className="text-xs text-band-bad">{labels.error}</span>}
    </span>
  );
}

/** Save / unsave a published phrase in the pattern bank (used by Language Stealing). */
export function SavePatternButton({ id, initialSaved, labels }: { id: string; initialSaved: boolean; labels: { save: string; saved: string; error: string } }) {
  const request = useScopedRequest();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const toggle = async () => {
    setBusy(true); setError(false);
    try {
      const res = await request<Record<string, unknown>>(`/api/writing/patterns/${id}`, {method: "PUT", timeoutMs: 25000, body: { saved: !saved }});
      if (!res) return;
      if (res.ok) setSaved(!saved); else setError(true);
    } catch { setError(true); }
    setBusy(false);
  };
  return (
    <span className="flex flex-col">
      <button type="button" aria-pressed={saved} className={`min-h-11 rounded-lg border px-3 text-sm ${saved ? "border-signal-600 bg-signal-50 text-ink-900 dark:bg-signal-950/30" : "border-ink-100 text-ink-700"}`} disabled={busy} onClick={() => void toggle()} data-topic-save-pattern={id}>
        {saved ? `✓ ${labels.saved}` : labels.save}
      </button>
      {error && <span role="alert" className="text-xs text-band-bad">{labels.error}</span>}
    </span>
  );
}
