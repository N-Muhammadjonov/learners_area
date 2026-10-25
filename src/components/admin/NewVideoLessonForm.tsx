"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiErrorMessage } from "@/lib/api-error-message";

import { parseTranscriptInput } from "@/lib/services/video/transcript";
export { parseTranscript, parseTranscriptInput, type TranscriptInput } from "@/lib/services/video/transcript";

/**
 * Authoring form for a public video lesson.
 *
 * The centre pastes a normal link; the server parses and validates it. A refused
 * link explains itself (unsupported host, missing id, wrong shape) instead of
 * silently creating a lesson whose video will never play.
 *
 * URL, title, notes and optional authored exercises serve both learning modes.
 * Captions come from the provider player itself.
 */
type LessonOption = { id: string; title: string };

export function NewVideoLessonForm({ dict, lessons }: { dict: Dictionary; lessons: LessonOption[] }) {
  const t = dict.videoLessonAdmin;
  const router = useRouter();
  const submitting = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => {
    const active = activeRequest.current;
    activeRequest.current = null;
    active?.abort();
  }, []);
  // Standalone by default: a TED / Podcast item never needs a roadmap lesson.
  const [lessonId, setLessonId] = useState("");
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [before, setBefore] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptSource, setTranscriptSource] = useState("authored");
  const [vocabularyText, setVocabularyText] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const transcript = parseTranscriptInput(transcriptText);
    if (transcript.kind === "mixed") {setMessage({tone: "bad", text: t.transcriptMixed}); return;}
    const vocabulary = vocabularyText.trim() ? vocabularyText.trim().split(/\r?\n/).map(line => {
      const [word = "", pos = "", def = "", uz = "", ex = ""] = line.split("||").map(part => part.trim());
      return {word, pos, def, uz, ex};
    }) : [];
    if (vocabulary.some(entry => ![transcript.kind === "plain" ? transcript.text : transcript.kind === "timed" ? transcript.lines.map(line => line.text).join("\n") : "", notes].join("\n").includes(entry.ex) || !entry.ex)) {
      setMessage({tone: "bad", text: t.vocabularyContextRequired}); return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage(null);

    const controller = new AbortController();
    activeRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 12_000);
    try {
    const res = await fetch("/api/admin/video-lessons", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: lessonId || null,
        title,
        videoUrl,
        beforeYouWatch: before || null,
        durationSeconds: duration ? Number(duration) : null,
        // Captions are supplied by the player; no transcript is scraped or invented.
        transcriptSource: transcript.kind === "empty" ? null : transcriptSource,
        transcriptAttribution: null,
        transcript: transcript.kind === "timed" ? transcript.lines : null,
        transcriptText: transcript.kind === "plain" ? transcript.text : null,
        ...(vocabulary.length ? {vocabulary} : {}),
        notes: notes.trim() || null,
        // Both standalone and course items may carry authored exercises.
        questions: parseQuestions(questionsText),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (activeRequest.current !== controller || controller.signal.aborted) return;

    if (res.ok) {
      setMessage({ tone: "ok", text: t.saved });
      setTitle("");
      setVideoUrl("");
      setBefore("");
      setNotes("");
      setQuestionsText(""); setTranscriptText(""); setVocabularyText("");
      router.refresh();
      return;
    }
    const reason = body.reason as keyof typeof t.rejection | undefined;
    setMessage({
      tone: "bad",
      text: (reason && t.rejection[reason]) ?? apiErrorMessage(body.error, res.status, dict, {vocabulary_context_required: t.vocabularyContextRequired}),
    });
    } catch {
      if (activeRequest.current === controller) setMessage({ tone: "bad", text: dict.errors.unknown });
    } finally {
      window.clearTimeout(deadline);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        submitting.current = false;
        setBusy(false);
      }
    }
  }


  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-video-admin-form>
      <p className="text-sm text-ink-600">{t.intro}</p>

      <label className="flex flex-col gap-1 text-sm">
        {t.videoUrl}
        <Input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          required
          data-video-url-input
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.videoTitle}
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.notes}
        <textarea
          className="input min-h-24"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={4000}
          data-video-notes-input
        />
        <span className="text-xs text-ink-500">{t.notesHelp}</span>
      </label>


      <label className="flex flex-col gap-1 text-sm">
        {t.transcriptText}<textarea className="input min-h-28" value={transcriptText} onChange={e => setTranscriptText(e.target.value)} maxLength={20000} data-video-transcript-input />
        <span className="text-xs text-ink-500">{t.transcriptTextHelp}</span>
      </label>
      {transcriptText.trim() && <label className="flex flex-col gap-1 text-sm">{t.transcriptSource}
        <select className="input" value={transcriptSource} onChange={e => setTranscriptSource(e.target.value)}>
          <option value="authored">{t.sourceAuthored}</option><option value="licensed">{t.sourceLicensed}</option><option value="permitted">{t.sourcePermitted}</option>
        </select>
      </label>}
      <label className="flex flex-col gap-1 text-sm">{t.vocabulary}
        <textarea className="input min-h-24" value={vocabularyText} onChange={e => setVocabularyText(e.target.value)} maxLength={20000} data-video-vocabulary-input />
        <span className="text-xs text-ink-500">{t.vocabularyHelp}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.lessonOptional}
        <select className="input" value={lessonId} onChange={(e) => {
          const next = e.target.value;
          setLessonId(next);

        }} data-video-lesson-select>
          <option value="">{t.standaloneOption}</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.beforeYouWatch}
        <textarea className="input min-h-20" value={before} onChange={(e) => setBefore(e.target.value)} maxLength={2000} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.durationSeconds}
        <Input
          type="number"
          min={0}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="max-w-40"
        />
      </label>



      <label className="flex flex-col gap-1 text-sm">
        {t.questions}
        <textarea
          className="input min-h-28 font-mono text-xs"
          value={questionsText}
          onChange={(e) => setQuestionsText(e.target.value)}
          placeholder={"What is the speaker's main point? || education matters | learning matters\ngap_fill The speaker says it is ___ || possible | achievable"}
          data-video-questions-input
        />
        <span className="text-xs text-ink-500">{t.questionsHelp}</span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t.saving : t.save}
        </Button>
        {message ? (
          <span
            className={message.tone === "ok" ? "text-sm text-band-700" : "text-sm text-warn-700"}
            data-video-admin-message={message.tone}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function parseQuestions(
  text: string
): { stage: "comprehension" | "gap_fill"; prompt: string; acceptedAnswers: string[] }[] {
  const questions: { stage: "comprehension" | "gap_fill"; prompt: string; acceptedAnswers: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const stage = line.startsWith("gap_fill ") ? "gap_fill" : "comprehension";
    const body = stage === "gap_fill" ? line.slice("gap_fill ".length) : line;
    const [promptPart, answersPart] = body.split("||");
    const prompt = (promptPart ?? "").trim();
    const accepted = (answersPart ?? "")
      .split("|")
      .map((answer) => answer.trim())
      .filter(Boolean);
    if (prompt.length >= 3 && accepted.length > 0) questions.push({ stage, prompt, acceptedAnswers: accepted });
  }
  return questions;
}
