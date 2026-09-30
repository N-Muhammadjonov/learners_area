"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { Button } from "@/components/ui/Button";
import { embedUrlFor, watchUrlFor, type VideoProvider } from "@/lib/services/video/provider";

/**
 * A public video lesson: the player AND the learning around it.
 *
 * What this deliberately is not:
 *   - it is not a raw iframe dropped on a page. The video id is parsed and
 *     validated on the server, and the iframe src is built here from that
 *     reference — user text never becomes markup;
 *   - it does not claim the video source is hidden. A player that runs in the
 *     browser is visible in devtools; what we do is keep the raw link out of the
 *     interface and wrap the video in the lesson;
 *   - it does not invent a transcript. Timestamped lines exist only when the
 *     centre authored, licensed or was permitted the text, and the provenance is
 *     shown next to them.
 *
 * Honest limits are reflected in `data-*` attributes so a verification script can
 * check them rather than trusting the copy:
 *   data-video-live-transcript  = "yes" only once the player is really reporting
 *                                 its position (script follow otherwise stays off)
 *   data-video-completed        = the server's own verdict, never the client's
 *   data-video-save-response    = the write button; data-video-response-state is
 *                                 "saved" only after the server accepted it
 */
type Tab = "before" | "transcript" | "notes" | "comprehension" | "gap" | "opinion" | "summary";

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
}: {
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

  const [state, setState] = useState(initialProgress?.state ?? "not_started");
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const [follow, setFollow] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [graded, setGraded] = useState<Record<string, { answer: string; correct: boolean }>>(
    initialProgress?.answers ?? {}
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [opinion, setOpinion] = useState(initialProgress?.responseText ?? "");
  const [summary, setSummary] = useState(initialProgress?.summaryText ?? "");
  const [saving, setSaving] = useState(false);
  const [savedResponse, setSavedResponse] = useState<boolean | null>(null);

  // Memoised so the value is stable across renders: the cue list below depends
  // on it, and a fresh array on every render would recompute it needlessly.
  const transcript = useMemo(() => videoLesson.transcript ?? [], [videoLesson.transcript]);
  /** Centre-authored notes are optional, like the transcript. */
  const notes = useMemo(() => (videoLesson.notes ?? "").trim(), [videoLesson.notes]);
  const comprehension = useMemo(() => questions.filter((q) => q.stage === "comprehension"), [questions]);
  const gapFill = useMemo(() => questions.filter((q) => q.stage === "gap_fill"), [questions]);

  const tabs = useMemo(() => {
    const list: Tab[] = [];
    if (videoLesson.beforeYouWatch) list.push("before");
    if (transcript.length > 0) list.push("transcript");
    if (notes.length > 0) list.push("notes");
    if (comprehension.length > 0) list.push("comprehension");
    if (gapFill.length > 0) list.push("gap");
    list.push("opinion");
    // Written recall does not depend on a transcript: the student writes what they
    // remember from the video itself.
    list.push("summary");
    return list;
  }, [videoLesson.beforeYouWatch, transcript.length, notes.length, comprehension.length, gapFill.length]);

  const [tab, setTab] = useState<Tab>(tabs[0] ?? "opinion");
  /**
   * Both the transcript and the notes are revealed on purpose rather than
   * pushed at the learner: reading the script before watching gives the
   * listening away, and notes are a study aid the student asks for.
   */
  const [transcriptShown, setTranscriptShown] = useState(false);
  const [notesShown, setNotesShown] = useState(false);

  // Built without the browser origin so the player is part of the server-rendered
  // page: the video starts loading with the lesson instead of after hydration.
  const src = useMemo(() => embedUrlFor(provider, videoLesson.videoId), [provider, videoLesson.videoId]);

  const send = useCallback(
    (payload: Record<string, unknown>) => {
      // The player only accepts messages from the frame it owns.
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), "*");
    },
    []
  );

  const seekTo = useCallback(
    (seconds: number) => {
      send({ event: "command", func: "seekTo", args: [seconds, true] });
      send({ event: "command", func: "playVideo", args: [] });
    },
    [send]
  );

  // Ask the player to start reporting its position. If it never answers, script
  // follow stays unavailable rather than pretending to track anything.
  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    const ask = () => send({ event: "listening", id: 1, channel: "widget" });
    const onLoad = () => {
      ask();
      window.setTimeout(ask, 600);
    };
    el.addEventListener("load", onLoad);
    const interval = window.setInterval(ask, 5000);

    function onMessage(event: MessageEvent) {
      if (event.source !== el?.contentWindow) return;
      let data: unknown;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      const info = (data as { info?: { currentTime?: number } }).info;
      if (typeof info?.currentTime === "number") setLiveTime(info.currentTime);
    }
    window.addEventListener("message", onMessage);
    return () => {
      el.removeEventListener("load", onLoad);
      window.clearInterval(interval);
      window.removeEventListener("message", onMessage);
    };
  }, [send]);

  // Report real progress, throttled. The server clamps and keeps it monotonic.
  useEffect(() => {
    if (liveTime === null) return;
    if (liveTime - reportedRef.current < 5 && liveTime >= reportedRef.current) return;
    if (liveTime > reportedRef.current) reportedRef.current = liveTime;
    const controller = new AbortController();
    fetch(`/api/video-lessons/${videoLesson.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchedSeconds: liveTime }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.state) setState(body.state);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [liveTime, videoLesson.id]);

  const activeLineIndex = useMemo(() => {
    if (liveTime === null) return -1;
    let index = -1;
    for (let i = 0; i < transcript.length; i += 1) {
      if (transcript[i]!.startSeconds <= liveTime) index = i;
      else break;
    }
    return index;
  }, [liveTime, transcript]);

  async function checkAnswers(stage: "comprehension" | "gap_fill") {
    const list = stage === "comprehension" ? comprehension : gapFill;
    const payload: Record<string, string> = {};
    for (const question of list) {
      const value = drafts[question.id];
      if (value !== undefined && value !== "") payload[question.id] = value;
    }
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    const res = await fetch(`/api/video-lessons/${videoLesson.id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: payload }),
    });
    setSaving(false);
    if (!res.ok) return;
    const body = await res.json();
    setGraded((prev) => ({ ...prev, ...body.graded }));
    if (body.state) setState(body.state);
  }

  async function saveResponse() {
    setSaving(true);
    const res = await fetch(`/api/video-lessons/${videoLesson.id}/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseText: opinion, summaryText: summary }),
    });
    setSaving(false);
    setSavedResponse(res.ok);
    if (res.ok) {
      const body = await res.json();
      if (body.state) setState(body.state);
    }
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
        <div className="relative aspect-video w-full">
            <iframe
              ref={iframeRef}
              src={src}
              title={videoLesson.title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onError={() => setBlocked(true)}
              data-video-frame
            />
        </div>
      </div>

      {/* No autoplay anywhere, and a blocked embed says so instead of showing a
          black rectangle. */}
      <p className="text-xs text-ink-500" data-video-note>
        {t.playbackNote}
      </p>
      {blocked ? (
        <p className="rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-800" data-video-blocked>
          {t.blocked}{" "}
          <a
            href={watchUrlFor(provider, videoLesson.videoId)}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary "
          >
            {t.openOnProvider}
          </a>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-500" data-video-live-transcript={liveTime !== null ? "yes" : "no"}>
          {liveTime !== null ? t.liveTrackingOn : t.liveTrackingOff}
        </span>
        {transcript.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
              data-video-follow-toggle
            />
            {t.scriptFollow}
          </label>
        ) : null}
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

      <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
        {tab === "before" && videoLesson.beforeYouWatch ? (
          <p className="whitespace-pre-line text-sm text-ink-700" data-video-before>
            {videoLesson.beforeYouWatch}
          </p>
        ) : null}

        {tab === "transcript" ? (
          <div className="flex flex-col gap-1" data-video-transcript-panel>
            <p className="mb-2 text-xs text-ink-500">
              {t.transcriptProvenance}:{" "}
              <span data-video-transcript-source={videoLesson.transcriptSource ?? "unspecified"}>
                {videoLesson.transcriptSource ?? t.transcriptUnspecified}
              </span>
              {videoLesson.transcriptAttribution ? ` — ${videoLesson.transcriptAttribution}` : ""}
            </p>
            <button
              type="button"
              className="btn-secondary w-fit"
              data-video-transcript-reveal
              aria-expanded={transcriptShown}
              aria-controls="video-transcript-lines"
              onClick={() => setTranscriptShown((value) => !value)}
            >
              {transcriptShown ? t.hideTranscript : t.revealTranscript}
            </button>
            <ol
              id="video-transcript-lines"
              className={`max-h-80 overflow-y-auto pr-1 ${transcriptShown ? "" : "hidden"}`}
              data-video-transcript={transcriptShown ? "shown" : "hidden"}
            >
              {transcript.map((line, index) => (
                <li
                  key={`${line.startSeconds}-${index}`}
                  className={`flex gap-3 rounded-sm px-2 py-1 ${
                    follow && index === activeLineIndex ? "bg-signal-50" : ""
                  }`}
                  data-video-line={index}
                  data-video-line-active={follow && index === activeLineIndex ? "yes" : "no"}
                >
                  <button
                    type="button"
                    onClick={() => seekTo(line.startSeconds)}
                    className="shrink-0 font-mono text-xs text-signal-700 underline decoration-dotted"
                    data-video-timestamp={line.startSeconds}
                  >
                    {formatClock(line.startSeconds)}
                  </button>
                  <ClickableText
                    dict={dict}
                    text={line.text}
                    sourceType="video_lesson"
                    sourceId={lessonId}
                    className="text-sm text-ink-800"
                  />
                </li>
              ))}
            </ol>
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
    </section>
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
