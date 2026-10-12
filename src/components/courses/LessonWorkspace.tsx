"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LessonNotesPanel } from "@/components/notes/LessonNotesPanel";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import { formatDate } from "@/lib/time";

/**
 * Progress for one lesson, plus the learner's private note pad.
 *
 * The buttons ask; the API decides (a locked lesson cannot be started, a completed
 * one cannot be completed twice). The note pad is `LessonNotesPanel`, which
 * autosaves to `/api/lessons/:id/notes` — one private store per learner per lesson,
 * never part of this progress write and never read by staff surfaces.
 */
export function LessonWorkspace({
  dict,
  lessonId,
  state,
  initialNotes,
  completedAt,
  showNotes = true,
}: {
  dict: Dictionary;
  lessonId: string;
  state: string;
  initialNotes: string;
  completedAt: string | null;
  showNotes?: boolean;
}) {
  const requestResponse = useScopedResponse(25000);

  const t = dict.courseRoadmap;
  const [current, setCurrent] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(next: "in_progress" | "completed") {
    setBusy(true);
    setError(null);
    const res = await requestResponse(`/api/lessons/${lessonId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: next }),
    });
    setBusy(false);
    if (!res) { setError(dict.common.error); return; }
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

      {showNotes && <div className="mt-4">
        <LessonNotesPanel dict={dict} lessonId={lessonId} initialNotes={initialNotes} />
      </div>}
    </Card>
  );
}
