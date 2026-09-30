"use client";

import { useEffect } from "react";

/**
 * "A real attempt just opened" — the one signal that may switch Focus mode on
 * by itself.
 *
 * Focus mode belongs to the learner: the shell reads their stored choice on
 * every mount, and only their own exit turns it off. The owner asked for one
 * addition — when a Reading or Listening attempt actually starts, the attempt
 * screen should be focused without the learner having to press anything. That is
 * this module's whole job, and it is deliberately narrow:
 *
 *   * only an attempt screen announces, so ordinary browsing never auto-enables
 *     Focus;
 *   * an announcement names the attempt and the path that produced it, so a
 *     stale signal can never reach a different screen;
 *   * the shell answers an announcement once per attempt, and a learner who
 *     exited Focus for that attempt is never re-entered forcibly — no loop.
 *
 * The signal is a module-level intent plus a subscription rather than a DOM
 * event, because a child route's effect runs before the shell layout's: a
 * subscriber that arrives late must still learn what was announced.
 */

export type FocusEntryIntent = {
  /** The attempt that opened, so the shell can remember one dismissal per attempt. */
  attemptId: string;
  /** The client path at announcement time; a stale intent is ignored elsewhere. */
  pathname: string;
};

type FocusEntryListener = (intent: FocusEntryIntent) => void;

const listeners = new Set<FocusEntryListener>();
let pendingIntent: FocusEntryIntent | null = null;

/** Announce that an attempt screen has opened. Called by the exam components. */
export function announceFocusEntry(attemptId: string): void {
  if (typeof window === "undefined" || !attemptId) return;
  const intent: FocusEntryIntent = { attemptId, pathname: window.location.pathname };
  // With no listener yet the intent waits for the shell's subscription; with a
  // listener the delivery is live and nothing needs to be kept.
  pendingIntent = listeners.size === 0 ? intent : null;
  for (const listener of listeners) listener(intent);
}

/** Subscribe the shell to attempt-open signals; returns an unsubscribe function. */
export function subscribeFocusEntry(listener: FocusEntryListener): () => void {
  listeners.add(listener);
  const replay = pendingIntent;
  pendingIntent = null;
  if (replay) listener(replay);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: forget any undelivered announcement. */
export function clearFocusEntry(): void {
  pendingIntent = null;
  listeners.clear();
}

/**
 * The hook an attempt screen calls once. It announces on mount and again only if
 * the attempt identity itself changes — never on a re-render, so it cannot
 * become a re-enable loop.
 */
export function useFocusEntry(attemptId: string): void {
  useEffect(() => {
    announceFocusEntry(attemptId);
  }, [attemptId]);
}
