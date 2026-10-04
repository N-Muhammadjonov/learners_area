"use client";
import { ListeningMap } from "./ListeningMap";
import type { MapDiagram } from "@/lib/listening/map-diagram";
import type { Dictionary } from "@/lib/i18n/en";
import { requestJson } from "@/lib/http/client-request";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ListeningPackage } from "@/lib/listening/package";
type Question = Omit<
  ListeningPackage["questions"][number],
  "key" | "alternatives" | "pair" | "evidence"
> & { id: string };
export function NativeListeningExam({
  dict,
  attemptId,
  testId,
  title,
  audioUrl,
  imageUrl,
  mapDiagram,
  questions,
  initial,
  audioPosition,
  audioStartedAt,
  duration,
}: {
  dict: Dictionary;
  attemptId: string;
  testId: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
  mapDiagram?: MapDiagram;
  questions: Question[];
  initial: Record<string, string>;
  audioPosition: number;
  audioStartedAt: string | null;
  duration: number;
}) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const flight = useRef(false);
  const requests = useRef<AbortController[]>([]);
  const mounted = useRef(true);
  const saving = useRef(false);
  const dirty = useRef(false);
  const [answers, setAnswers] = useState(initial);
  const [section, setSection] = useState(1);
  const [started, setStarted] = useState(!!audioStartedAt);
  const [position, setPosition] = useState(audioPosition);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const saveRef = useRef<(startAudio?: boolean) => Promise<void>>(
    async () => {},
  );
  const current = useRef(answers);
  current.current = answers;
  const pos = useRef(audioPosition);
  const startState = useRef(started);
  startState.current = started;
  const key = `la-listening-draft:${attemptId}`;
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        setAnswers({ ...initial, ...data.answers });
        dirty.current = true;
      }
    } catch {}
    return () => {
      mounted.current = false;
      requests.current.forEach((c) => c.abort());
    };
  }, [key, initial]);
  const notesKey = `la-listening-notes:${attemptId}`;
  useEffect(() => {
    try { setNotes(localStorage.getItem(notesKey)?.slice(0, 12000) ?? ""); } catch {}
  }, [notesKey]);
  function updateNotes(value: string) {
    setNotes(value);
    try { localStorage.setItem(notesKey, value); } catch {}
  }
  async function save(startAudio = false) {
    if (saving.current) return;
    saving.current = true;
    const snapshot = JSON.stringify(current.current);
    try {
      const controller = new AbortController();
      requests.current.push(controller);
      const res = await requestJson(
        `/api/listening/attempts/${attemptId}/draft`,
        {
          method: "PUT",
          signal: controller.signal,
          timeoutMs: 12000,
          body: {
            answers: current.current,
            audioPosition: pos.current,
            startAudio,
          },
        },
      );
      requests.current = requests.current.filter((c) => c !== controller);
      if (!res.ok) throw new Error();
      if (mounted.current) setSaved(dict.fullListeningHub.examScreen.saved);
      dirty.current = JSON.stringify(current.current) !== snapshot;
    } catch {
      if (mounted.current)
        setSaved(dict.fullListeningHub.examScreen.deviceOnly);
    } finally {
      saving.current = false;
    }
  }
  saveRef.current = save;
  useEffect(() => {
    const timer = setInterval(() => {
      if (dirty.current || startState.current)
        void saveRef.current(startState.current);
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  function change(id: string, value: string) {
    const next = { ...current.current, [id]: value };
    current.current = next;
    setAnswers(next);
    dirty.current = true;
    setSaved(dict.fullListeningHub.examScreen.saving);
    try {
      localStorage.setItem(key, JSON.stringify({ answers: next }));
    } catch {
      setSaved(dict.fullListeningHub.examScreen.deviceUnavailable);
    }
  }
  async function play() {
    if (!audio.current || pos.current >= duration - 0.5) return;
    setError("");
    try {
      await audio.current.play();
      setStarted(true);
      startState.current = true;
      void save(true);
    } catch {
      setError(dict.fullListeningHub.examScreen.audioPlayFailed);
    }
  }
  async function submit() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const controller = new AbortController();
      requests.current.push(controller);
      const res = await requestJson(
        `/api/listening/attempts/${attemptId}/submit`,
        {
          signal: controller.signal,
          timeoutMs: 12000,
          body: {
            answers: questions.map((q) => ({
              questionId: q.id,
              answer: current.current[q.id] ?? "",
            })),
          },
        },
      );
      requests.current = requests.current.filter((c) => c !== controller);
      if (res.status === 409) {
        router.refresh();
        return;
      }
      if (!res.ok) throw new Error();
      try {
        localStorage.removeItem(key);
      } catch {}
      router.push(`/listening/tests/${testId}/2`);
    } catch {
      setError(dict.fullListeningHub.examScreen.submitFailed);
      flight.current = false;
      setBusy(false);
    }
  }
  const answered = questions.filter((q) => answers[q.id]?.trim()).length;
  return (
    <div
      ref={container}
      className="listening-workspace mx-auto max-w-5xl space-y-5 bg-paper p-4 overflow-auto"
    >
      <header className="card flex flex-wrap items-center gap-4">
        <h1 className="font-display text-2xl">{title} · Full Exam</h1>
        <span>
          {answered} / {questions.length} answered
        </span>
        <span>
          {Math.floor(position / 60)}:
          {String(Math.floor(position % 60)).padStart(2, "0")} /{" "}
          {Math.floor(duration / 60)}:
          {String(Math.floor(duration % 60)).padStart(2, "0")}
        </span>
        <button type="button" className="btn-secondary" aria-expanded={notesOpen} aria-controls="listening-exam-notes" onClick={() => setNotesOpen(open => !open)}>{dict.fullListeningHub.examScreen.noteTaking}</button>
        <label>
          {dict.fullListeningHub.examScreen.volume}
          <input
            aria-label={dict.fullListeningHub.examScreen.volume}
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={1}
            onChange={(e) => {
              if (audio.current) audio.current.volume = Number(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else if (container.current?.requestFullscreen)
                await container.current.requestFullscreen();
              else setError(dict.fullListeningHub.examScreen.fullscreenUnavailable);
            } catch {
              setError(dict.fullListeningHub.examScreen.fullscreenFailed);
            }
          }}
        >
          {dict.fullListeningHub.examScreen.fullscreen}
        </button>
      </header>
      {notesOpen && <aside id="listening-exam-notes" className="card space-y-2 p-4"><label className="block" htmlFor="listening-notes-text">{dict.fullListeningHub.examScreen.noteTaking}</label><textarea id="listening-notes-text" className="input min-h-40" maxLength={12000} value={notes} onChange={e => updateNotes(e.target.value)} /><p className="text-xs text-ink-500">{dict.fullListeningHub.examScreen.notesLocal}</p></aside>}
      <audio
        ref={audio}
        src={audioUrl}
        preload="none"
        onLoadedMetadata={() => {
          if (audio.current) audio.current.currentTime = audioPosition;
        }}
        onRateChange={() => {
          if (audio.current) audio.current.playbackRate = 1;
        }}
        onTimeUpdate={() => {
          pos.current = audio.current?.currentTime ?? 0;
          setPosition(pos.current);
        }}
        onEnded={() => {
          setConfirm(true);
        }}
        onError={() =>
          setError(dict.fullListeningHub.examScreen.recordingUnavailable)
        }
      />
      <button
        type="button"
        className="btn-primary"
        onClick={() => void play()}
        disabled={busy || position >= duration - 0.5}
      >
        {started
          ? dict.fullListeningHub.examScreen.resume
          : dict.fullListeningHub.examScreen.begin}
      </button>
      <p role="status">{saved}</p>
      {error && <p role="alert">{error}</p>}
      <nav className="flex flex-wrap gap-2" aria-label={dict.fullListeningHub.examScreen.sections}>
        {[1, 2, 3, 4].map((s) => (
          <button
            type="button"
            className={section === s ? "btn-primary" : "btn-secondary"}
            key={s}
            aria-pressed={section === s}
            onClick={() => setSection(s)}
          >
            {dict.fullListeningHub.examScreen.section.replace("{n}", String(s))}
          </button>
        ))}
      </nav>
      {section === 2 && mapDiagram && <ListeningMap diagram={mapDiagram} />}
      {section === 2 && imageUrl && (
        <div className="card">
          <Image
            width={560}
            height={400}
            unoptimized
            src={imageUrl}
            alt={dict.fullListeningHub.examScreen.mapAlt.replace("{n}", "2")}
            className="mx-auto max-h-96 max-w-full"
          />
        </div>
      )}
      {questions
        .filter((q) => q.section === section)
        .map((q) => (
          <div
            id={`question-${q.number}`}
            key={q.id}
            className="card space-y-3"
          >
            <p className="text-sm">{q.instruction}</p>
            <label className="block font-medium" htmlFor={`answer-${q.id}`}>
              Q{q.number}. {q.text}
            </label>
            {q.options.length ? (
              <select
                className="input"
                id={`answer-${q.id}`}
                value={answers[q.id] ?? ""}
                onChange={(e) => change(q.id, e.target.value)}
              >
                <option value="">{dict.fullListeningHub.examScreen.chooseAnswer}</option>
                {q.options.map((o, i) => {
                  const letter = /^[A-Z](?:\s|$)/.test(o)
                    ? o[0]
                    : String.fromCharCode(65 + i);
                  return (
                    <option key={o} value={letter}>
                      {o}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                id={`answer-${q.id}`}
                className="input"
                maxLength={500}
                value={answers[q.id] ?? ""}
                autoComplete="off"
                onChange={(e) => change(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      <nav className="listening-question-nav" aria-label={dict.fullListeningHub.examScreen.questionNav}>
        {questions.map((q) => (
          <button
            type="button"
            className={answers[q.id]?.trim() ? "btn-primary" : "btn-secondary"}
            key={q.id}
            onClick={() => {
              setSection(q.section);
              setTimeout(
                () =>
                  document
                    .getElementById(`question-${q.number}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                0,
              );
            }}
            aria-label={`Question ${q.number}, ${answers[q.id]?.trim() ? "answered" : "unanswered"}`}
          >
            {q.number}
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => setConfirm(true)}
      >
        {dict.fullListeningHub.examScreen.submit}
      </button>
      {confirm && (
        <div
          className="card space-y-3"
          role="dialog"
          aria-label={dict.fullListeningHub.examScreen.confirmLabel}
        >
          <p>
            {dict.fullListeningHub.examScreen.confirmText
              .replace("{answered}", String(answered))
              .replace("{unanswered}", String(questions.length - answered))}
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {dict.fullListeningHub.examScreen.confirm}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            {dict.fullListeningHub.examScreen.keepWorking}
          </button>
        </div>
      )}
    </div>
  );
}
