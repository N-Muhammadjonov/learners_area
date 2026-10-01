"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { RETENTION_LEVELS, RETENTION_LEVEL_CONFIG, RETENTION_READ_SECONDS, type RetentionLevel } from "@/lib/retention/levels";
import type { RetentionAttemptMeta, RetentionAttemptPayload, RetentionClaimResult } from "@/lib/retention/types";
import { countWords } from "@/lib/retention/word-count";
import { formatDateTime } from "@/lib/time";
import type { Locale } from "@/lib/i18n";

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

/**
 * Source-free transition state (W10). When the reading deadline passes, the
 * app-managed state drops `bodyText` immediately — before the server has
 * confirmed the recall phase — so a failed or stalled phase refresh cannot keep
 * the source alive in React state. Only the attempt id and the persisted
 * deadlines survive; the phase itself still comes from the server.
 */
type AwaitingRecallState = RetentionAttemptMeta & { phase: "awaiting_recall" };
type SessionState = RetentionAttemptPayload | AwaitingRecallState;

export function toSourceFree(payload: RetentionAttemptPayload | AwaitingRecallState): AwaitingRecallState {
  return {
    attemptId: payload.attemptId,
    level: payload.level,
    label: payload.label,
    readStartedAt: payload.readStartedAt,
    readEndsAt: payload.readEndsAt,
    writeStartedAt: payload.writeStartedAt,
    writeEndsAt: payload.writeEndsAt,
    serverNow: payload.serverNow,
    phase: "awaiting_recall",
  };
}

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
  const [payload, setPayload] = useState<SessionState | null>(initial);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<RetentionLevel>("A2");
  const [error, setError] = useState<string | null>(null);

  const sessionMounted = useRef(false);
  const startController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const recheckController = useRef<AbortController | null>(null);
  const recheckTimer = useRef<number | null>(null);
  const [startOutcomeUnknown, setStartOutcomeUnknown] = useState(false);
  useEffect(() => {
    sessionMounted.current = true;
    return () => {
      sessionMounted.current = false;
      startController.current?.abort();
      refreshController.current?.abort();
      recheckController.current?.abort();
      if (recheckTimer.current !== null) window.clearTimeout(recheckTimer.current);
    };
  }, []);

  const skewMs = useMemo(
    () => (payload ? Date.parse(payload.serverNow) - Date.now() : 0),
    [payload]
  );

  const start = useCallback(async (level: string) => {
    if (startController.current || startOutcomeUnknown) return;
    const controller = new AbortController();
    startController.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/retention/attempts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ level }), signal: controller.signal,
      });
      const body = (await response.json()) as RetentionAttemptPayload & { error?: string };
      if (!sessionMounted.current) return;
      if (controller.signal.aborted) throw new Error("start deadline exceeded");
      if (!response.ok) { setError(errorText(dict, body.error)); return; }
      setPayload(body);
    } catch {
      if (sessionMounted.current) {
        // The server may have created an attempt. Do a fresh authoritative GET
        // via page navigation before allowing another POST; no fake success.
        setStartOutcomeUnknown(true);
        setError(dict.retentionMemory.startUnknownOutcome);
        // One automatic authoritative GET (never a POST retry).
        window.setTimeout(() => void recheckRef.current?.(), 0);
      }
    } finally {
      window.clearTimeout(timer);
      if (startController.current === controller) startController.current = null;
      if (sessionMounted.current) setBusy(false);
    }
  }, [dict, startOutcomeUnknown]);
  const recheckRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Authoritative recheck after an unknown start outcome (and on back/forward
   * restore): a single GET, never a POST. An active attempt is resumed; none
   * means the POST did not land, so starting is allowed again.
   */
  const [rechecking, setRechecking] = useState(false);
  const recheckActive = useCallback(async () => {
    if (!sessionMounted.current || recheckController.current) return;
    const controller = new AbortController();
    recheckController.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    recheckTimer.current = timer;
    setRechecking(true);
    try {
      const response = await fetch("/api/retention/attempts", { cache: "no-store", signal: controller.signal });
      const body = (await response.json()) as { active?: RetentionAttemptPayload | null; error?: string };
      if (!sessionMounted.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error("recheck failed");
      setStartOutcomeUnknown(false);
      setError(null);
      if (body.active) setPayload(body.active);
    } catch {
      if (sessionMounted.current) setError(dict.retentionMemory.startUnknownOutcome);
    } finally {
      window.clearTimeout(timer);
      if (recheckTimer.current === timer) recheckTimer.current = null;
      if (recheckController.current === controller) recheckController.current = null;
      if (sessionMounted.current) setRechecking(false);
    }
  }, [dict]);

  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (!payload || refreshing.current) return;
    refreshing.current = true;
    const attemptId = payload.attemptId;
    const controller = new AbortController();
    refreshController.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`/api/retention/attempts/${attemptId}`, { cache: "no-store", signal: controller.signal });
      const body = (await response.json()) as RetentionAttemptPayload & { error?: string };
      if (!sessionMounted.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error("phase refresh failed");
      // A reading payload that arrives after the deadline (clock skew) is never
      // re-admitted: only the server's recall/terminal state replaces the gate.
      setPayload((current) => {
        if (!current || current.attemptId !== attemptId) return current;
        if (body.phase === "reading" && current.phase === "awaiting_recall") return current;
        return body;
      });
      setRefreshFailed(false);
      if (body.phase === "completed" || body.phase === "timed_out") router.refresh();
    } catch {
      if (sessionMounted.current) setRefreshFailed(true);
    } finally {
      window.clearTimeout(timer);
      if (refreshController.current === controller) refreshController.current = null;
      refreshing.current = false;
    }
  }, [payload, router]);

  /**
   * "I've finished": the source leaves app state immediately and for good, then
   * the SERVER moves the attempt to recall and returns its persisted deadlines.
   * The POST is never retried automatically; if its outcome is unknown the
   * awaiting screen asks the server (GET) which phase the attempt is in.
   */
  const finishing = useRef(false);
  const finishReading = useCallback(async () => {
    if (!payload || payload.phase !== "reading" || finishing.current) return;
    if (!window.confirm(dict.retentionMemory.finishReadingConfirm)) return;
    finishing.current = true;
    const attemptId = payload.attemptId;
    setPayload((current) => (current && current.phase === "reading" ? toSourceFree(current) : current));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/retention/attempts/${attemptId}/finish-reading`, { method: "POST", cache: "no-store", signal: controller.signal });
      const body = (await response.json()) as RetentionAttemptPayload & { error?: string };
      if (!sessionMounted.current) return;
      if (!response.ok) throw new Error("finish failed");
      setPayload((current) => {
        if (!current || current.attemptId !== attemptId || body.phase === "reading") return current;
        return body;
      });
      setRefreshFailed(false);
      if (body.phase === "completed" || body.phase === "timed_out") router.refresh();
    } catch {
      if (sessionMounted.current) setRefreshFailed(true);
    } finally {
      window.clearTimeout(timer);
      finishing.current = false;
    }
  }, [payload, dict, router]);

  /** Reading deadline reached: drop the source from app state, then ask the server. */
  const onReadingExpired = useCallback(() => {
    setPayload((current) => (current && current.phase === "reading" ? toSourceFree(current) : current));
  }, []);

  /** Terminal success: keep the detailed result, refresh summary/history from the server. */
  const onResult = useCallback((result: RetentionAttemptPayload) => {
    setPayload(result);
    router.refresh();
  }, [router]);

  const onFinished = useCallback(() => {
    setPayload(null);
    router.refresh();
  }, [router]);

  useEffect(() => { recheckRef.current = recheckActive; }, [recheckActive]);

  // Back/forward cache restore shows a frozen snapshot: re-read the server state.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (payload && payload.phase !== "completed" && payload.phase !== "timed_out") void refresh();
      else if (!payload) void recheckActive();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [payload, refresh, recheckActive]);

  if (!payload) {
    return (
      <div className="flex flex-col gap-4" data-retention-levels>
        <div className="flex flex-col gap-1">
          <h2 className="section-title">{dict.retentionMemory.levelsTitle}</h2>
          <p className="body-text">{dict.retentionMemory.levelHint}</p>
        </div>
        {error && <ErrorBanner message={error} />}
        {startOutcomeUnknown && <button type="button" onClick={() => void recheckActive()} disabled={rechecking} className="btn-secondary" data-retention-recover-start>{dict.retentionMemory.checkActiveAttempt}</button>}
        <div className="retention-level-options" role="group" aria-label={dict.retentionMemory.levelsTitle} data-retention-level-list>
          {RETENTION_LEVELS.map((level) => (
            <button key={level} type="button" className="retention-level-option" aria-pressed={selectedLevel === level} disabled={busy} onClick={() => setSelectedLevel(level)} data-retention-level={level}>
              <strong>{level}</strong>
              <span className="meta-text">{dict.retentionMemory.words.replace("{n}", String(RETENTION_LEVEL_CONFIG[level].targetWords))}</span>
              <span className="meta-text">{formatClock(RETENTION_READ_SECONDS)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary w-fit" onClick={() => void start(selectedLevel)} disabled={busy || startOutcomeUnknown} data-retention-start={selectedLevel}>
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
        onExpired={onReadingExpired}
        onFinished={onFinished}
        onFinishReading={() => void finishReading()}
      />
    );
  }

  if (payload.phase === "awaiting_recall") {
    return <AwaitingRecall dict={dict} state={payload} failed={refreshFailed} onRefresh={refresh} onFinished={onFinished} />;
  }

  if (payload.phase === "recall") {
    return <RecallPhase key={payload.attemptId} dict={dict} payload={payload} skewMs={skewMs} onResult={onResult} />;
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
  onExpired,
  onFinished,
  onFinishReading,
}: {
  dict: Dictionary;
  payload: Extract<RetentionAttemptPayload, { phase: "reading" }>;
  skewMs: number;
  onExpired: () => void;
  onFinished: () => void;
  onFinishReading: () => void;
}) {
  const seconds = useCountdown(payload.readEndsAt, skewMs);

  useEffect(() => {
    // When the reading window closes the source leaves app state at once; the
    // parent then asks the SERVER for the next phase instead of assuming it.
    if (seconds <= 0) onExpired();
  }, [seconds, onExpired]);

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
        <article className="academic-text panel whitespace-pre-line text-[1.05rem] leading-8 text-ink-800" data-retention-source>{payload.bodyText}</article>
      ) : (
        <p className="panel" role="status" data-retention-phase-pending>{dict.common.loading}</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="meta-text">{dict.retentionMemory.readingWords.replace("{n}", String(payload.wordCount))}</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onFinished} data-retention-leave>
            {dict.retentionMemory.resultBack}
          </button>
          <button type="button" className="btn-primary" onClick={onFinishReading} disabled={seconds <= 0} data-retention-finish-reading>
            {dict.retentionMemory.finishReading}
          </button>
        </div>
      </div>
    </div>
  );
}

function AwaitingRecall({
  dict,
  state,
  failed,
  onRefresh,
  onFinished,
}: {
  dict: Dictionary;
  state: AwaitingRecallState;
  failed: boolean;
  onRefresh: () => void;
  onFinished: () => void;
}) {
  useEffect(() => {
    onRefresh();
    const timer = window.setInterval(onRefresh, 2_000);
    return () => window.clearInterval(timer);
  }, [onRefresh]);
  return (
    <div className="flex flex-col gap-4" data-retention-phase="awaiting_recall" data-retention-attempt={state.attemptId}>
      <h2 className="section-title">{dict.retentionMemory.readingTitle}</h2>
      <p className="panel" role="status" data-retention-phase-pending>{dict.common.loading}</p>
      {failed && (
        <div className="flex flex-wrap items-center gap-3" role="alert" data-retention-phase-refresh-failed>
          <p className="body-text">{dict.retentionMemory.errors.retention_unavailable}</p>
          <button type="button" className="btn-secondary" onClick={onRefresh} data-retention-phase-retry>
            {dict.errorPage.retry}
          </button>
        </div>
      )}
      <button type="button" className="btn-secondary w-fit" onClick={onFinished} data-retention-leave>
        {dict.retentionMemory.resultBack}
      </button>
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

  const wordCount = countWords(text);

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

function formatDuration(ms: number): string {
  return formatClock(Math.round(ms / 1000));
}

export function ResultView({
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
  const readAllocatedMs = Date.parse(payload.readEndsAt) - Date.parse(payload.readStartedAt);
  const writeStart = Date.parse(payload.writeStartedAt);
  const writeEnd = Date.parse(payload.writeEndsAt);
  // Writing time used is measured from persisted timestamps only: the submit
  // time, bounded by the write window. A timeout used the whole window.
  const writeUsedMs =
    payload.phase === "timed_out"
      ? writeEnd - writeStart
      : payload.submittedAt
        ? Math.min(Math.max(0, Date.parse(payload.submittedAt) - writeStart), writeEnd - writeStart)
        : null;
  const finished = payload.completedAt ?? payload.submittedAt;
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

      <dl className="panel grid grid-cols-1 gap-2 sm:grid-cols-2" data-retention-result-meta>
        <div><dt className="meta-text">{t.resultMetaLevel}</dt><dd className="body-text" data-retention-result-level>{payload.level}</dd></div>
        {payload.label && <div><dt className="meta-text">{t.resultMetaText}</dt><dd className="body-text" data-retention-result-label>{payload.label}</dd></div>}
        {finished && (
          <div>
            <dt className="meta-text">{t.resultMetaFinished}</dt>
            <dd className="body-text" data-retention-result-finished={finished}>
              <time dateTime={finished}>{formatDateTime(finished, t.dateLocale as Locale)}</time>
            </dd>
          </div>
        )}
        <div><dt className="meta-text">{t.resultMetaReadAllocated}</dt><dd className="body-text">{formatDuration(readAllocatedMs)}</dd></div>
        <div>
          <dt className="meta-text">{writeUsedMs === null ? t.resultMetaWriteUnknown : t.resultMetaWriteUsed}</dt>
          {writeUsedMs !== null && <dd className="body-text" data-retention-result-write-used={Math.round(writeUsedMs / 1000)}>{formatDuration(writeUsedMs)}</dd>}
        </div>
        <div><dt className="meta-text">{t.resultMetaRecallWords}</dt><dd className="body-text" data-retention-result-words={payload.recallWordCount}>{t.resultMetaWords.replace("{n}", String(payload.recallWordCount))}</dd></div>
      </dl>

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
        <Link href="/reading/retention#retention-history" prefetch={false} className="btn-secondary w-fit" data-retention-result-history>
          {t.resultHistory}
        </Link>
        <Link href="/reading" className="btn-secondary w-fit" data-retention-result-reading>
          {t.resultBackToReading}
        </Link>
        <Link href={`/reading/retention/results/${payload.attemptId}`} prefetch={false} className="link-inline self-center" data-retention-result-permalink>
          {t.resultPermalink}
        </Link>
      </div>
    </div>
  );
}
