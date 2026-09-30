"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { RETENTION_LEVELS, RETENTION_LEVEL_CONFIG, RETENTION_READ_SECONDS, type RetentionLevel } from "@/lib/retention/levels";
import type { RetentionAttemptPayload, RetentionClaimResult } from "@/lib/retention/types";

/**
 * The learner's Retention session: reading → recall → result.
 *
 * Three rules shape this component, and all three are properties of the SERVER's
 * behaviour that the browser only displays:
 *
 *   1. The countdown is computed from `readEndsAt` / `writeEndsAt` that came from
 *      the database, corrected by the clock skew measured when the payload was
 *      fetched. Refreshing, sleeping or suspending the tab changes nothing.
 *   2. The recall view never receives the source text, so there is nothing to
 *      reveal — not in the DOM, not in React state, not in a data attribute.
 *   3. Every transition (start, phase change, submit) is confirmed by a server
 *      response before the UI moves on. "Saved" appears only after a 200 from the
 *      draft endpoint; a failed autosave says so instead of pretending.
 */

type SaveState = "idle" | "saving" | "saved" | "failed";

const AUTOSAVE_DELAY_MS = 1_200;

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function useCountdown(deadlineIso: string | null, skewMs: number): number {
  const [seconds, setSeconds] = useState(() => remainingSeconds(deadlineIso, skewMs));
  useEffect(() => {
    setSeconds(remainingSeconds(deadlineIso, skewMs));
    if (!deadlineIso) return;
    const timer = window.setInterval(() => setSeconds(remainingSeconds(deadlineIso, skewMs)), 250);
    return () => window.clearInterval(timer);
  }, [deadlineIso, skewMs]);
  return seconds;
}

function remainingSeconds(deadlineIso: string | null, skewMs: number): number {
  if (!deadlineIso) return 0;
  return Math.ceil((Date.parse(deadlineIso) - (Date.now() + skewMs)) / 1000);
}

function errorText(dict: Dictionary, code: string | undefined): string {
  const table = dict.retentionMemory.errors as Record<string, string | undefined>;
  return (code && table[code]) || dict.retentionMemory.errors.retention_unavailable;
}

export function RetentionSession({ dict, initial }: { dict: Dictionary; initial: RetentionAttemptPayload | null }) {
  const router = useRouter();
  const [payload, setPayload] = useState<RetentionAttemptPayload | null>(initial);
  const [busy, setBusy] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<RetentionLevel>("A2");
  const [error, setError] = useState<string | null>(null);

  const skewMs = useMemo(
    () => (payload ? Date.parse(payload.serverNow) - Date.now() : 0),
    [payload]
  );

  const start = useCallback(
    async (level: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/retention/attempts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ level }),
        });
        const body = (await response.json()) as RetentionAttemptPayload & { error?: string };
        if (!response.ok) {
          setError(errorText(dict, body.error));
          return;
        }
        setPayload(body);
      } catch {
        setError(errorText(dict, "retention_unavailable"));
      } finally {
        setBusy(false);
      }
    },
    [dict]
  );

  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (!payload || refreshing.current) return;
    refreshing.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`/api/retention/attempts/${payload.attemptId}`, { cache: "no-store", signal: controller.signal });
      const body = (await response.json()) as RetentionAttemptPayload & { error?: string };
      if (response.ok) setPayload(body);
    } catch {
      /* The expired reading surface stays hidden; a bounded GET retries. */
    } finally {
      window.clearTimeout(timer);
      refreshing.current = false;
    }
  }, [payload]);

  const onFinished = useCallback(() => {
    setPayload(null);
    router.refresh();
  }, [router]);

  if (!payload) {
    return (
      <div className="flex flex-col gap-4" data-retention-levels>
        <div className="flex flex-col gap-1">
          <h2 className="section-title">{dict.retentionMemory.levelsTitle}</h2>
          <p className="body-text">{dict.retentionMemory.levelHint}</p>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="retention-level-options" role="group" aria-label={dict.retentionMemory.levelsTitle} data-retention-level-list>
          {RETENTION_LEVELS.map((level) => (
            <button key={level} type="button" className="retention-level-option" aria-pressed={selectedLevel === level} disabled={busy} onClick={() => setSelectedLevel(level)} data-retention-level={level}>
              <strong>{level}</strong>
              <span className="meta-text">{dict.retentionMemory.words.replace("{n}", String(RETENTION_LEVEL_CONFIG[level].targetWords))}</span>
              <span className="meta-text">{formatClock(RETENTION_READ_SECONDS)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary w-fit" onClick={() => void start(selectedLevel)} disabled={busy} data-retention-start={selectedLevel}>
          {busy ? dict.common.loading : dict.retentionMemory.start} →
        </button>
      </div>
    );
  }

  if (payload.phase === "reading") {
    return (
      <ReadingPhase
        dict={dict}
        payload={payload}
        skewMs={skewMs}
        onPhaseOver={refresh}
        onFinished={onFinished}
      />
    );
  }

  if (payload.phase === "recall") {
    return <RecallPhase key={payload.attemptId} dict={dict} payload={payload} skewMs={skewMs} onResult={setPayload} />;
  }

  return <ResultView dict={dict} payload={payload} onAnother={onFinished} />;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="panel border-signal-300 text-sm text-signal-700" role="alert" data-retention-error>
      {message}
    </p>
  );
}

function ReadingPhase({
  dict,
  payload,
  skewMs,
  onPhaseOver,
  onFinished,
}: {
  dict: Dictionary;
  payload: Extract<RetentionAttemptPayload, { phase: "reading" }>;
  skewMs: number;
  onPhaseOver: () => void;
  onFinished: () => void;
}) {
  const seconds = useCountdown(payload.readEndsAt, skewMs);

  useEffect(() => {
    // When the reading window closes the component asks the SERVER for the next
    // phase instead of assuming it locally.
    if (seconds > 0) return;
    onPhaseOver();
    const timer = window.setInterval(onPhaseOver, 2_000);
    return () => window.clearInterval(timer);
  }, [seconds, onPhaseOver]);

  return (
    <div className="flex flex-col gap-4" data-retention-phase="reading" data-retention-attempt={payload.attemptId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{dict.retentionMemory.readingTitle}</h2>
        <span className="tab" role="timer" aria-live="off" data-retention-reading-timer={seconds}>
          {dict.retentionMemory.readingTimeLeft} {formatClock(seconds)}
        </span>
      </div>
      <p className="body-text">{dict.retentionMemory.readingHint}</p>
      {seconds > 0 ? (
        <article className="panel whitespace-pre-line text-[1.05rem] leading-8 text-ink-800" data-retention-source>{payload.bodyText}</article>
      ) : (
        <p className="panel" role="status" data-retention-phase-pending>{dict.common.loading}</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="meta-text">{dict.retentionMemory.readingWords.replace("{n}", String(payload.wordCount))}</span>
        <button type="button" className="btn-secondary" onClick={onFinished} data-retention-leave>
          {dict.retentionMemory.resultBack}
        </button>
      </div>
    </div>
  );
}

function RecallPhase({
  dict,
  payload,
  skewMs,
  onResult,
}: {
  dict: Dictionary;
  payload: Extract<RetentionAttemptPayload, { phase: "recall" }>;
  skewMs: number;
  onResult: (payload: RetentionAttemptPayload) => void;
}) {
  const [text, setText] = useState(payload.recallDraft);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const seconds = useCountdown(payload.writeEndsAt, skewMs);
  const expired = seconds <= 0;
  const lastSaved = useRef(payload.recallDraft);
  const submitRef = useRef<() => void>(() => {});

  const save = useCallback(
    async (value: string) => {
      setSaveState("saving");
      try {
        const response = await fetch(`/api/retention/attempts/${payload.attemptId}/draft`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recallText: value }),
        });
        if (!response.ok) {
          setSaveState("failed");
          return;
        }
        lastSaved.current = value;
        setSaveState("saved");
      } catch {
        setSaveState("failed");
      }
    },
    [payload.attemptId]
  );

  useEffect(() => {
    if (submitting || expired || text === lastSaved.current) return;
    const timer = window.setTimeout(() => void save(text), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, save, submitting, expired]);

  const submittingRef = useRef(false);
  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/retention/attempts/${payload.attemptId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recallText: text }),
      });
      if (!response.ok) {
        setSaveState("failed");
        setSubmitting(false);
        return;
      }
      const result = await response.json() as RetentionAttemptPayload;
      if (result.phase !== "completed" && result.phase !== "timed_out") {
        setSaveState("failed"); setSubmitting(false); return;
      }
      onResult(result);
    } catch {
      setSaveState("failed");
      setSubmitting(false);
    } finally {
      submittingRef.current = false;
    }
  }, [onResult, payload.attemptId, text]);

  submitRef.current = () => void submit();

  // The write deadline is enforced by the server; when the clock reaches zero the
  // component submits so the learner sees the result of the draft they wrote.
  const fired = useRef(false);
  useEffect(() => {
    if (seconds <= 0 && !fired.current) {
      fired.current = true;
      submitRef.current();
    }
  }, [seconds]);

  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;

  return (
    <div className="flex flex-col gap-4" data-retention-phase="recall" data-retention-attempt={payload.attemptId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{dict.retentionMemory.recallTitle}</h2>
        <span className="tab" role="timer" data-retention-write-timer={seconds}>
          {dict.retentionMemory.recallTimeLeft} {formatClock(seconds)}
        </span>
      </div>
      <p className="body-text">{dict.retentionMemory.recallHint}</p>
      <textarea
        className="input min-h-[14rem] w-full"
        value={text}
        readOnly={submitting || seconds <= 0}
        onChange={(event) => setText(event.target.value)}
        placeholder={dict.retentionMemory.recallPlaceholder}
        aria-label={dict.retentionMemory.recallTitle}
        data-retention-answer
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="meta-text"
          aria-live="polite"
          data-retention-save-state={saveState}
        >
          {saveState === "saving" && dict.retentionMemory.recallSaving}
          {saveState === "saved" && dict.retentionMemory.recallSaved}
          {saveState === "failed" && dict.retentionMemory.recallSaveFailed}
          {saveState === "idle" && dict.retentionMemory.recallWordCount.replace("{n}", String(wordCount))}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void submit()}
          disabled={submitting || text.trim().length === 0}
          data-retention-submit
        >
          {submitting ? dict.retentionMemory.recallSubmitting : dict.retentionMemory.recallSubmit}
        </button>
      </div>
    </div>
  );
}

const STATUS_LABEL = {
  captured: "resultClaimCaptured",
  partial: "resultClaimPartial",
  missed: "resultClaimMissed",
  contradicted: "resultClaimContradicted",
} as const;

function ResultView({
  dict,
  payload,
  onAnother,
}: {
  dict: Dictionary;
  payload: Extract<RetentionAttemptPayload, { phase: "completed" | "timed_out" }>;
  onAnother: () => void;
}) {
  const t = dict.retentionMemory;
  const totals = payload.breakdown.totals;
  return (
    <div className="flex flex-col gap-5" data-retention-phase={payload.phase} data-retention-result>
      <div className="panel flex flex-col gap-2">
        <h2 className="section-title">
          {payload.phase === "completed" ? t.resultCompleted : t.resultTimedOut}
        </h2>
        {payload.phase === "timed_out" && <p className="body-text">{t.resultTimedOutBody}</p>}
        <p className="font-display text-4xl text-ink-900" data-retention-score={payload.score}>
          {t.resultScore.replace("{score}", String(payload.score))}
        </p>
        <p className="meta-text">{t.resultHint}</p>
      </div>

      <ul className="panel flex flex-col gap-2" data-retention-totals>
        <li className="body-text">
          {t.resultMainIdeas
            .replace("{kept}", String(totals.mainIdeasRemembered))
            .replace("{total}", String(totals.mainIdeasPossible))}
        </li>
        <li className="body-text">
          {t.resultDetails
            .replace("{kept}", String(totals.matchedGroups))
            .replace("{total}", String(totals.totalGroups))}
        </li>
        <li className="body-text">{t.resultContradictions.replace("{n}", String(totals.contradicted))}</li>
      </ul>

      <ul className="flex flex-col gap-2" data-retention-claims>
        {payload.breakdown.claims.map((claim: RetentionClaimResult) => (
          <li key={claim.claimId} className="panel flex items-center justify-between gap-3" data-retention-claim={claim.claimId}>
            <span className="body-text">{claim.claimLabel}</span>
            <span className="meta-text text-right">
              {t[STATUS_LABEL[claim.status]]}
              <br />
              {t.resultClaimPoints
                .replace("{awarded}", String(claim.awardedPoints))
                .replace("{possible}", String(claim.possiblePoints))}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary w-fit" onClick={onAnother} data-retention-another>
          {t.resultAnother}
        </button>
        <button type="button" className="btn-secondary w-fit" onClick={onAnother} data-retention-levels-back>
          {t.resultBack}
        </button>
      </div>
    </div>
  );
}
