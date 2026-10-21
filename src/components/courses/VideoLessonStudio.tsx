"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { LocalReflectionRecorder } from "@/components/audio/LocalReflectionRecorder";
import { VideoTranscriptDialog } from "./VideoTranscriptDialog";
import { VideoVocabulary, type VideoWord } from "./VideoVocabulary";
import { Button } from "@/components/ui/Button";
import { embedUrlFor, type VideoProvider } from "@/lib/services/video/provider";
import { DirectMediaPlayer, type DirectMediaControls } from "@/components/courses/DirectMediaPlayer";

/** Validated provider embeds with native captions and server-authoritative progress.
 * An authored transcript (timed lines or plain text) is shown as a read-only
 * Transcript tab only when it has content; native captions stay in the player.
 */
type Tab = "before" | "transcript" | "notes" | "comprehension" | "gap" | "opinion" | "summary" | "vocabulary";

/**
 * Explicit product context (never inferred from the URL or from whether
 * questions happen to exist):
 *   - "standalone": TED / PODCAST — authored exercises use the same grading service.
 *   - "course": a roadmap lesson's video — authored questions render as before.
 */
export type VideoLessonMode = "standalone" | "course";

type Question = {
  id: string;
  stage: "comprehension" | "gap_fill";
  prompt: string;
  atSeconds: number | null;
};

export function VideoLessonStudio({
  mode,
  dict,
  lessonId,
  videoLesson,
  questions,
  initialProgress,
  directMedia,
  embedOrigin,
  vocabulary = [],
  vocabularyReady = true,
}: {
  mode: VideoLessonMode;
  vocabulary?: VideoWord[];
  vocabularyReady?: boolean;
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
  const [transcriptShown,setTranscriptShown]=useState(false);
  const provider = videoLesson.provider as VideoProvider;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const reportedRef = useRef(initialProgress?.watchedSeconds ?? 0);
  const progressRequest = useRef<AbortController | null>(null);

  const [state, setState] = useState(initialProgress?.state ?? "not_started");
  // High-frequency player position lives in a ref: YouTube's infoDelivery can
  // fire several times a second and must not re-render the tabs/textareas.
  // Only the visible "tracking on" flag is state, and it flips once.
  const liveTimeRef = useRef<number | null>(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const trackingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [blocked, setBlocked] = useState(false);
  const [playbackEnded, setPlaybackEnded] = useState(false);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const generationRef = useRef(0);
  generationRef.current = playbackGeneration;
  // The playback generation whose end has already been flushed (one final write per generation).
  const finalizedGenerationRef = useRef(-1);
  // Resume: an unfinished lesson reopens where the server last acknowledged
  // progress (YouTube's own `start` parameter); a completed one starts at 0.
  const [restartAt, setRestartAt] = useState(() => {
    const saved = initialProgress?.watchedSeconds ?? 0;
    return initialProgress?.state !== "completed" && Number.isFinite(saved) && saved >= 5 ? Math.floor(saved) : 0;
  });
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
  const timedTranscript = useMemo(() => (videoLesson.transcript ?? []).filter((line) => line.text.trim().length > 0), [videoLesson.transcript]);
  const plainTranscript = useMemo(() => (videoLesson.transcriptText ?? "").trim(), [videoLesson.transcriptText]);
  const hasTranscript = timedTranscript.length > 0 || plainTranscript.length > 0;
  const comprehension = useMemo(() => questions.filter((q) => q.stage === "comprehension"), [questions]);
  const gapFill = useMemo(() => questions.filter((q) => q.stage === "gap_fill"), [questions]);

  const tabs = useMemo(() => {
    if(mode === "standalone") return [...(notes.length ? ["notes" as const] : []),"vocabulary","summary"] as Tab[];
    const list: Tab[] = [];
    // Whitespace-only authored text is no content: hide the tab.
    if (videoLesson.beforeYouWatch?.trim()) list.push("before");
    if (hasTranscript) list.push("transcript");
    if (notes.length > 0) list.push("notes");
    // Render only stages with real authored questions in either mode.
    if (comprehension.length > 0) list.push("comprehension");
    if (gapFill.length > 0) list.push("gap");
    if (vocabulary.length > 0) list.push("vocabulary");
    list.push("opinion");
    // Written recall does not depend on a transcript: the student writes what they
    // remember from the video itself.
    list.push("summary");
    return list;
  }, [videoLesson.beforeYouWatch, hasTranscript, notes.length, comprehension.length, gapFill.length, vocabulary.length, mode]);

  const [selectedTab, setTab] = useState<Tab>(tabs[0] ?? "opinion");
  // If the available tabs ever change, never point at a removed one.
  const tab: Tab = tabs.includes(selectedTab) ? selectedTab : (tabs[0] ?? "opinion");
  const activeTab = tab;
  const tabIdBase = `video-${useId().replace(/:/g, "")}`;
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

  const applyServerProgress = useCallback((body: { watchedSeconds?: unknown; state?: unknown } | null) => {
    if (!body) return;
    if (typeof body.watchedSeconds === "number" && Number.isFinite(body.watchedSeconds)) reportedRef.current = Math.max(reportedRef.current, body.watchedSeconds);
    if (mountedRef.current && typeof body.state === "string") setState(body.state);
  }, []);

  // Periodic write: at most one in flight, only after >= 5 new watched seconds,
  // bounded at 12 s; the acknowledged position advances only on server success.
  const maybeSendProgress = useCallback(() => {
    const seconds = liveTimeRef.current;
    if (seconds === null || seconds - reportedRef.current < 5 || progressRequest.current) return;
    const controller = new AbortController();
    progressRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 12000);
    fetch(`/api/video-lessons/${videoLesson.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchedSeconds: seconds }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (progressRequest.current !== controller || controller.signal.aborted) return;
        applyServerProgress(body);
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(deadline);
        if (progressRequest.current === controller) progressRequest.current = null;
      });
  }, [videoLesson.id, applyServerProgress]);

  const onPosition = useCallback((seconds: number) => {
    liveTimeRef.current = seconds;
    if (!trackingRef.current) { trackingRef.current = true; setTrackingActive(true); }
    maybeSendProgress();
  }, [maybeSendProgress]);

  // Final write on a trusted END. Called directly from the verified message
  // handler (not from an effect), once per playback generation, with
  // keepalive and no unmount/replay abort, so Replay or navigation cannot
  // cancel it. Independent of any periodic write in flight; the server keeps
  // watchedSeconds monotonic and decides the state (`ended` is a report).
  const flushFinalProgress = useCallback(() => {
    if (finalizedGenerationRef.current === generationRef.current) return;
    const duration = videoLesson.durationSeconds && videoLesson.durationSeconds > 0 ? videoLesson.durationSeconds : null;
    // END can arrive before YouTube's last position delivery. For an
    // unknown-duration lesson, use the last server-acknowledged position as a
    // safe fallback and do not consume this generation before a write exists.
    const seconds = duration ?? liveTimeRef.current ?? (reportedRef.current > 0 ? reportedRef.current : null);
    if (seconds === null) return;
    finalizedGenerationRef.current = generationRef.current;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12000);
    fetch(`/api/video-lessons/${videoLesson.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchedSeconds: seconds, ended: true }),
      keepalive: true,
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(applyServerProgress)
      .catch(() => {})
      .finally(() => clearTimeout(deadline));
  }, [videoLesson.id, videoLesson.durationSeconds, applyServerProgress]);

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
      const info = message.info as { currentTime?: number; playerState?: number } | undefined;
      if (typeof info?.currentTime === "number" && Number.isFinite(info.currentTime) && info.currentTime >= 0) onPosition(info.currentTime);
      const ended = (message.event === "onStateChange" && message.info === 0) || (message.event === "infoDelivery" && info?.playerState === 0);
      if (ended) {
        // END -> final write first (detached from React lifecycle) -> replay UI.
        flushFinalProgress();
        setPlaybackEnded(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      el.removeEventListener("load", onLoad);
      window.clearInterval(interval);
      window.clearTimeout(loadTimer);
      window.removeEventListener("message", onMessage);
    };
  }, [send, src, playbackEnded, playbackGeneration, onPosition, flushFinalProgress]);

  useEffect(() => () => {
    const mutation = mutationRef.current;
    const progress = progressRequest.current;
    mutationRef.current = null;
    progressRequest.current = null;
    mutation?.abort();
    progress?.abort();
  }, [videoLesson.id]);

  async function writeLesson(kind: "answers" | "response", payload: Record<string, unknown>) {
    if (mutationRef.current) return false;
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
      if (mutationRef.current !== controller || controller.signal.aborted) return false;
      if (kind === "answers" && body.graded) setGraded((prev) => ({ ...prev, ...body.graded }));
      if (body.state) setState(body.state);
      if (kind === "response") setSavedResponse(true);
      return true;
    } catch {
      if (mutationRef.current === controller) {
        setRequestError(true);
        if (kind === "response") setSavedResponse(false);
      }
      return false;
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
    if (mode === "standalone") await writeLesson("response", { summaryText: summary });
    else await writeLesson("response", { responseText: opinion, summaryText: summary });
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
            <DirectMediaPlayer src={direct.src} captions={direct.captions} title={videoLesson.title} labels={t.directPlayer} onTime={onPosition} controlsRef={directControls} />
          ) : (
            <p className="p-4 text-sm text-white" data-video-blocked>{t.blocked}</p>
          )
        ) : (
        <div className="relative aspect-video w-full">
            {playbackEnded ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white" data-video-ended>
              <p>{t.ended}</p>
              <button type="button" className="btn-primary" onClick={() => { setRestartAt(0); setPlaybackGeneration(n => n + 1); setPlaybackEnded(false); }}>▶ {t.replay}</button>
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
        <span className="text-xs text-ink-500" data-video-live-transcript={trackingActive ? "yes" : "no"}>
          {trackingActive ? t.liveTrackingOn : t.liveTrackingOff}
        </span>
        <span className="text-xs font-medium text-ink-700" data-video-progress-state>
          {state === "completed" ? t.stateCompleted : state === "in_progress" ? t.stateInProgress : t.stateNotStarted}
        </span>
      </div>

      {mode === "standalone" && hasTranscript && <button type="button" className="btn-secondary w-fit" data-video-open-transcript onClick={()=>setTranscriptShown(true)}>{t.tabs.transcript}</button>}
      {transcriptShown&&<VideoTranscriptDialog id={videoLesson.id} dict={dict} text={timedTranscript.length?timedTranscript.map(line=>line.text).join("\n"):plainTranscript} onClose={()=>setTranscriptShown(false)}/>}
      <div className="contents">
      {!vocabularyReady && <p role="status" className="text-sm text-ink-500">{t.vocabularyUnavailable}</p>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.stagesLabel} data-video-tablist>
        {tabs.map((item, index) => (
          <button
            key={item}
            id={`${tabIdBase}-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`${tabIdBase}-panel`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => setTab(item)}
            onKeyDown={(event) => {
              const last = tabs.length - 1;
              const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
                : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
                : event.key === "Home" ? 0
                : event.key === "End" ? last
                : null;
              if (next === null) return;
              event.preventDefault();
              setTab(tabs[next]!);
              document.getElementById(`${tabIdBase}-tab-${tabs[next]}`)?.focus();
            }}
            className={`rounded-sm px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 ${
              tab === item ? "bg-signal-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"
            }`}
            data-video-tab={item}
          >
            {t.tabs[item]}
          </button>
        ))}
      </div>

      {requestError ? <p role="alert" data-video-request-error>{dict.common.error}</p> : null}
      <div
        key={activeTab}
        className="motion-tab-panel rounded-lg border border-ink-200 bg-paper-50 p-4"
        role="tabpanel"
        id={`${tabIdBase}-panel`}
        aria-labelledby={`${tabIdBase}-tab-${activeTab}`}
        tabIndex={0}
        data-video-tabpanel
      >
        {tab === "vocabulary" ? <VideoVocabulary id={videoLesson.id} words={vocabulary} dict={dict} /> : null}
        {tab === "before" && videoLesson.beforeYouWatch ? (
          <p className="whitespace-pre-line text-sm text-ink-700" data-video-before>
            {videoLesson.beforeYouWatch}
          </p>
        ) : null}

        {tab === "transcript" ? (
          <div className="flex flex-col gap-2" data-video-transcript-panel>
            {timedTranscript.length > 0 ? (
              <ol className="flex flex-col gap-1.5">
                {timedTranscript.map((line, index) => (
                  <li key={`${line.startSeconds}-${index}`} className="flex gap-3 text-sm text-ink-700">
                    <span className="shrink-0 font-mono text-xs leading-5 text-ink-500">{formatClock(line.startSeconds)}</span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="whitespace-pre-line text-sm text-ink-700" data-video-transcript-text>{plainTranscript}</p>
            )}
            {videoLesson.transcriptAttribution ? (
              <p className="text-xs text-ink-500">{t.transcriptProvenance}: {videoLesson.transcriptAttribution}</p>
            ) : null}
          </div>
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
      {/* Outside the keyed animation panel: the recording belongs to the lesson, not the tab. */}
        {mode === "standalone" && <LocalReflectionRecorder key={`${lessonId}:${videoLesson.id}`} dict={dict} active={tab === "summary"} />}
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
