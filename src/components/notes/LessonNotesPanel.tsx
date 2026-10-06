"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

/**
 * Xulosangiz — the learner's PRIVATE note on one lesson.
 *
 * Autosave with a truthful state: the box says Saving…, Saved or Could not save,
 * and "Saved" is only ever printed after the server answered 2xx for THAT text. If
 * a save fails the text stays in the box with a retry action — nothing is silently
 * dropped. The browser keeps no copy at all (no web-storage API is used): the
 * private server table is the only store.
 *
 * The write is an idempotent upsert on (user, lesson); a superseded in-flight save
 * cannot overwrite newer text with older text, because the newest edit always wins
 * the debounce and the flush below re-sends the current value.
 */
const SAVE_DEBOUNCE_MS = 900;

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "failed";

export function LessonNotesPanel({
  dict,
  lessonId,
  initialNotes,
  maxLength = 4000,
}: {
  dict: Dictionary;
  lessonId: string;
  initialNotes: string;
  maxLength?: number;
}) {
  const t = dict.courseRoadmap;
  const save = useScopedRequest();
  const [text, setText] = useState(initialNotes);
  const [state, setState] = useState<SaveState>("idle");

  // The value the last successful save wrote, so the button/indicator never claims
  // more than the server actually holds.
  const savedText = useRef(initialNotes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  async function persist(value: string) {
    const mine = ++sequence.current;
    setState("saving");
    const result = await save<{ ok?: boolean; notes?: string | null }>(`/api/lessons/${lessonId}/notes`, {
      method: "POST",
      body: { notes: value },
    });
    // A superseded request returns null: a newer edit owns the indicator now.
    if (!result || mine !== sequence.current) return;
    if (!result.ok) {
      setState("failed");
      return;
    }
    savedText.current = value;
    setState("saved");
  }

  useEffect(() => {
    if (text === savedText.current) return;
    if (text.length > maxLength) {
      setState("failed");
      return;
    }
    setState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(text);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Leaving the page must not lose the last edit: flush on unmount.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (text !== savedText.current && text.length <= maxLength) void persist(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const tooLong = text.length > maxLength;
  const indicator =
    tooLong
      ? t.notesTooLong
      : state === "saving"
        ? t.notesSaving
        : state === "saved"
          ? t.notesSaved
          : state === "failed"
            ? t.notesSaveFailed
            : "";

  return (
    <div data-lesson-notes-panel>
      <label htmlFor={`notes-${lessonId}`} className="text-sm font-medium text-ink-700">
        {t.myNotes}
      </label>
      <p className="mt-1 text-xs text-ink-300">{t.notesPrivate}</p>
      <Textarea
        id={`notes-${lessonId}`}
        className="mt-2"
        value={text}
        placeholder={t.notesPlaceholder}
        onChange={(event) => setText(event.target.value)}
        data-lesson-notes
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={state === "failed" || tooLong ? "text-band-bad" : "text-ink-300"}
          data-lesson-notes-state={tooLong ? "too_long" : state}
        >
          {indicator}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-ink-300" data-lesson-notes-count>
            {text.length} / {maxLength}
          </span>
          {state === "failed" && !tooLong && (
            <button type="button" className="text-ink-700 underline" onClick={() => void persist(text)} data-lesson-notes-retry>
              {t.notesRetry}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
