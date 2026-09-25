/**
 * Speed Training — one central place that decides how fast a student may play a
 * recording, and when.
 *
 * Two ideas:
 *
 * 1. Playing a recording at 1.0× for ever does not build listening speed, so the
 *    rate ladder is offered as its own drill (1.0 → 2.0).
 * 2. It unlocks on evidence: the student has to reach ~80% on that test first.
 *    Below the threshold the panel is honest about the current percentage rather
 *    than offering a drill the student is not ready for.
 *
 * Nothing here is a score and nothing here is stored: the ratio is derived from
 * the student's own submitted attempts. The threshold lives in one constant so
 * a centre can change its mind in one place.
 */

export const SPEED_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/** Share of the test that unlocks Speed Training. */
export const SPEED_UNLOCK_RATIO = 0.8;

export type SpeedTrainingStatus = {
  unlocked: boolean;
  /** Best share of the test the student has reached, 0–1 (0 when never submitted). */
  bestRatio: number;
  /** The same number as a whole percentage, for honest display. */
  percent: number;
  /** The required ratio as a whole percentage. */
  thresholdPercent: number;
  /** True when the student has not submitted an attempt for this test yet. */
  notAttemptedYet: boolean;
};

/**
 * @param attempts this student's submitted attempts for one test: `[score, total]`
 */
export function speedTrainingStatus(attempts: { score: number | null; total: number | null }[]): SpeedTrainingStatus {
  const scored = attempts
    .filter((a) => typeof a.score === "number" && typeof a.total === "number" && (a.total ?? 0) > 0)
    .map((a) => (a.score as number) / (a.total as number));

  const bestRatio = scored.length ? Math.max(...scored) : 0;
  return {
    unlocked: bestRatio >= SPEED_UNLOCK_RATIO,
    bestRatio,
    percent: Math.round(bestRatio * 100),
    thresholdPercent: Math.round(SPEED_UNLOCK_RATIO * 100),
    notAttemptedYet: scored.length === 0,
  };
}

/**
 * Which media types can actually be slowed down.
 *
 * Rate control needs an `<audio>`/`<video>` element we own. An embedded player
 * (YouTube and friends) or an external link gives us no handle on playback rate,
 * so the drill is not offered there — the panel says so instead of showing
 * buttons that do nothing.
 */
export function supportsRateControl(audioType: "video" | "audio" | "file" | "link"): boolean {
  return audioType === "audio" || audioType === "file" || audioType === "video";
}
