"use client";
import { ListeningMap } from "./ListeningMap";
import type { MapDiagram } from "@/lib/listening/map-diagram";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import type { OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";
type Question = {
  number: number;
  section: number;
  text: string;
  instruction: string;
  options: string[];
};
type Result = { number: number; correct: boolean; key: string };
export function FullListeningStudy({
  id,
  userId,
  title,
  audioUrl,
  imageUrl,
  mapDiagram,
  questions,
  sections,
  occurrences = {},
  segmentOccurrences = {},
  lexicalAssistance = false,
  dict,
  initialSection = 1,
}: {
  id: string;
  userId: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
  mapDiagram?: MapDiagram;
  questions: Question[];
  sections: { number: number; title: string; transcript: string }[];
  /** Server-proven transcript spans per section (0029); words outside them resolve as unchecked. */
  occurrences?: Record<number, OccurrenceSpan[]>;
  segmentOccurrences?: Record<string, OccurrenceSpan[]>;
  /** Server decision from the Listening lexical policy; false renders plain text. */
  lexicalAssistance?: boolean;
  dict: Dictionary;
  initialSection?: number;
}) {
  const [section, setSection] = useState(
      sections.some(s => s.number === initialSection) ? initialSection : sections[0]?.number ?? 1,
    ),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [result, setResult] = useState<{
      score: number;
      total: number;
      results: Result[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement>(null),
    flight = useRef<AbortController | null>(null);
  const draftKey = `la-listening-study:${userId}:${id}`;
  useEffect(() => {
    const media = audio.current;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          setAnswers(
            Object.fromEntries(
              Object.entries(parsed).filter(
                ([key, value]) =>
                  /^([1-9]|[1-3][0-9]|40)$/.test(key) &&
                  typeof value === "string" &&
                  value.length <= 500,
              ),
            ),
          );
      }
    } catch {}
    return () => {
      flight.current?.abort();
      media?.pause();
    };
  }, [draftKey]);
  function answer(key: string, value: string) {
    setResult(null);
    setAnswers((old) => {
      const next = { ...old, [key]: value };
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  async function check() {
    if (flight.current || !Object.values(answers).some((v) => v.trim())) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await requestJson<{
        score: number;
        total: number;
        results: Result[];
      }>(`/api/listening/full/${id}/study`, {
        body: { answers },
        signal: controller.signal,
        timeoutMs: 12000,
      });
      if (!controller.signal.aborted) {
        if (response.ok) setResult(response.data);
        else setError(dict.fullListeningHub.study.checkFailed);
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  const textProps = {
    dict,
    sourceType: "listening" as const,
    sourceId: id,
    catalogueLookup: true,
    lexicalAssistance,
  };
  return (
    <main className="listening-workspace mx-auto max-w-[1600px] space-y-6" data-listening-study>
      <Link className="btn-secondary" href={`/app/listening/tests/${id}`}>
        ← Test hub
      </Link>
      <header className="card space-y-3">
        <h1 className="font-display text-3xl font-bold">🎧 {title}</h1>
        <p>{dict.fullListeningHub.study.intro}</p>
        <audio
          ref={audio}
          src={audioUrl}
          controls
          preload="none"
          className="w-full"
          onError={() => setError(dict.fullListeningHub.study.audioUnavailable)}
        />
        <label>
          Speed{" "}
          <select
            className="input w-auto"
            defaultValue="1"
            onChange={(e) => {
              if (audio.current)
                audio.current.playbackRate = Number(e.target.value);
            }}
          >
            {[0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label={dict.formCopy.sections}>
        {sections.map(({ number: n }) => (
          <button
            type="button"
            key={n}
            className={n === section ? "btn-primary" : "btn-secondary"}
            onClick={() => setSection(n)}
          >
            🎧 Section {n}
          </button>
        ))}
      </nav>
      <div className="listening-review-grid">
        <section className="card academic-text space-y-6">
          {section === 2 && mapDiagram && <ListeningMap diagram={mapDiagram} />}
      {section === 2 && imageUrl && (
            <Image
              src={imageUrl}
              alt={dict.formCopy.listeningMap}
              width={560}
              height={400}
              unoptimized
              className="h-auto w-full"
            />
          )}
          {questions
            .filter((q) => q.section === section)
            .map((q) => (
              <article key={q.number} className="space-y-2">
                <p className="text-sm font-semibold">{q.instruction}</p>
                <h2 className="font-bold">Q{q.number}</h2>
                <ClickableText {...textProps} occurrences={segmentOccurrences[`q${q.number}:text`] ?? []} text={q.text} />
                {q.options.length ? (
                  <>
                    <div className="space-y-1">
                      {q.options.map((o, optionIndex) => (
                        <ClickableText key={o} {...textProps} occurrences={segmentOccurrences[`q${q.number}:option:${optionIndex}`] ?? []} text={o} />
                      ))}
                    </div>
                    <label>
                      Q{q.number} answer
                      <select
                        className="input"
                        value={answers[q.number] ?? ""}
                        onChange={(e) =>
                          answer(String(q.number), e.target.value)
                        }
                      >
                        <option value="">{dict.formCopy.choose}</option>
                        {q.options.map((o, i) => (
                          <option
                            key={o}
                            value={
                              /^[A-Z](?:\s|$)/.test(o)
                                ? o[0]
                                : String.fromCharCode(65 + i)
                            }
                          >
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <label>
                    Q{q.number} answer
                    <input
                      className="input"
                      maxLength={500}
                      value={answers[q.number] ?? ""}
                      onChange={(e) => answer(String(q.number), e.target.value)}
                    />
                  </label>
                )}
                {result?.results.find((r) => r.number === q.number) && (
                  <p>
                    {result.results.find((r) => r.number === q.number)!.correct
                      ? "✓ Correct"
                      : "✕ Incorrect"}{" "}
                    · {result.results.find((r) => r.number === q.number)!.key}
                  </p>
                )}
              </article>
            ))}
        </section>
        {sections.find(s => s.number === section)?.transcript && <aside className="card academic-text space-y-4">
          <h2 className="font-display text-xl font-bold">📖 Transcript</h2>
          <ClickableText
            {...textProps}
            occurrences={sections.find((s) => s.number === section)?.transcript ? occurrences[section] ?? [] : []}
            text={
              sections.find((s) => s.number === section)?.transcript ||
              ""
            }
          />
        </aside>}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Practice score: {result.score}/{result.total}
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !Object.values(answers).some((v) => v.trim())}
        onClick={() => void check()}
      >
        {busy ? "Checking…" : "✓ Check practice answers"}
      </button>
    </main>
  );
}
