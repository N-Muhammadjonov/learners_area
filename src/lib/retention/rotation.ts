/**
 * Rotation — the rule that stops a learner seeing the same text twice while they
 * still have unseen ones.
 *
 * The definition (owner contract §96) is exact: within the learner's CURRENT
 * cycle for a level, a `retention_text` identity is not assigned again while
 * another active unseen text exists. When every active text has been used, a NEW
 * cycle starts and everything becomes eligible again — this is not a permanent
 * blacklist, and the cycle is durable server state, never localStorage.
 *
 * Identity is the retention_text id, not the version id. If the owner edits the
 * scoring structure and creates v2 of a text the learner already did this cycle,
 * the learner does NOT get that same logical text again — the next assignment
 * simply uses the newest active version.
 *
 * Selection is genuinely random over the eligible set (a bounded shuffle, which
 * the bank size of 15–100+ makes cheap). `random` is injectable so tests are
 * deterministic while production stays random.
 */

export type RotationCandidate = {
  textId: string;
  versionId: string;
};

export type RotationInput = {
  /** Every ACTIVE text for the level, with its current version. Never empty. */
  candidates: RotationCandidate[];
  /** Text ids the learner has already finished in the CURRENT cycle. */
  completedTextIds: readonly string[];
  /** The learner's current cycle number for this level. */
  cycleNumber: number;
  /** The text the learner finished most recently, for the no-repeat guard. */
  lastCompletedTextId: string | null;
  /** `[0, 1)` source of randomness. */
  random: () => number;
};

export type RotationDecision = {
  textId: string;
  versionId: string;
  /** The cycle this assignment belongs to (incremented when one is exhausted). */
  cycleNumber: number;
  /** True when the previous cycle was exhausted and a new one started. */
  startedNewCycle: boolean;
  /** How many texts were eligible before the random pick. */
  eligibleCount: number;
};

/** Fisher–Yates over a copy; never mutates the caller's array. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const bounded = swap >= 0 && swap <= index ? swap : 0;
    [out[index], out[bounded]] = [out[bounded]!, out[index]!];
  }
  return out;
}

function pick<T>(items: readonly T[], random: () => number): T {
  const ordered = shuffled(items, random);
  return ordered[0]!;
}

/**
 * Choose the next text. Returns `null` only when there is nothing to assign —
 * the caller turns that into the localized `retention_no_content` state rather
 * than borrowing a passage from another level.
 */
export function selectNextText(input: RotationInput): RotationDecision | null {
  if (input.candidates.length === 0) return null;

  const completed = new Set(input.completedTextIds);
  const unseen = input.candidates.filter((candidate) => !completed.has(candidate.textId));

  if (unseen.length > 0) {
    const chosen = pick(unseen, input.random);
    return {
      textId: chosen.textId,
      versionId: chosen.versionId,
      cycleNumber: input.cycleNumber,
      startedNewCycle: false,
      eligibleCount: unseen.length,
    };
  }

  // Cycle exhausted: begin the next one. Every active text is eligible again,
  // except that a learner with more than one text must not receive the text they
  // just finished back-to-back.
  const startCycle = input.cycleNumber + 1;
  const pool =
    input.candidates.length > 1 && input.lastCompletedTextId
      ? input.candidates.filter((candidate) => candidate.textId !== input.lastCompletedTextId)
      : input.candidates;
  const choosable = pool.length > 0 ? pool : input.candidates;
  const chosen = pick(choosable, input.random);
  return {
    textId: chosen.textId,
    versionId: chosen.versionId,
    cycleNumber: startCycle,
    startedNewCycle: true,
    eligibleCount: choosable.length,
  };
}

/**
 * The production randomness source: the platform CSPRNG, bounded to `[0, 1)`.
 * Injectable in tests so a rotation assertion never depends on luck.
 */
export function defaultRandom(): number {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoLike.getRandomValues(buffer);
    return buffer[0]! / 2 ** 32;
  }
  return Math.random();
}
