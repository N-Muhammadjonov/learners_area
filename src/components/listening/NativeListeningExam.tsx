"use client";
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
  attemptId,
  testId,
  title,
  audioUrl,
  imageUrl,
  questions,
  initial,
  audioPosition,
  audioStartedAt,
  duration,
}: {
  attemptId: string;
  testId: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
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
      if (mounted.current) setSaved("Saved");
      dirty.current = JSON.stringify(current.current) !== snapshot;
    } catch {
      if (mounted.current)
        setSaved(
          "Saved on this device; server save failed. Retry will keep your answers.",
        );
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
    setSaved("Saving…");
    try {
      localStorage.setItem(key, JSON.stringify({ answers: next }));
    } catch {
      setSaved("Device save unavailable; keeping answers on screen.");
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
      setError(
        "Audio could not play. Check your connection, then retry audio.",
      );
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
      setError("Submit failed. Your answers remain saved. Retry submission.");
      flight.current = false;
      setBusy(false);
    }
  }
  const answered = questions.filter((q) => answers[q.id]?.trim()).length;
  return (
    <div
      ref={container}
      className="mx-auto max-w-5xl space-y-5 bg-white p-4 overflow-auto"
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
        <label>
          Volume
          <input
            aria-label="Volume"
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
              else setError("Fullscreen is unavailable in this browser.");
            } catch {
              setError("Fullscreen could not be opened.");
            }
          }}
        >
          Fullscreen ⛶
        </button>
      </header>
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
          setError(
            "Recording unavailable. Answers are safe; retry when connected.",
          )
        }
      />
      <button
        type="button"
        className="btn-primary"
        onClick={() => void play()}
        disabled={busy || position >= duration - 0.5}
      >
        {started
          ? "Resume recording after interruption"
          : "Play recording — begin"}
      </button>
      <p role="status">{saved}</p>
      {error && <p role="alert">{error}</p>}
      <nav className="flex flex-wrap gap-2" aria-label="Sections">
        {[1, 2, 3, 4].map((s) => (
          <button
            type="button"
            className={section === s ? "btn-primary" : "btn-secondary"}
            key={s}
            aria-pressed={section === s}
            onClick={() => setSection(s)}
          >
            Section {s}
          </button>
        ))}
      </nav>
      {section === 2 && imageUrl && (
        <div className="card">
          <Image
            width={560}
            height={400}
            unoptimized
            src={imageUrl}
            alt="Spring Down Junior School floor plan"
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
                <option value="">Choose an answer</option>
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
      <nav className="listening-question-nav" aria-label="Question navigation">
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
        Submit exam
      </button>
      {confirm && (
        <div
          className="card space-y-3"
          role="dialog"
          aria-label="Confirm submission"
        >
          <p>
            {answered} answered; {questions.length - answered} unanswered.
            Submission is final.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            Confirm submit
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Keep working
          </button>
        </div>
      )}
    </div>
  );
}
