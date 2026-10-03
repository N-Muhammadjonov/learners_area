"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import { formatDate } from "@/lib/time";

/**
 * Notes and progress for one lesson.
 *
 * The buttons ask; the API decides (a locked lesson cannot be started, a completed
 * one cannot be completed twice). Notes are saved explicitly, so a half-typed
 * sentence is never posted as the student's notes.
 */
export function LessonWorkspace({
  dict,
  lessonId,
  state,
  initialNotes,
  completedAt,
}: {
  dict: Dictionary;
  lessonId: string;
  state: string;
  initialNotes: string;
  completedAt: string | null;
}) {
  const requestResponse = useScopedResponse(25000);

  const t = dict.courseRoadmap;
  const [notes, setNotes] = useState(initialNotes);
  const [savedNotes, setSavedNotes] = useState(initialNotes);
  const [current, setCurrent] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function move(next: "in_progress" | "completed") {
    setBusy(true);
    setError(null);
    const res = await requestResponse(`/api/lessons/${lessonId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: next, notes: savedNotes || undefined }),
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "locked"
          ? t.notOpenYet
          : body.error === "wrong_direction"
            ? t.alreadyDone
            : dict.common.error
      );
      return;
    }
    const body = await res.json();
    setCurrent(body.state);
  }

  async function saveNotes() {
    setBusy(true);
    setError(null);
    const res = await requestResponse(`/api/lessons/${lessonId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      setError(dict.common.error);
      return;
    }
    setSavedNotes(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card data-lesson-workspace>
      <div className="flex flex-wrap items-center gap-2" data-lesson-actions>
        <Button
          variant="secondary"
          disabled={busy || current === "in_progress" || current === "completed"}
          onClick={() => void move("in_progress")}
          data-lesson-start
        >
          {t.startLesson}
        </Button>
        <Button disabled={busy || current === "completed"} onClick={() => void move("completed")} data-lesson-complete>
          {t.completeLesson}
        </Button>
        {current === "completed" && (
          <span className="text-sm text-band-good" data-lesson-done>
            {t.completedOn}
            {completedAt ? ` ${formatDate(completedAt)}` : ""}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-band-bad" data-lesson-error>
          {error}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor={`notes-${lessonId}`} className="text-sm font-medium text-ink-700">
          {t.myNotes}
        </label>
        <p className="mt-1 text-xs text-ink-300">{t.notesPrivate}</p>
        <textarea
          id={`notes-${lessonId}`}
          className="input mt-2 min-h-[120px] w-full"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-lesson-notes
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={busy || notes === savedNotes}
            onClick={() => void saveNotes()}
            data-lesson-save-notes
          >
            {busy ? dict.common.saving : dict.common.save}
          </Button>
          {saved && (
            <span className="text-xs text-band-good" data-lesson-notes-saved>
              {dict.common.saved}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
