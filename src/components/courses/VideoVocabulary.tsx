"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";
export type VideoWord = {occurrenceId: string; id: string; term: string; partOfSpeech: string | null; definitionEn: string; translationUz: string | null; exampleSentence: string | null};
export function VideoVocabulary({id, words, dict}: {id: string; words: VideoWord[]; dict: Dictionary}) {
  const t = dict.videoLesson;
  const request = useScopedRequest();
  const flight = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState("");
  async function save(word: VideoWord) {
    if (flight.current) return;
    flight.current = true; setPending(word.id); setError("");
    const result = await request(`/api/video-lessons/${id}/vocabulary`, {body: {occurrenceId: word.occurrenceId}});
    flight.current = false;
    if (!result) return;
    setPending(null);
    if (result.ok) setSaved(current => [...current, word.id]);
    else setError(apiErrorMessage(result.error, result.status, dict));
  }
  return <div className="flex flex-col gap-3" data-video-vocabulary>
    <p className="text-sm text-ink-500">{t.vocabularyHelp} <Link href="/app/vocabulary" className="underline">{t.vocabularyPractice}</Link></p>
    {error && <p role="alert" className="text-band-bad">{error}</p>}
    {words.map(word => <article key={word.occurrenceId} className="card p-4">
      <p className="font-semibold">{word.term} <span className="text-sm text-ink-500">{word.partOfSpeech}</span></p>
      <p>{word.definitionEn}</p><p>{word.translationUz}</p>
      <p className="mt-2 text-sm italic">{word.exampleSentence}</p>
      <button type="button" className="btn-secondary mt-3" disabled={pending !== null || saved.includes(word.id)} onClick={() => void save(word)}>
        {saved.includes(word.id) ? t.vocabularySaved : pending === word.id ? dict.common.saving : t.vocabularySave}
      </button>
    </article>)}
  </div>;
}
