/**
 * When a live class may actually be joined.
 *
 * Attendance is a record of a student being in the room, so it may only be
 * written while the room is open. The window opens a quarter of an hour before
 * the scheduled start (teachers are usually early) or as soon as the teacher
 * puts the class live, and closes half an hour after it should have finished.
 * A cancelled class never opens; a finished one is watched through its recording.
 */

export const JOIN_OPENS_BEFORE_MS = 15 * 60 * 1000;
export const JOIN_CLOSES_AFTER_MS = 30 * 60 * 1000;

export type JoinState = "open" | "too_early" | "closed" | "cancelled";

export type LiveClassTiming = {
  status: "upcoming" | "live" | "completed" | "recorded" | "cancelled";
  scheduledAt: Date;
  durationMinutes: number;
};

export function joinState(liveClass: LiveClassTiming, now: Date): JoinState {
  if (liveClass.status === "cancelled") return "cancelled";
  if (liveClass.status === "live") return "open";

  const start = liveClass.scheduledAt.getTime();
  const end = start + liveClass.durationMinutes * 60 * 1000;

  if (now.getTime() < start - JOIN_OPENS_BEFORE_MS) return "too_early";
  if (now.getTime() > end + JOIN_CLOSES_AFTER_MS) return "closed";
  return "open";
}

/** The moment the room opens, for the "opens at …" copy. */
export function opensAt(liveClass: LiveClassTiming): Date {
  return new Date(liveClass.scheduledAt.getTime() - JOIN_OPENS_BEFORE_MS);
}
