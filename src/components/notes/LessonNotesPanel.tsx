"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { requestJson } from "@/lib/http/client-request";

/**
 * Xulosangiz — the learner's PRIVATE note on one lesson.
 *
 * Autosave with a truthful state: the box says Saving…, Saved or Could not save, and
 * "Saved" is only ever printed when the server has acknowledged the text that is
 * CURRENTLY in the box. A failure keeps the text on screen with a retry action —
 * nothing is silently dropped, and no web-storage API is used: the private server
 * row is the only store.
 *
 * ## One serialized write pipeline
 *
 * There is exactly **one** note write in flight per mounted panel, ever. Edits while
 * a request is running are coalesced into ONE pending value (the latest text), never
 * queued per keystroke:
 *
 *   edit → 900 ms debounce ─┐
 *   blur ───────────────────┼─→ pending = latest text ─→ (if idle) send it
 *   page hide / unmount ────┘                              ↓
 *                            while a send is in flight: newer edits replace `pending`
 *                                          ↓
 *                            when the send settles: if `pending` still differs from what
 *                            the server acknowledged, send it next — and so on.
 *
 * Why the ordering is a *serialized pipeline* and not abort-based cancellation:
 * `AbortController` stops the browser from waiting for a response; it does NOT prove
 * the server transaction was cancelled. If a second write were started while an older
 * one was still being processed, the older one could commit last and the stale text
 * would become the stored value. Because this panel never runs two writes at once,
 * that interleaving cannot be produced from one panel. (This is deliberately NOT the
 * shared `useScopedRequest`, whose "abort the previous request" behaviour is exactly
 * the mechanism that must not govern note writes.)
 *
 * Scope of the guarantee, stated precisely: within one mounted panel session, writes
 * are serialized and coalesced, so a stale in-flight request cannot overwrite a later
 * edit. Cross-tab and cross-device last-writer ordering is NOT implemented — there is
 * no optimistic-concurrency token on the row, and two browsers editing the same lesson
 * still resolve by arrival order at the server.
 *
 * ## Lifetime and exit
 *
 * The refs below always hold CURRENT values (`latestTextRef`, `acknowledgedTextRef`),
 * and the exit path is a single mount-time effect that READS those refs — it never
 * closes over a render's `text`. That is the difference between "we intended to flush
 * on unmount" and "the flush sends the last edit": a cleanup registered with an empty
 * dependency list sees only its own render's values, which is why the exit flush here
 * does not reference `text` at all.
 *
 * Exit sends use `keepalive` so a save that is already on its way survives the document
 * being torn down (page hide / tab close). A client-side route change keeps the document
 * alive anyway, and the request is not tied to a cancellation scope that unmount aborts,
 * so both exits are covered without depending on React's cleanup ORDER relative to other
 * hooks.
 */
const SAVE_DEBOUNCE_MS = 900;

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "failed" | "tooLong";

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
  const [text, setText] = useState(initialNotes);
  const [state, setState] = useState<SaveState>("idle");

  /** The text currently in the box. Never read from a render closure on the exit path. */
  const latestTextRef = useRef(initialNotes);
  /** The text the server has acknowledged (2xx) for THIS panel. */
  const acknowledgedTextRef = useRef(initialNotes);
  /** The single coalesced value waiting to be written; null means "nothing pending". */
  const pendingRef = useRef<string | null>(null);
  /** Whether the pending write must survive document teardown (exit path). */
  const pendingKeepaliveRef = useRef(false);
  /** The one-writer latch: true from the moment a send starts until it settles. */
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = `/api/lessons/${lessonId}/notes`;

  /**
   * The pipeline. Drains `pendingRef` one write at a time; a call that arrives while a
   * send is running is already reflected in `pendingRef`, so the loop picks it up.
   */
  const pump = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current !== null) {
        const value = pendingRef.current;
        const keepalive = pendingKeepaliveRef.current;
        pendingRef.current = null;
        pendingKeepaliveRef.current = false;

        // Already on the server (an exit flush can re-enqueue the same text): sending it
        // again would be a duplicate write with no new information.
        if (value === acknowledgedTextRef.current) continue;
        // An over-long note is never posted to be silently truncated.
        if (value.length > maxLength) {
          setState("tooLong");
          continue;
        }

        setState((current) => (current === "saving" ? current : "saving"));
        const result = await requestJson<{ ok?: boolean; notes?: string | null }>(url, {
          method: "POST",
          body: { notes: value },
          ...(keepalive ? { keepalive: true } : {}),
        });

        if (!result.ok) {
          if (pendingRef.current !== null) continue; // a newer edit exists: recover with it
          // Nothing newer: keep the text pending so the retry action re-sends exactly it.
          pendingRef.current = value;
          setState("failed");
          break;
        }

        acknowledgedTextRef.current = value;
        // Truthful indicator: "Saved" only when the server holds the text in the box.
        setState(latestTextRef.current === value ? "saved" : "unsaved");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [maxLength, url]);

  /** Coalesce to the LATEST text and (if idle) start writing it. */
  const flushLatest = useCallback(
    (keepalive: boolean) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const latest = latestTextRef.current;
      if (latest === acknowledgedTextRef.current || latest.length > maxLength) {
        // Nothing to write: already saved, or refused by the bound. Never send it.
        if (latest.length > maxLength) setState("tooLong");
        return;
      }
      pendingRef.current = latest;
      if (keepalive) pendingKeepaliveRef.current = true;
      void pump();
    },
    [maxLength, pump],
  );

  // Typing: mark unsaved immediately (or too long, which is a refusal, not a pending
  // save), then write after the debounce.
  useEffect(() => {
    if (text.length > maxLength) {
      setState("tooLong");
      return;
    }
    if (text === acknowledgedTextRef.current) return;
    setState((current) => (current === "saving" ? current : "unsaved"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushLatest(false);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, maxLength, flushLatest]);

  // Leaving: blur, the page going away, and unmount all flush the LATEST text.
  //
  // This effect is registered once and its cleanup reads refs, so it can never send a
  // stale render's text. It does not depend on any other hook's cleanup having run,
  // and the write it starts is not owned by a cancellation scope that unmount aborts.
  useEffect(() => {
    const onPageHide = () => flushLatest(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushLatest(true);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushLatest(true);
    };
  }, [flushLatest]);

  const tooLong = state === "tooLong" || text.length > maxLength;
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
        onChange={(event) => {
          // Synchronous, so a flush triggered in the same task as the last keystroke
          // (blur, page hide, unmount) always sees it.
          latestTextRef.current = event.target.value;
          setText(event.target.value);
        }}
        onBlur={() => flushLatest(false)}
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
          {state === "failed" && (
            <button type="button" className="text-ink-700 underline" onClick={() => flushLatest(false)} data-lesson-notes-retry>
              {t.notesRetry}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
