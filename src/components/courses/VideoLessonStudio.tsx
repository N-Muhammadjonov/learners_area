"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { Button } from "@/components/ui/Button";
import { embedUrlFor, type VideoProvider } from "@/lib/services/video/provider";
import { DirectMediaPlayer, type DirectMediaControls } from "@/components/courses/DirectMediaPlayer";

/** Validated provider embeds with native captions and server-authoritative progress.
 * Legacy transcript data stays compatible; it is not rendered as a lesson tab.
 */
type Tab = "before" | "notes" | "comprehension" | "gap" | "opinion" | "summary";

type Question = {
  id: string;
  stage: "comprehension" | "gap_fill";
  prompt: string;
  atSeconds: number | null;
};

export function VideoLessonStudio({
  dict,
  lessonId,
  videoLesson,
  questions,
  initialProgress,
  directMedia,
  embedOrigin,
}: {
  /** Configured public origin of this site for the YouTube JS API; omitted (never "*") when not configured. */
  embedOrigin?: string | null;
  /** Server-resolved URLs for an owner-authorised direct media item (provider "direct"). */
  directMedia?: { src: string; captions: string | null } | null;
  dict: Dictionary;
  lessonId: string;
  videoLesson: {
    id: string;
    provider: string;
    videoId: string;
    title: string;
    beforeYouWatch: string | null;
    durationSeconds: number | null;
    transcript: { startSeconds: number; text: string }[] | null;
    transcriptSource: string | null;
    transcriptAttribution: string | null;
    /** Optional owner-authored plain transcript (used when no timed lines exist). */
    transcriptText?: string | null;
    /** Optional centre-authored study notes; null means no notes control. */
    notes: string | null;
  };
  questions: Question[];
  initialProgress: {
    state: string;
    watchedSeconds: number;
    answers: Record<string, { answer: string; correct: boolean }>;
    responseText: string | null;
    summaryText: string | null;
  } | null;
}) {
  const t = dict.videoLesson;
  const provider = videoLesson.provider as VideoProvider;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const reportedRef = useRef(initialProgress?.watchedSeconds ?? 0);
  const progressRequest = useRef<AbortController | null>(null);

  const [state, setState] = useState(initialProgress?.state ?? "not_started");
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [playbackEnded, setPlaybackEnded] = useState(false);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const [restartAt, setRestartAt] = useState(0);
  const [graded, setGraded] = useState<Record<string, { answer: string; correct: boolean }>>(
    initialProgress?.answers ?? {}
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [opinion, setOpinion] = useState(initialProgress?.responseText ?? "");
  const [summary, setSummary] = useState(initialProgress?.summaryText ?? "");
  const [saving, setSaving] = useState(false);
  const mutationRef = useRef<AbortController | null>(null);
  const [requestError, setRequestError] = useState(false);
  const [savedResponse, setSavedResponse] = useState<boolean | null>(null);

  const notes = useMemo(() => (videoLesson.notes ?? "").trim(), [videoLesson.notes]);
  const comprehension = useMemo(() => questions.filter((q) => q.stage === "comprehension"), [questions]);
  const gapFill = useMemo(() => questions.filter((q) => q.stage === "gap_fill"), [questions]);

  const tabs = useMemo(() => {
    const list: Tab[] = [];
    if (videoLesson.beforeYouWatch) list.push("before");
    if (notes.length > 0) list.push("notes");
    if (comprehension.length > 0) list.push("comprehension");
    if (gapFill.length > 0) list.push("gap");
    list.push("opinion");
    // Written recall does not depend on a transcript: the student writes what they
    // remember from the video itself.
    list.push("summary");
    return list;
  }, [videoLesson.beforeYouWatch, notes.length, comprehension.length, gapFill.length]);

  const [tab, setTab] = useState<Tab>(tabs[0] ?? "opinion");
  // Study notes are revealed only when requested.
  const [notesShown, setNotesShown] = useState(false);

  // Built without the browser origin so the player is part of the server-rendered
  // page: the video starts loading with the lesson instead of after hydration.
  const src = useMemo(() => (provider === "youtube" ? embedUrlFor(provider, videoLesson.videoId, embedOrigin ? { origin: embedOrigin } : {}) + (restartAt > 0 ? `&start=${Math.floor(restartAt)}` : "") : "about:blank"), [provider, videoLesson.videoId, restartAt, embedOrigin]);
  const direct = provider === "direct" ? directMedia ?? null : null;
  const directControls = useRef<DirectMediaControls | null>(null);

  const send = useCallback(
    (payload: Record<string, unknown>) => {
      // The player only accepts messages from the frame it owns.
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), new URL(src).origin);
    },
    [src]
  );

  const seekTo = useCallback(
    (seconds: number) => {
      if (directControls.current) { directControls.current.seekTo(seconds); return; }
      if (playbackEnded) { setRestartAt(seconds); setPlaybackGeneration(n => n + 1); setPlaybackEnded(false); return; }
      send({ event: "command", func: "seekTo", args: [seconds, true] });
      send({ event: "command", func: "playVideo", args: [] });
    },
    [send, playbackEnded]
  );

  // Report position only when the validated player actually supplies it.
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    const ask = () => {
      send({ event: "listening", id: 1, channel: "widget" });
      send({ event: "command", func: "addEventListener", args: ["onStateChange"] });
    };
    let loadTimer: number | undefined;
    const onLoad = () => {
      ask();
      window.clearTimeout(loadTimer);
      loadTimer = window.setTimeout(ask, 600);
    };
    el.addEventListener("load", onLoad);
    const interval = window.setInterval(ask, 5000);

    function onMessage(event: MessageEvent) {
      if (event.source !== el?.contentWindow || event.origin !== new URL(src).origin) return;
      let data: unknown;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      const message = data as { event?: string; info?: unknown };
      // Replace the completed frame, rather than covering provider controls.
      // Ignore untrusted windows/origins above and all non-state messages.
      if (message.event === "onStateChange" && message.info === 0) setPlaybackEnded(true);
      const info = message.info as { currentTime?: number; playerState?: number } | undefined;
      if (message.event === "infoDelivery" && info?.playerState === 0) setPlaybackEnded(true);
      if (typeof info?.currentTime === "number" && Number.isFinite(info.currentTime) && info.currentTime >= 0) setLiveTime(info.currentTime);
    }
    window.addEventListener("message", onMessage);
    return () => {
      el.removeEventListener("load", onLoad);
      window.clearInterval(interval);
      window.clearTimeout(loadTimer);
      window.removeEventListener("message", onMessage);
    };
  }, [send, src, playbackEnded, playbackGeneration]);

  // Keep a slow progress write alive across player ticks. Never overlap writes,
  // and advance the acknowledged position only after the server accepts it.
  useEffect(() => {
    if (liveTime === null || liveTime - reportedRef.current < 5 || progressRequest.current) return;
    const controller = new AbortController();
    progressRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 12000);
    fetch(`/api/video-lessons/${videoLesson.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchedSeconds: liveTime }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (progressRequest.current !== controller || controller.signal.aborted || !body) return;
        if (Number.isFinite(body.watchedSeconds)) reportedRef.current = Math.max(reportedRef.current, body.watchedSeconds);
        if (body.state) setState(body.state);
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(deadline);
        if (progressRequest.current === controller) progressRequest.current = null;
      });
  }, [liveTime, videoLesson.id]);

  useEffect(() => () => {
    const mutation = mutationRef.current;
    const progress = progressRequest.current;
    mutationRef.current = null;
    progressRequest.current = null;
    mutation?.abort();
    progress?.abort();
  }, [videoLesson.id]);

  async function writeLesson(kind: "answers" | "response", payload: Record<string, unknown>) {
    if (mutationRef.current) return;
    const controller = new AbortController();
    mutationRef.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 12000);
    setSaving(true);
    setRequestError(false);
    if (kind === "response") setSavedResponse(null);
    try {
      const res = await fetch(`/api/video-lessons/${videoLesson.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Video lesson write failed");
      const body = await res.json();
      if (mutationRef.current !== controller || controller.signal.aborted) return;
      if (kind === "answers" && body.graded) setGraded((prev) => ({ ...prev, ...body.graded }));
      if (body.state) setState(body.state);
      if (kind === "response") setSavedResponse(true);
    } catch {
      if (mutationRef.current === controller) {
        setRequestError(true);
        if (kind === "response") setSavedResponse(false);
      }
    } finally {
      window.clearTimeout(deadline);
      if (mutationRef.current === controller) {
        mutationRef.current = null;
        setSaving(false);
      }
    }
  }

  async function checkAnswers(stage: "comprehension" | "gap_fill") {
    const list = stage === "comprehension" ? comprehension : gapFill;
    const payload: Record<string, string> = {};
    for (const question of list) {
      const value = drafts[question.id]?.trim();
      if (value) payload[question.id] = value;
    }
    if (Object.keys(payload).length === 0) return;
    await writeLesson("answers", { answers: payload });
  }

  async function saveResponse() {
    await writeLesson("response", { responseText: opinion, summaryText: summary });
  }

  function renderQuestion(question: Question) {
    const verdict = graded[question.id];
    return (
      <li key={question.id} className="flex flex-col gap-2 border-b border-ink-200/60 py-3 last:border-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-ink-800">
            {question.prompt}
            {question.atSeconds !== null ? (
              <button
                type="button"
                onClick={() => seekTo(question.atSeconds!)}
                className="ml-2 rounded-sm border border-signal-600/40 px-1.5 py-0.5 text-xs text-signal-700 hover:bg-signal-50"
                data-video-question-seek
              >
                {formatClock(question.atSeconds)}
              </button>
            ) : null}
          </span>
          {verdict ? (
            <span
              className={verdict.correct ? "text-xs font-medium text-band-700" : "text-xs font-medium text-warn-700"}
              data-video-answer={verdict.correct ? "correct" : "wrong"}
            >
              {verdict.correct ? t.answerCorrect : t.answerWrong}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            value={drafts[question.id] ?? verdict?.answer ?? ""}
            placeholder={t.answerPlaceholder}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))}
            data-video-answer-input={question.id}
          />
        </div>
      </li>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-video-lesson={videoLesson.id} data-video-state={state}>
      <div className="overflow-hidden rounded-lg border border-ink-200 bg-ink-950">
        {provider === "direct" ? (
          direct ? (
            <DirectMediaPlayer src={direct.src} captions={direct.captions} title={videoLesson.title} labels={t.directPlayer} onTime={setLiveTime} controlsRef={directControls} />
          ) : (
            <p className="p-4 text-sm text-white" data-video-blocked>{t.blocked}</p>
          )
        ) : (
        <div className="relative aspect-video w-full">
            {playbackEnded ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white" data-video-ended>
              <p>{"Video tugadi / Video finished"}</p>
              <button type="button" className="btn-primary" onClick={() => { setRestartAt(0); setPlaybackGeneration(n => n + 1); setPlaybackEnded(false); }}>{"▶ Qayta ko'rish / Replay"}</button>
            </div> : <iframe
              key={playbackGeneration}
              ref={iframeRef}
              src={src}
              title={videoLesson.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full"
              // No popups or top navigation: provider links cannot take the
              // learner out of this site. Playback and native CC remain enabled.
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onError={() => setBlocked(true)}
              data-video-frame
            />}
        </div>
        )}
      </div>

      {/* No autoplay anywhere, and a blocked embed says so instead of showing a
          black rectangle. */}
      {blocked ? (
        <p className="rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-800" data-video-blocked>
          {t.blocked}{" "}

        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-500" data-video-live-transcript={liveTime !== null ? "yes" : "no"}>
          {liveTime !== null ? t.liveTrackingOn : t.liveTrackingOff}
        </span>
        <span className="text-xs font-medium text-ink-700" data-video-progress-state>
          {state === "completed" ? t.stateCompleted : state === "in_progress" ? t.stateInProgress : t.stateNotStarted}
        </span>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={t.stagesLabel}>
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            aria-current={tab === item}
            className={`rounded-sm px-3 py-1.5 text-sm ${
              tab === item ? "bg-signal-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"
            }`}
            data-video-tab={item}
          >
            {t.tabs[item]}
          </button>
        ))}
      </nav>

      {requestError ? <p role="alert" data-video-request-error>{dict.common.error}</p> : null}
      <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
        {tab === "before" && videoLesson.beforeYouWatch ? (
          <p className="whitespace-pre-line text-sm text-ink-700" data-video-before>
            {videoLesson.beforeYouWatch}
          </p>
        ) : null}

        {tab === "notes" ? (
          <div className="flex flex-col gap-2" data-video-notes-panel>
            <button
              type="button"
              className="btn-secondary w-fit"
              data-video-notes-reveal
              aria-expanded={notesShown}
              aria-controls="video-notes"
              onClick={() => setNotesShown((value) => !value)}
            >
              {notesShown ? t.hideNotes : t.revealNotes}
            </button>
            <p
              id="video-notes"
              className={`whitespace-pre-line text-sm text-ink-700 ${notesShown ? "" : "hidden"}`}
              data-video-notes={notesShown ? "shown" : "hidden"}
            >
              {notes}
            </p>
          </div>
        ) : null}

        {tab === "comprehension" ? (
          <div data-video-comprehension>
            <ul>{comprehension.map(renderQuestion)}</ul>
            <Button onClick={() => checkAnswers("comprehension")} disabled={saving} className="mt-3">
              {saving ? t.checking : t.checkAnswers}
            </Button>
          </div>
        ) : null}

        {tab === "gap" ? (
          <div data-video-gap>
            <ul>{gapFill.map(renderQuestion)}</ul>
            <Button onClick={() => checkAnswers("gap_fill")} disabled={saving} className="mt-3">
              {saving ? t.checking : t.checkAnswers}
            </Button>
          </div>
        ) : null}

        {tab === "opinion" ? (
          <div className="flex flex-col gap-3" data-video-opinion>
            <p className="text-sm text-ink-600">{t.opinionHint}</p>
            <textarea
              className="input min-h-28"
              value={opinion}
              onChange={(event) => setOpinion(event.target.value)}
              placeholder={t.opinionPlaceholder}
              data-video-opinion-input
            />
          </div>
        ) : null}

        {tab === "summary" ? (
          <div className="flex flex-col gap-3" data-video-summary>
            <p className="text-sm text-ink-600">{t.summaryHint}</p>
            <textarea
              className="input min-h-28"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t.summaryPlaceholder}
              data-video-summary-input
            />
          </div>
        ) : null}

        {tab === "opinion" || tab === "summary" ? (
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={saveResponse} disabled={saving} data-video-save-response>
              {saving ? t.saving : t.save}
            </Button>
            <span
              data-video-response-state={savedResponse === true ? "saved" : savedResponse === false ? "error" : "idle"}
              data-video-response-verdict={state}
            >
              {savedResponse === true ? (
                <span className="text-xs text-band-700">{t.saved}</span>
              ) : savedResponse === false ? (
                <span className="text-xs text-warn-700">{dict.common.error}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        {/* The teacher reads this writing; nothing here is auto-scored, and the
            page says so instead of showing an invented comment. */}
        {tab === "opinion" || tab === "summary" ? (
          <p className="mt-3 text-xs text-ink-500" data-video-feedback-note>
            {t.feedbackNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
