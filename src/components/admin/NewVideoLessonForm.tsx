"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Authoring form for a public video lesson.
 *
 * The centre pastes a normal link; the server parses and validates it. A refused
 * link explains itself (unsupported host, missing id, wrong shape) instead of
 * silently creating a lesson whose video will never play.
 *
 * Transcript and questions are pasted as plain text on purpose: the point is that
 * the text is AUTHORED here, not scraped. Each row is parsed on the client into
 * the structured shape the server expects, and the server validates it again.
 */
type LessonOption = { id: string; title: string };

export function NewVideoLessonForm({ dict, lessons }: { dict: Dictionary; lessons: LessonOption[] }) {
  const t = dict.videoLessonAdmin;
  const router = useRouter();
  const submitting = useRef(false);
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [before, setBefore] = useState("");
  const [duration, setDuration] = useState("");
  const [transcriptSource, setTranscriptSource] = useState("");
  const [attribution, setAttribution] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [notes, setNotes] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);

    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 12_000);
    try {
    const res = await fetch("/api/admin/video-lessons", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId,
        title,
        videoUrl,
        beforeYouWatch: before || null,
        durationSeconds: duration ? Number(duration) : null,
        transcriptSource: transcriptSource || null,
        transcriptAttribution: attribution || null,
        transcript: parseTranscript(transcriptText),
        notes: notes.trim() || null,
        questions: parseQuestions(questionsText),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (res.ok) {
      setMessage({ tone: "ok", text: t.saved });
      setTitle("");
      setVideoUrl("");
      setBefore("");
      setTranscriptText("");
      setQuestionsText("");
      router.refresh();
      return;
    }
    const reason = body.reason as keyof typeof t.rejection | undefined;
    setMessage({
      tone: "bad",
      text: (reason && t.rejection[reason]) ?? body.error ?? dict.common.error,
    });
    } catch {
      setMessage({ tone: "bad", text: dict.errors.unknown });
    } finally {
      window.clearTimeout(deadline);
      submitting.current = false;
      setBusy(false);
    }
  }

  if (lessons.length === 0) {
    return <p className="text-sm text-ink-500">{t.none}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-video-admin-form>
      <p className="text-sm text-ink-600">{t.intro}</p>

      <label className="flex flex-col gap-1 text-sm">
        {t.lesson}
        <select className="input" value={lessonId} onChange={(e) => setLessonId(e.target.value)} required>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.videoTitle}
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} />
      </label>

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
        {t.transcriptSource}
        <select className="input max-w-64" value={transcriptSource} onChange={(e) => setTranscriptSource(e.target.value)}>
          <option value="">{t.transcriptSourceNone}</option>
          <option value="authored">authored</option>
          <option value="licensed">licensed</option>
          <option value="permitted">permitted</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.transcriptAttribution}
        <Input value={attribution} onChange={(e) => setAttribution(e.target.value)} maxLength={200} />
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
        {t.transcriptLines}
        <textarea
          className="input min-h-28 font-mono text-xs"
          value={transcriptText}
          onChange={(e) => setTranscriptText(e.target.value)}
          placeholder={"0:12 Welcome to this talk.\n0:18 Today we look at two ideas."}
          data-video-transcript-input
        />
        <span className="text-xs text-ink-500">{t.transcriptHelp}</span>
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

export function parseTranscript(text: string): { startSeconds: number; text: string }[] {
  const lines: { startSeconds: number; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/);
    if (!match) continue;
    const [, a, b, c, body] = match;
    const seconds = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    lines.push({ startSeconds: seconds, text: body!.trim() });
  }
  return lines;
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
