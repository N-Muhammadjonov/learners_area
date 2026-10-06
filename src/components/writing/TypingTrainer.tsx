"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { groupTypingLines, type LineRange } from "@/lib/services/writing/typing-lines";
import type { TypingPreset } from "@/lib/services/writing/typing";
import { formatDate } from "@/lib/time";

type Preset = 0 | TypingPreset;
type Phase = "loading" | "ready" | "running" | "saving" | "result" | "error";
type Summary = { count: number; bestWpm: number | null; bestAccuracy: number | null };
type HistoryRow = {
  id: string;
  createdAt: string;
  wpm: number;
  accuracy: number;
  durationMs: number;
  mistakes: number;
  presetSeconds: number | null;
  title: string;
};
type TextData = {
  id: string;
  title: string;
  words: string[];
  wordCount: number;
  difficulty: string | null;
  topic: string | null;
};
type RunResult = {
  runId: string;
  title: string;
  presetSeconds: number | null;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number | null;
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
  typedChars: number;
  targetChars: number;
  mistakes: number;
  completion: number;
  durationMs: number;
};
type Graph = { chars: number[]; errors: number[] };

const PRESETS: Array<{ value: Preset; label: string; key: "s30" | "m1" | "m2" | "m3" | "presetFull" }> = [
  { value: 30, label: "30s", key: "s30" },
  { value: 60, label: "1m", key: "m1" },
  { value: 120, label: "2m", key: "m2" },
  { value: 180, label: "3m", key: "m3" },
  { value: 0, label: "Full", key: "presetFull" },
];

function mmss(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => null) as (T & { error?: string | { code?: string } }) | null;
    if (!response.ok) {
      const error = typeof data?.error === "string" ? data.error : data?.error?.code ?? "request_failed";
      return { ok: false, error };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

function IconNext() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IconRepeat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4" />
    </svg>
  );
}

function IconPauseOrb({ paused }: { paused: boolean }) {
  return (
    <svg className="typing-pause-orb-svg" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="typing-pause-orb-ring" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" opacity=".72" />
      <circle className="typing-pause-orb-dot" cx="12" cy="2.7" r="1.25" fill="currentColor" />
      {paused ? (
        <path d="M9.4 7.8 16 12l-6.6 4.2V7.8Z" fill="currentColor" />
      ) : (
        <>
          <rect x="8.2" y="7.4" width="2.7" height="9.2" rx="1.15" fill="currentColor" />
          <rect x="13.1" y="7.4" width="2.7" height="9.2" rx="1.15" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/**
 * Writing → Typing is deliberately a focused typing surface:
 * no textarea, no Start button, no IELTS Band/Task selector. The first real
 * keystroke starts a signed server-timed run.
 */
export function TypingTrainer({
  dict,
  initialSummary,
  initialHistory,
}: {
  dict: Dictionary;
  initialSummary: Summary;
  initialHistory: HistoryRow[];
}) {
  const t = dict.writingWorkspace.typing;
  const [preset, setPreset] = useState<Preset>(30);
  const [phase, setPhase] = useState<Phase>("loading");
  const [text, setText] = useState<TextData | null>(null);
  const [lines, setLines] = useState<{ id: string; ranges: LineRange[] }>({ id: "", ranges: [] });
  const [remaining, setRemaining] = useState(30);
  const [result, setResult] = useState<RunResult | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [focused, setFocused] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [windowStart, setWindowStart] = useState(0);
  const [history, setHistory] = useState(initialHistory);
  const [summary, setSummary] = useState(initialSummary);
  const [, rerender] = useReducer((value: number) => value + 1, 0);

  const typed = useRef({ committed: [] as string[], buffer: "" });
  const phaseRef = useRef<Phase>("loading");
  const presetRef = useRef<Preset>(30);
  const textRef = useRef<TextData | null>(null);
  const prepToken = useRef("");
  const runPromise = useRef<Promise<string | null> | null>(null);
  const runTokenRef = useRef("");
  const startedAt = useRef(0);
  const pausedAtPerf = useRef<number | null>(null);
  const pausedTotalMs = useRef(0);
  const timer = useRef<number | null>(null);
  const samples = useRef<number[]>([]);
  const errorSeconds = useRef<number[]>([]);
  const finishing = useRef(false);
  const loadSequence = useRef(0);
  const lineTransitionTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  const charsTyped = useCallback(
    () =>
      typed.current.committed.reduce((sum, word) => sum + word.length + 1, 0) +
      typed.current.buffer.length,
    [],
  );
  const pushSample = useCallback(() => {
    const current = charsTyped();
    const previous = samples.current.at(-1) ?? 0;
    // Backspace may reduce the visible text length. Samples represent typing
    // activity over time, so never let a later sample move backwards.
    samples.current.push(Math.max(previous, current));
  }, [charsTyped]);
  const elapsedSeconds = useCallback(() => {
    if (!startedAt.current) return 0;
    const now = performance.now();
    const currentPause = pausedAtPerf.current === null ? 0 : now - pausedAtPerf.current;
    return Math.max(0, (now - startedAt.current - pausedTotalMs.current - currentPause) / 1000);
  }, []);

  const load = useCallback(async (
    options: { textId?: string; excludeTextId?: string } = {},
    nextPreset: Preset = presetRef.current,
  ) => {
    const seq = ++loadSequence.current;
    stopTimer();
    finishing.current = false;
    runPromise.current = null;
    runTokenRef.current = "";
    pausedAtPerf.current = null;
    pausedTotalMs.current = 0;
    setPaused(false);
    setPauseBusy(false);
    typed.current = { committed: [], buffer: "" };
    samples.current = [];
    errorSeconds.current = [];
    if (lineTransitionTimer.current !== null) {
      window.clearTimeout(lineTransitionTimer.current);
      lineTransitionTimer.current = null;
    }
    if (stackRef.current) {
      stackRef.current.style.transition = "none";
      stackRef.current.style.transform = "translateY(0)";
    }
    setWindowStart(0);
    setResult(null);
    setGraph(null);
    setRemaining(nextPreset === 0 ? 0 : nextPreset);
    setPhaseSafe("loading");

    const response = await postJson<{ token: string; text: TextData }>("/api/writing/typing/prepare", {
      preset: nextPreset,
      textId: options.textId,
      excludeTextId: options.excludeTextId,
    });
    if (seq !== loadSequence.current) return;
    if (!response.ok) {
      setPhaseSafe("error");
      return;
    }
    prepToken.current = response.data.token;
    textRef.current = response.data.text;
    setText(response.data.text);
    setPhaseSafe("ready");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setPhaseSafe, stopTimer]);

  useEffect(() => {
    void load({}, presetRef.current);
    return () => {
      loadSequence.current += 1;
      stopTimer();
      if (lineTransitionTimer.current !== null) {
        window.clearTimeout(lineTransitionTimer.current);
        lineTransitionTimer.current = null;
      }
    };
  }, [load, stopTimer]);

  const choosePreset = (value: Preset) => {
    if (value === presetRef.current || !["ready", "result", "error"].includes(phaseRef.current)) return;
    presetRef.current = value;
    setPreset(value);
    void load({ textId: textRef.current?.id }, value);
  };

  const words = text?.words ?? [];
  const measureChildren = useMemo(
    () => words.map((word, index) => <Fragment key={index}><span>{word}</span>{" "}</Fragment>),
    [words],
  );

  const measure = useCallback(() => {
    const element = measureRef.current;
    const currentText = textRef.current;
    if (!element || !currentText) return;
    const tops = Array.from(element.children).map((child) => (child as HTMLElement).offsetTop);
    const ranges = groupTypingLines(tops);
    setLines((previous) => {
      if (previous.id === currentText.id && JSON.stringify(previous.ranges) === JSON.stringify(ranges)) return previous;
      return { id: currentText.id, ranges };
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [text, measure]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    void document.fonts?.ready.then(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [measure]);

  const finish = useCallback(async () => {
    if (finishing.current || phaseRef.current !== "running" || pausedAtPerf.current !== null) return;
    finishing.current = true;
    stopTimer();
    inputRef.current?.blur();
    setPhaseSafe("saving");

    const elapsed = elapsedSeconds();
    const selectedPreset = presetRef.current;
    const scoringSeconds =
      selectedPreset > 0 && elapsed >= selectedPreset
        ? selectedPreset
        : Math.max(1, elapsed);
    while (samples.current.length < Math.floor(scoringSeconds)) {
      pushSample();
    }
    const finalChars = charsTyped();
    const graphSamples = samples.current
      .slice(0, Math.max(1, Math.ceil(scoringSeconds)))
      .map((value) => Math.min(value, finalChars));
    setGraph({ chars: graphSamples, errors: [...errorSeconds.current] });

    const initialRunToken = await runPromise.current;
    const runToken = runTokenRef.current || initialRunToken;
    if (!runToken) {
      setPhaseSafe("error");
      return;
    }
    const payload = {
      runToken,
      typedWords: [...typed.current.committed, typed.current.buffer],
      samples: graphSamples,
    };
    let response = await postJson<{
      run: RunResult;
      summary?: Summary;
      history?: HistoryRow[];
    }>("/api/writing/typing/finish", payload);
    if (!response.ok && response.error === "too_early" && selectedPreset > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_600));
      response = await postJson<{
        run: RunResult;
        summary?: Summary;
        history?: HistoryRow[];
      }>("/api/writing/typing/finish", payload);
    }
    if (!response.ok) {
      setPhaseSafe("error");
      return;
    }

    setResult(response.data.run);
    if (response.data.summary) setSummary(response.data.summary);
    if (response.data.history) setHistory(response.data.history);
    setPhaseSafe("result");
  }, [charsTyped, elapsedSeconds, pushSample, setPhaseSafe, stopTimer]);

  const tick = useCallback(() => {
    if (!startedAt.current || pausedAtPerf.current !== null) return;
    const elapsed = elapsedSeconds() * 1000;
    const seconds = Math.floor(elapsed / 1000);
    const selectedPreset = presetRef.current;
    const cap = selectedPreset > 0 ? selectedPreset : Number.POSITIVE_INFINITY;
    while (samples.current.length < Math.min(seconds, cap)) {
      pushSample();
    }

    if (selectedPreset > 0) {
      const nextRemaining = Math.max(0, Math.ceil((selectedPreset * 1000 - elapsed) / 1000));
      setRemaining((previous) => previous === nextRemaining ? previous : nextRemaining);
      if (elapsed >= selectedPreset * 1000) void finish();
    } else {
      setRemaining((previous) => previous === seconds ? previous : seconds);
    }
  }, [elapsedSeconds, finish, pushSample]);

  const startIfNeeded = () => {
    if (phaseRef.current !== "ready") return;
    setPhaseSafe("running");
    startedAt.current = performance.now();
    runPromise.current = postJson<{ runToken: string }>("/api/writing/typing/start", {
      token: prepToken.current,
    }).then((response) => {
      if (!response.ok) return null;
      runTokenRef.current = response.data.runToken;
      return response.data.runToken;
    });
    timer.current = window.setInterval(tick, 200);
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const currentText = textRef.current;
    const current = typed.current;
    if (!currentText || !["ready", "running"].includes(phaseRef.current) || pausedAtPerf.current !== null) return;

    const nextValue = event.target.value;
    const previous = current.buffer;
    if (nextValue.length <= previous.length || !nextValue.startsWith(previous)) {
      current.buffer = nextValue.replace(/ /g, "").slice(0, 80);
      rerender();
      return;
    }

    for (const character of nextValue.slice(previous.length)) {
      if (current.committed.length >= currentText.words.length) break;
      if (character === " ") {
        if (!current.buffer) continue;
        startIfNeeded();
        current.committed.push(current.buffer);
        current.buffer = "";
      } else {
        startIfNeeded();
        const target = currentText.words[current.committed.length] ?? "";
        if (current.buffer.length < target.length + 20) {
          if (target[current.buffer.length] !== character) {
            errorSeconds.current.push(Math.max(0, Math.floor(elapsedSeconds())));
          }
          current.buffer += character;
        }
      }
    }

    rerender();
    const count = currentText.words.length;
    const complete =
      current.committed.length >= count ||
      (current.committed.length === count - 1 && current.buffer === currentText.words[count - 1]);
    if (complete && phaseRef.current === "running") void finish();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const currentText = textRef.current;
    const current = typed.current;
    if (
      event.key === "Backspace" &&
      current.buffer === "" &&
      current.committed.length > 0 &&
      currentText &&
      phaseRef.current === "running"
    ) {
      const index = current.committed.length - 1;
      const previousWord = current.committed[index]!;
      if (previousWord !== currentText.words[index]) {
        current.buffer = current.committed.pop() ?? "";
        rerender();
      }
    }
  };

  const ranges = text && lines.id === text.id ? lines.ranges : [];
  const wordIndex = typed.current.committed.length;
  let activeLine = ranges.findIndex((line) => wordIndex >= line.start && wordIndex < line.end);
  if (activeLine < 0) activeLine = Math.max(0, ranges.length - 1);

  // Latest owner requirement: exactly three visible rows. Row 1 and row 2 are
  // clear, row 3 is dim. No word-level disappearance. Only after the learner
  // fully enters the next measured visual line does the inner stack move up by
  // exactly one line; the old row 1 is then clipped by overflow:hidden.
  const rollingLineIndexes = [
    windowStart,
    windowStart + 1,
    windowStart + 2,
    windowStart + 3,
  ];

  useLayoutEffect(() => {
    const element = stackRef.current;
    if (!element || activeLine <= windowStart || lineTransitionTimer.current !== null) return;
    const lineHeight = (element.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
    const nextStart = Math.min(windowStart + 1, activeLine);
    if (!lineHeight) {
      setWindowStart(nextStart);
      return;
    }

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setWindowStart(nextStart);
      return;
    }

    element.style.transition = "transform 200ms cubic-bezier(.2,.7,.2,1)";
    element.style.transform = `translateY(-${lineHeight}px)`;
    lineTransitionTimer.current = window.setTimeout(() => {
      element.style.transition = "none";
      element.style.transform = "translateY(0)";
      setWindowStart(nextStart);
      lineTransitionTimer.current = null;
    }, 200);
  }, [activeLine, windowStart]);

  const renderWord = (index: number) => {
    const target = words[index] ?? "";
    const current = typed.current;
    const value =
      index < wordIndex
        ? current.committed[index]
        : index === wordIndex
          ? current.buffer
          : undefined;
    const isCurrent = index === wordIndex;

    return (
      <span key={index} className="typing-word">
        {target.split("").map((character, charIndex) => {
          let state = "typing-char-future";
          if (value !== undefined) {
            state =
              charIndex < value.length
                ? value[charIndex] === character
                  ? "typing-char-correct"
                  : "typing-char-wrong"
                : index < wordIndex
                  ? "typing-char-missed"
                  : "typing-char-future";
          }
          return (
            <Fragment key={charIndex}>
              {isCurrent && charIndex === current.buffer.length && <i className="typing-caret" />}
              <span className={state}>{character}</span>
            </Fragment>
          );
        })}
        {value && value.length > target.length && value.slice(target.length).split("").map((character, extraIndex) => (
          <span key={`extra-${extraIndex}`} className="typing-char-extra">{character}</span>
        ))}
        {isCurrent && current.buffer.length >= target.length && <i className="typing-caret" />}{" "}
      </span>
    );
  };

  const toggleFullPause = useCallback(async () => {
    if (presetRef.current !== 0 || phaseRef.current !== "running" || pauseBusy) return;
    const initialToken = await runPromise.current;
    const token = runTokenRef.current || initialToken;
    if (!token) return;

    setPauseBusy(true);
    const action = pausedAtPerf.current === null ? "pause" : "resume";
    const response = await postJson<{ runToken: string; paused: boolean; pausedMs: number }>(
      "/api/writing/typing/pause",
      { runToken: token, action },
    );
    if (response.ok) {
      runTokenRef.current = response.data.runToken;
      if (response.data.paused) {
        pausedAtPerf.current = performance.now();
        setPaused(true);
      } else {
        if (pausedAtPerf.current !== null) {
          pausedTotalMs.current += performance.now() - pausedAtPerf.current;
        }
        pausedAtPerf.current = null;
        setPaused(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      tick();
    }
    setPauseBusy(false);
  }, [pauseBusy, tick]);

  const busy = phase === "running" || phase === "saving" || phase === "loading";
  const repeat = () => {
    if (textRef.current) void load({ textId: textRef.current.id });
  };
  const next = () => void load({ excludeTextId: textRef.current?.id });
  const status =
    phase === "loading" ? t.loading :
    phase === "saving" ? t.saving :
    phase === "error" ? t.error :
    phase === "result" && result
      ? t.summary
          .replace("{wpm}", String(Math.round(result.wpm)))
          .replace("{acc}", String(Math.round(result.accuracy)))
          .replace("{sec}", String(Math.round(result.durationMs / 1000)))
      : "";

  return (
    <section className="typing-trainer" aria-label={t.title} data-typing-trainer>
      <div className="typing-toolbar">
        <div className="typing-presets" role="radiogroup" aria-label={t.duration}>
          {PRESETS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={preset === item.value}
              aria-label={t[item.key]}
              title={t[item.key]}
              disabled={busy}
              onClick={() => choosePreset(item.value)}
              data-typing-preset={item.value === 0 ? "full" : item.value}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="typing-toolbar-center">
          {(phase === "ready" || phase === "running") && (
            <span
              className={`typing-time ${preset > 0 && remaining <= 10 && phase === "running" ? "typing-time-warning" : ""}`}
              role="timer"
              aria-label={preset === 0 ? t.time : t.remaining}
              data-typing-timer
            >
              {mmss(remaining)}
            </span>
          )}
          {preset === 0 && phase === "running" && (
            <button
              type="button"
              className={`typing-pause-orb ${paused ? "is-paused" : ""}`}
              aria-label={paused ? t.resume : t.pause}
              title={paused ? t.resume : t.pause}
              onClick={() => void toggleFullPause()}
              disabled={pauseBusy}
              data-typing-full-pause
            >
              <IconPauseOrb paused={paused} />
            </button>
          )}
        </div>

        <button
          type="button"
          className="typing-icon-button typing-next-button"
          aria-label={t.next}
          title={t.next}
          disabled={busy}
          onClick={next}
          data-typing-next
        >
          <IconNext />
        </button>
      </div>
      {phase !== "result" && phase !== "error" ? (
        <>
          <div
            className="typing-stage-wrap"
            ref={wrapRef}
            onPointerDown={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            data-typing-stage
          >
            <div className="typing-measure typing-font" ref={measureRef} aria-hidden="true">
              {measureChildren}
            </div>
            <div className="typing-stage typing-font" aria-hidden="true">
              <div className="typing-stack" ref={stackRef}>
                {rollingLineIndexes.map((lineIndex, row) => {
                  const line = ranges[lineIndex];
                  const rowClass =
                    row === 2 ? "typing-row-third" :
                    row === 3 ? "typing-row-buffer" :
                    "typing-row-clear";
                  return (
                    <div key={lineIndex} className={`typing-row ${rowClass}`}>
                      {line && words.slice(line.start, line.end).map((_, offset) =>
                        renderWord(line.start + offset)
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <input
              ref={inputRef}
              className="typing-capture"
              value={typed.current.buffer}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onPaste={(event) => event.preventDefault()}
              onDrop={(event) => event.preventDefault()}
              onBeforeInput={(event) => {
                const inputType = (event.nativeEvent as InputEvent).inputType;
                if (inputType === "insertFromPaste" || inputType === "insertFromDrop") event.preventDefault();
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-label={t.typeHint}
              data-typing-input
            />
          </div>
          <div className="typing-footer">
            <span>
              {phase === "running" && !focused ? t.focus :
               phase === "ready" ? t.typeHint :
               phase === "saving" ? t.saving : ""}
            </span>
          </div>
        </>
      ) : phase === "result" && result && graph ? (
        <ResultView
          result={result}
          graph={graph}
          dict={dict}
          onRepeat={repeat}
          onNext={next}
          history={history}
          summary={summary}
        />
      ) : (
        <div className="typing-error-panel" role="alert">
          <p>{t.error}</p>
          <div className="typing-result-actions">
            <button type="button" className="typing-icon-button typing-icon-primary" aria-label={t.repeat} title={t.repeat} onClick={repeat}>
              <IconRepeat />
            </button>
            <button type="button" className="typing-icon-button typing-icon-primary" aria-label={t.next} title={t.next} onClick={next}>
              <IconNext />
            </button>
          </div>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">{status}</div>
    </section>
  );
}

function ResultView({
  result,
  graph,
  dict,
  onRepeat,
  onNext,
  history,
  summary,
}: {
  result: RunResult;
  graph: Graph;
  dict: Dictionary;
  onRepeat: () => void;
  onNext: () => void;
  history: HistoryRow[];
  summary: Summary;
}) {
  const t = dict.writingWorkspace.typing;
  const chars = graph.chars;
  const count = chars.length;
  const raw = chars.map((value, index) => {
    const windowSize = Math.min(3, index + 1);
    return ((value - (chars[index - windowSize] ?? 0)) / windowSize) * 12;
  });
  const ceiling = Math.max(20, Math.ceil(Math.max(0, ...raw) / 20) * 20);
  const width = 600;
  const height = 200;
  const left = 38;
  const bottom = 24;
  const pad = 8;
  const x = (index: number) => left + (count <= 1 ? 0 : (index / (count - 1)) * (width - left - pad));
  const y = (value: number) => height - bottom - (value / ceiling) * (height - bottom - pad);

  return (
    <div className="typing-result" data-typing-result>
      <div className="typing-result-primary">
        <div><span>{t.wpm}</span><strong>{Math.round(result.wpm)}</strong></div>
        <div><span>{t.accuracy}</span><strong>{Math.round(result.accuracy)}%</strong></div>
      </div>

      <div className="typing-graph-cell">
        <svg className="typing-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.graph}>
          {[0, ceiling / 2, ceiling].map((value) => (
            <g key={value}>
              <line x1={left} x2={width - pad} y1={y(value)} y2={y(value)} />
              <text x={left - 6} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text>
            </g>
          ))}
          {count > 1 && (
            <polyline
              fill="none"
              points={raw.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
            />
          )}
          {graph.errors.map((second, index) => {
            const point = Math.max(0, Math.min(count - 1, second));
            if (count === 0) return null;
            const px = x(point);
            const py = y(raw[point] ?? 0);
            return <path key={index} className="typing-error-marker" d={`M${px - 4} ${py - 4}l8 8m0-8l-8 8`} />;
          })}
        </svg>
      </div>

      <div className="typing-result-stats">
        <div><span>{t.rawWpm}</span><strong>{Math.round(result.rawWpm)}</strong></div>
        <div>
          <span>{t.characters} ({t.correct}/{t.incorrect}/{t.extra}/{t.missed})</span>
          <strong>{result.correct}/{result.incorrect}/{result.extra}/{result.missed}</strong>
        </div>
        {result.consistency !== null && (
          <div><span>{t.consistency}</span><strong>{Math.round(result.consistency)}%</strong></div>
        )}
        <div><span>{t.time}</span><strong>{Math.round(result.durationMs / 1000)}s</strong></div>
      </div>

      <div className="typing-result-actions">
        <button type="button" className="typing-icon-button typing-icon-primary" aria-label={t.repeat} title={t.repeat} onClick={onRepeat} data-typing-repeat>
          <IconRepeat />
        </button>
        <button type="button" className="typing-icon-button typing-icon-primary" aria-label={t.next} title={t.next} onClick={onNext} data-typing-next-result>
          <IconNext />
        </button>
      </div>

      <details className="typing-history">
        <summary>{t.history} · {summary.count} {t.runs}</summary>
        <div className="typing-history-scroll">
          <table>
            <thead>
              <tr><th>{t.text}</th><th>{t.wpm}</th><th>{t.accuracy}</th><th>{t.mode}</th><th>{t.date}</th></tr>
            </thead>
            <tbody>
              {history.slice(0, 10).map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{row.wpm}</td>
                  <td>{row.accuracy}%</td>
                  <td>{row.presetSeconds ? `${row.presetSeconds}s` : t.presetFull}</td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
