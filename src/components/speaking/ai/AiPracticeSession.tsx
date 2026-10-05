"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";
import type { Dictionary } from "@/lib/i18n/en";
import type { AiSessionView } from "@/lib/data/speaking-ai-sessions";
import type { SessionPlanMode } from "@/lib/speaking/ai-session-plan";
import type { SessionSummary } from "@/lib/speaking/ai-session-summary";
import type { LearnerEvaluation } from "@/lib/services/coach/public-evaluation";
import { SESSION_PLAN_MODES } from "@/lib/speaking/ai-session-plan";
import { MicrophoneCheckPanel } from "./MicrophoneCheckPanel";
import { AiAnswerComposer } from "./AiAnswerComposer";
import { AiAnswerFeedback } from "./AiAnswerFeedback";
import { AiSessionSummaryCard } from "./AiSessionSummaryCard";

type Stage = "mic" | "modes" | "session" | "summary";

type ItemResult = {
  attemptId: string;
  evaluation: LearnerEvaluation | null;
  transcriptEdited: boolean;
  transcriptSent: boolean;
};

/**
 * Practice with AI — the whole learner journey (spec §87).
 *
 *   microphone check → choose mode → server-built plan → answer each question
 *   (record + live browser transcript → STOP → review → Send to RIWI) →
 *   feedback → Try again / Next question → topic transition → session summary
 *
 * Two decisions worth stating plainly:
 *
 *  - THE SERVER OWNS THE PLAN. Modes request a session; they never build one. The
 *    questions, their order, the topic clusters and their sizes are written to the
 *    database at creation and read back on every render, so refreshing the page
 *    mid-interview cannot reshuffle the examiner (§11).
 *
 *  - NAVIGATION IS VIEW STATE, NOT SESSION STATE. `activeOrdinal` only decides
 *    which question is on screen; the persisted cursor is advanced by the server
 *    when an answer is bound or a question is skipped. A learner who walks away
 *    and comes back resumes exactly where the server says they are.
 */
export function AiPracticeSession({
  dict,
  historyHref,
  initialSession,
  initialSummary,
}: {
  dict: Dictionary;
  historyHref: string;
  /** A session to resume (so a refresh continues the same interview). */
  initialSession?: AiSessionView | null;
  initialSummary?: SessionSummary | null;
}) {
  const t = dict.speakingAi;
  const request = useScopedRequest();

  const [stage, setStage] = useState<Stage>(
    initialSummary ? "summary" : initialSession ? (initialSession.status === "active" ? "session" : "summary") : "mic",
  );
  const [session, setSession] = useState<AiSessionView | null>(initialSession ?? null);
  const [summary, setSummary] = useState<SessionSummary | null>(initialSummary ?? null);
  const [activeOrdinal, setActiveOrdinal] = useState<number>(initialSession?.currentItemIndex ?? 0);
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [retryMode, setRetryMode] = useState<Record<string, boolean>>({});
  const [micBusy, setMicBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [topicNotice, setTopicNotice] = useState<string | null>(null);

  // Memoised so the identity is stable: an `?? []` here would allocate a new
  // array on every render and invalidate every memo and callback below it.
  const items = useMemo(() => session?.items ?? [], [session]);
  const current = useMemo(
    () => items.find((item) => item.ordinal === activeOrdinal) ?? null,
    [items, activeOrdinal],
  );
  const answeredCount = items.filter((item) => item.status === "answered").length;
  const progress = items.length === 0 ? 0 : Math.round((answeredCount / items.length) * 100);

  // ---- stage: create a session ------------------------------------------

  const startSession = useCallback(async (mode: SessionPlanMode) => {
    if (creating) return;
    setCreating(true);
    setError("");
    const result = await request<{ session: AiSessionView }>("/api/speaking/ai/sessions", { body: { mode } });
    setCreating(false);
    if (!result) return;
    if (!result.ok) {
      setError(result.error === "no_questions_available" ? t.noQuestions : apiErrorMessage(result.error, result.status, dict));
      return;
    }
    setSession(result.data.session);
    setActiveOrdinal(result.data.session.currentItemIndex);
    setResults({});
    setRetryMode({});
    setSummary(null);
    setStage("session");
  }, [creating, dict, request, t.noQuestions]);

  // ---- stage: finish the session ----------------------------------------

  const finishSession = useCallback(async () => {
    if (!session || finishing) return;
    setFinishing(true);
    setError("");
    const result = await request<{ session: AiSessionView; summary: SessionSummary }>(
      `/api/speaking/ai/sessions/${session.id}/complete`,
      { body: {} },
    );
    setFinishing(false);
    if (!result) return;
    if (!result.ok) { setError(apiErrorMessage(result.error, result.status, dict)); return; }
    setSession(result.data.session);
    setSummary(result.data.summary);
    setStage("summary");
  }, [dict, finishing, request, session]);

  // ---- per-question navigation ------------------------------------------

  const goToNext = useCallback(() => {
    if (!current) return;
    const next = items.find((item) => item.ordinal > current.ordinal);
    setTopicNotice(
      next && next.topicPosition !== current.topicPosition && next.topicTitle
        ? t.topicTransition.replace("{topic}", next.topicTitle)
        : null,
    );
    if (next) { setActiveOrdinal(next.ordinal); return; }
    void finishSession();
  }, [current, finishSession, items, t.topicTransition]);

  const skipCurrent = useCallback(async () => {
    if (!session || !current) return;
    setError("");
    const result = await request<{ session: AiSessionView }>(
      `/api/speaking/ai/sessions/${session.id}/items/${current.id}/skip`,
      { body: {} },
    );
    if (!result) return;
    if (!result.ok) { setError(apiErrorMessage(result.error, result.status, dict)); return; }
    setSession(result.data.session);
    const next = result.data.session.items.find((item) => item.ordinal > current.ordinal);
    setTopicNotice(
      next && next.topicPosition !== current.topicPosition && next.topicTitle
        ? t.topicTransition.replace("{topic}", next.topicTitle)
        : null,
    );
    if (next) setActiveOrdinal(next.ordinal);
    else await finishSession();
  }, [current, dict, finishSession, request, session, t.topicTransition]);

  const onSent = useCallback((
    itemId: string,
    attemptId: string,
    evaluation: LearnerEvaluation | null,
    meta: { transcriptEdited: boolean; transcriptSent: boolean },
  ) => {
    setResults((current) => ({ ...current, [itemId]: { attemptId, evaluation, ...meta } }));
    setRetryMode((current) => ({ ...current, [itemId]: false }));
    // The server advanced the persisted cursor when the answer was bound; mirror
    // it so a refresh lands on the same question the learner is looking at.
    setSession((current) =>
      current ? { ...current, items: current.items.map((item) => (item.id === itemId ? { ...item, status: "answered", attemptId } : item)) } : current,
    );
  }, []);

  // ---- render ------------------------------------------------------------

  if (stage === "mic") {
    return (
      <div className="flex flex-col gap-4" data-ai-stage="mic">
        <MicrophoneCheckPanel dict={dict} onPassed={() => setStage("modes")} onSkip={() => setStage("modes")} />
      </div>
    );
  }

  if (stage === "modes") {
    return (
      <div className="flex flex-col gap-4" data-ai-stage="modes">
        <p className="text-sm text-ink-500">{t.chooseMode}</p>
        <div className="grid gap-3 sm:grid-cols-2" data-ai-modes>
          {SESSION_PLAN_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void startSession(mode)}
              disabled={creating}
              data-ai-mode={mode}
              className="card flex min-h-24 flex-col items-start gap-1 p-5 text-left hover:bg-paper-sunken disabled:opacity-60"
            >
              <span className="font-display text-lg text-ink-900">{t.mode[mode]}</span>
              <span className="text-sm text-ink-500">{t.modeBody[mode]}</span>
            </button>
          ))}
        </div>
        {creating && <p className="text-sm text-ink-500" role="status">{t.buildingPlan}</p>}
        {error && <p className="text-sm text-band-warn" role="alert" data-ai-error>{error}</p>}
      </div>
    );
  }

  if (stage === "summary" && summary) {
    return (
      <div className="flex flex-col gap-4" data-ai-stage="summary">
        <AiSessionSummaryCard
          dict={dict}
          summary={summary}
          historyHref={historyHref}
          onRestart={() => {
            setSession(null); setSummary(null); setResults({}); setRetryMode({});
            setActiveOrdinal(0); setTopicNotice(null); setError(""); setStage("modes");
          }}
        />
      </div>
    );
  }

  if (!session || !current) {
    return <p className="text-sm text-ink-500">{t.noQuestions}</p>;
  }

  const result = results[current.id];
  const isRetry = retryMode[current.id] === true;
  const isLast = !items.some((item) => item.ordinal > current.ordinal);

  return (
    <div className="flex flex-col gap-4" data-ai-stage="session" data-ai-session-id={session.id}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span data-ai-progress>
            {t.progress.replace("{n}", String(current.ordinal + 1)).replace("{total}", String(items.length))}
          </span>
          <span>{dict.speakingPractice.part[current.part]}</span>
        </div>
        <ProgressBar value={progress} />
        {current.topicTitle && (
          <p className="text-xs text-ink-300" data-ai-topic={current.topicKey}>
            {t.topicLabel.replace("{topic}", current.topicTitle)}
          </p>
        )}
      </div>

      {topicNotice && (
        <p className="rounded-md border border-signal-200 bg-signal-50 p-3 text-sm text-ink-700" data-ai-topic-transition role="status">
          {topicNotice}
        </p>
      )}

      {result && !isRetry ? (
        <Card className="flex flex-col gap-4" data-ai-item={current.id} data-ai-answered>
          <AiAnswerFeedback
            dict={dict}
            evaluation={result.evaluation}
            transcriptEdited={result.transcriptEdited}
            transcriptSent={result.transcriptSent}
            isLast={isLast}
            onTryAgain={() => setRetryMode((state) => ({ ...state, [current.id]: true }))}
            onNext={goToNext}
          />
        </Card>
      ) : (
        // Keyed by item id: a new question gets a fresh recorder, and nothing
        // (recording, transcript, timer) can leak between questions.
        <AiAnswerComposer
          key={`${current.id}-${isRetry ? "retry" : "first"}`}
          dict={dict}
          sessionId={session.id}
          item={current}
          busy={micBusy}
          retryOfAttemptId={isRetry ? result?.attemptId ?? null : null}
          onBusyChange={setMicBusy}
          onSent={(attemptId, evaluation, meta) => onSent(current.id, attemptId, evaluation, meta)}
        />
      )}

      {error && <p className="text-sm text-band-warn" role="alert" data-ai-error>{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!result && (
          <Button variant="secondary" onClick={() => void skipCurrent()} disabled={micBusy} data-ai-skip>
            {t.skipQuestion}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void finishSession()} disabled={micBusy || finishing} data-ai-end>
          {finishing ? t.summarising : t.endSession}
        </Button>
        <Link href={historyHref} className="btn-ghost">{dict.speakingPractice.viewHistory}</Link>
      </div>
    </div>
  );
}
