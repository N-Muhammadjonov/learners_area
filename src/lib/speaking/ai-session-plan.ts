import { groupByTopic, type BrowsablePrompt, type PracticePart, type TopicGroup } from "./practice-browse";

/**
 * Practice with AI — the randomized examiner plan.
 *
 * This is the session-level successor to `buildExaminerScript()` in
 * ./ai-session.ts. That function picked ONE topic per part and took the first
 * N rows in bank order, so every session opened with the same questions. This
 * module keeps the same canonical source (nothing here invents a prompt) but
 * makes the selection genuinely random *and* examiner-like:
 *
 *   - a topic is a CLUSTER: the examiner stays on it for 3–6 questions before
 *     moving on, never alternating topic-per-question;
 *   - clusters are contiguous in the plan, so "Question 2 of 4" really is the
 *     second question on that topic;
 *   - the whole plan is derived from a persisted integer seed, so a session can
 *     be rebuilt byte-for-byte after a refresh instead of being reshuffled.
 *
 * Honesty rule carried over from the bank: if a topic has fewer published
 * questions than the cluster minimum, the plan uses the real count and records
 * a `limitation`. Questions are never invented to pad a cluster.
 */

/** Bump when the plan shape or selection rules change; persisted per session. */
export const SESSION_PLAN_VERSION = 1;

/** Product rule (§9): MIN 3 / DEFAULT 4 / MAX 6 questions per chosen topic. */
export const TOPIC_CLUSTER_MIN = 3;
export const TOPIC_CLUSTER_DEFAULT = 4;
export const TOPIC_CLUSTER_MAX = 6;

/**
 * Per-part ceiling inside the global 3–6 rule. A real examiner asks 3–4 short
 * Part 1 questions on a topic and 3–6 deeper Part 3 questions (§10), so Part 1
 * clusters stop at 4 while Part 3 may run to the global maximum of 6.
 */
const PART_CLUSTER_MAX: Record<"part1" | "part3", number> = { part1: 4, part3: 6 };

export type SessionPlanMode = "full" | PracticePart;
export const SESSION_PLAN_MODES: readonly SessionPlanMode[] = ["full", "part1", "part2", "part3"];

export type Rng = () => number;

/**
 * Deterministic PRNG (mulberry32). A session persists its seed, so the plan can
 * be reproduced exactly — which is what makes "refresh must not reshuffle the
 * active session" a structural guarantee rather than a UI convention.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh seed for a NEW session. Never reused for an existing one. */
export function randomSessionSeed(): number {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoRef.getRandomValues(buf);
    return buf[0]! >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function isSessionPlanMode(value: unknown): value is SessionPlanMode {
  return typeof value === "string" && (SESSION_PLAN_MODES as readonly string[]).includes(value);
}

export type SessionPlanItem = {
  /** 0-based position in the session; the cursor points at one of these. */
  ordinal: number;
  /** Canonical `speaking_prompts.id`. The plan never copies prompt text. */
  promptId: string;
  part: PracticePart;
  topicKey: string;
  topicTitle: string | null;
  /** 0-based index of this topic cluster within the whole plan. */
  topicPosition: number;
  /** 1-based position inside its own cluster ("Question 2 of 4"). */
  questionPosition: number;
  /** Total questions in this cluster, so the UI can render "of 4". */
  clusterSize: number;
  /** Part 2 contributes exactly one cue card. */
  isCueCard: boolean;
};

export type SessionPlanTopic = {
  topicPosition: number;
  part: PracticePart;
  topicKey: string;
  topicTitle: string | null;
  size: number;
  startOrdinal: number;
};

/**
 * A topic that could not reach the cluster minimum from published rows. Kept so
 * the product can say "this topic only has 2 published questions" instead of
 * silently padding or silently dropping the topic.
 */
export type SessionPlanLimitation = {
  part: PracticePart;
  topicKey: string;
  topicTitle: string | null;
  requested: number;
  available: number;
};

export type SessionPlan = {
  planVersion: number;
  mode: SessionPlanMode;
  seed: number;
  items: SessionPlanItem[];
  topics: SessionPlanTopic[];
  limitations: SessionPlanLimitation[];
};

export type BuildSessionPlanOptions = {
  mode: SessionPlanMode;
  seed: number;
  /**
   * Prompt ids used in this learner's recent Practice-with-AI sessions. They are
   * DE-PRIORITIZED, never banned: a small bank must still produce a full
   * session rather than an empty one (§33).
   */
  recentPromptIds?: ReadonlySet<string>;
};

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * How many questions to ask on one topic.
 *
 * Returns the real available count when the bank is smaller than the minimum
 * (never invents rows), otherwise a weighted draw over [MIN..min(max, available)]
 * with the DEFAULT (4) twice as likely as the extremes.
 */
export function boundedQuestionCount(available: number, max: number, rng: Rng): number {
  if (available <= 0) return 0;
  if (available <= TOPIC_CLUSTER_MIN) return available;
  const ceiling = Math.min(max, available, TOPIC_CLUSTER_MAX);
  if (ceiling <= TOPIC_CLUSTER_MIN) return TOPIC_CLUSTER_MIN;

  const weights: number[] = [];
  for (let n = TOPIC_CLUSTER_MIN; n <= ceiling; n += 1) {
    weights.push(n === TOPIC_CLUSTER_DEFAULT ? 2 : 1);
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return TOPIC_CLUSTER_MIN + i;
  }
  return ceiling;
}

/**
 * Picks `count` unique prompts from one topic, fresh ones first.
 *
 * "Fresh" means not in the learner's recent-history set. When the fresh pool is
 * too small the remainder is topped up from recently-used prompts, so avoidance
 * can never empty a session (§33).
 */
function chooseFromTopic<P extends BrowsablePrompt>(
  group: TopicGroup<P>,
  count: number,
  recent: ReadonlySet<string>,
  rng: Rng,
): P[] {
  const fresh: P[] = [];
  const stale: P[] = [];
  for (const prompt of group.prompts) (recent.has(prompt.id) ? stale : fresh).push(prompt);
  const chosen = shuffle(fresh, rng).slice(0, count);
  if (chosen.length < count) chosen.push(...shuffle(stale, rng).slice(0, count - chosen.length));
  return chosen;
}

/**
 * Orders topic groups so the ones with the most unused material come first, but
 * still randomly: two groups with equal freshness are shuffled rather than
 * always resolved in bank order. This is what makes consecutive sessions differ.
 */
function orderTopics<P extends BrowsablePrompt>(
  groups: readonly TopicGroup<P>[],
  recent: ReadonlySet<string>,
  rng: Rng,
): TopicGroup<P>[] {
  const freshCount = (g: TopicGroup<P>) => g.prompts.filter((p) => !recent.has(p.id)).length;
  return shuffle(groups, rng).sort((a, b) => freshCount(b) - freshCount(a));
}

function appendCluster<P extends BrowsablePrompt>(params: {
  plan: SessionPlanItem[];
  topics: SessionPlanTopic[];
  limitations: SessionPlanLimitation[];
  group: TopicGroup<P>;
  part: PracticePart;
  prompts: readonly P[];
  isCueCard: boolean;
}): void {
  const { plan, topics, limitations, group, part, prompts, isCueCard } = params;
  const topicPosition = topics.length;
  const startOrdinal = plan.length;
  const clusterSize = prompts.length;

  if (!isCueCard && clusterSize > 0 && clusterSize < TOPIC_CLUSTER_MIN) {
    limitations.push({
      part,
      topicKey: group.key,
      topicTitle: group.title,
      requested: TOPIC_CLUSTER_MIN,
      available: clusterSize,
    });
  }

  prompts.forEach((prompt, i) => {
    plan.push({
      ordinal: startOrdinal + i,
      promptId: prompt.id,
      part,
      topicKey: group.key,
      topicTitle: group.title,
      topicPosition,
      questionPosition: i + 1,
      clusterSize,
      isCueCard,
    });
  });

  topics.push({ topicPosition, part, topicKey: group.key, topicTitle: group.title, size: clusterSize, startOrdinal });
}

/**
 * Builds the immutable plan for one session.
 *
 * PURE: same prompts + same mode + same seed + same recent set ⇒ same plan.
 * That is the property the persistence layer relies on, and the property the
 * randomization tests assert.
 */
export function buildSessionPlan<P extends BrowsablePrompt>(
  prompts: readonly P[],
  options: BuildSessionPlanOptions,
): SessionPlan {
  const rng = mulberry32(options.seed);
  const recent = options.recentPromptIds ?? new Set<string>();
  const plan: SessionPlanItem[] = [];
  const topics: SessionPlanTopic[] = [];
  const limitations: SessionPlanLimitation[] = [];
  const mode = options.mode;

  const wantsPart1 = mode === "full" || mode === "part1";
  const wantsPart2 = mode === "full" || mode === "part2";
  const wantsPart3 = mode === "full" || mode === "part3";

  // --- Part 1: one or two topic clusters ---------------------------------
  if (wantsPart1) {
    const groups = orderTopics(groupByTopic(prompts, "part1"), recent, rng).filter((g) => g.prompts.length > 0);
    if (groups.length > 0) {
      // A full interview usually covers two familiar topics; a Part-1-only
      // session may too. Never more than the bank can actually supply.
      const clusterCount = groups.length >= 2 && rng() < 0.5 ? 2 : 1;
      for (const group of groups.slice(0, clusterCount)) {
        const count = boundedQuestionCount(group.prompts.length, PART_CLUSTER_MAX.part1, rng);
        appendCluster({ plan, topics, limitations, group, part: "part1", prompts: chooseFromTopic(group, count, recent, rng), isCueCard: false });
      }
    }
  }

  // --- Part 2: exactly one cue card ---------------------------------------
  let cueTopicKey: string | null = null;
  if (wantsPart2) {
    const groups = orderTopics(groupByTopic(prompts, "part2"), recent, rng).filter((g) => g.prompts.length > 0);
    if (groups.length > 0) {
      const group = groups[0]!;
      const cue = chooseFromTopic(group, 1, recent, rng)[0];
      if (cue) {
        cueTopicKey = group.key;
        appendCluster({ plan, topics, limitations, group, part: "part2", prompts: [cue], isCueCard: true });
      }
    }
  }

  // --- Part 3: one discussion cluster, preferring the Part 2 topic --------
  if (wantsPart3) {
    const groups = orderTopics(groupByTopic(prompts, "part3"), recent, rng).filter((g) => g.prompts.length > 0);
    if (groups.length > 0) {
      // Canonical connection first: the same topic key as the cue card. Only if
      // the bank has no such Part 3 topic does the plan fall back to a random
      // one — it never invents a "related" topic from thin air.
      const matching = cueTopicKey ? groups.find((g) => g.key === cueTopicKey) : undefined;
      const group = matching ?? groups[0]!;
      const count = boundedQuestionCount(group.prompts.length, PART_CLUSTER_MAX.part3, rng);
      appendCluster({ plan, topics, limitations, group, part: "part3", prompts: chooseFromTopic(group, count, recent, rng), isCueCard: false });
    }
  }

  return { planVersion: SESSION_PLAN_VERSION, mode, seed: options.seed, items: plan, topics, limitations };
}

/**
 * True when every topic cluster occupies one unbroken run of ordinals.
 *
 * This is the anti-chaos assertion: it fails if the plan ever interleaves
 * topics (Work, Food, Work, Travel) instead of exhausting a cluster first.
 */
export function planTopicsAreContiguous(plan: SessionPlan): boolean {
  const topicByOrdinal = new Map<number, number>();
  const spans = new Map<number, { first: number; last: number }>();

  for (const item of plan.items) {
    topicByOrdinal.set(item.ordinal, item.topicPosition);
    const span = spans.get(item.topicPosition);
    if (!span) spans.set(item.topicPosition, { first: item.ordinal, last: item.ordinal });
    else {
      span.first = Math.min(span.first, item.ordinal);
      span.last = Math.max(span.last, item.ordinal);
    }
  }

  for (const [topicPosition, { first, last }] of spans) {
    for (let ordinal = first; ordinal <= last; ordinal += 1) {
      if (topicByOrdinal.get(ordinal) !== topicPosition) return false;
    }
  }
  return true;
}

/** The topic cluster an ordinal belongs to, or null past the end of the plan. */
export function topicAt(plan: SessionPlan, ordinal: number): SessionPlanTopic | null {
  const item = plan.items[ordinal];
  if (!item) return null;
  return plan.topics.find((t) => t.topicPosition === item.topicPosition) ?? null;
}

/** True when `ordinal` is the last question of its topic cluster. */
export function isEndOfTopicCluster(plan: SessionPlan, ordinal: number): boolean {
  const item = plan.items[ordinal];
  if (!item) return false;
  return item.questionPosition >= item.clusterSize;
}

/**
 * Rebuilds a plan from persisted rows.
 *
 * The stored items ARE the plan — this only re-derives the cluster/topic view
 * so a resumed session renders identically to a fresh one. No random call is
 * made here, which is why a refresh cannot reshuffle an active session.
 */
export function planFromPersistedItems(params: {
  mode: SessionPlanMode;
  seed: number;
  planVersion: number;
  items: readonly {
    ordinal: number;
    promptId: string | null;
    part: string;
    topicKey: string;
    topicTitle: string | null;
    topicPosition: number;
    questionPosition: number;
    clusterSize: number;
    isCueCard: boolean;
  }[];
  limitations?: readonly SessionPlanLimitation[];
}): SessionPlan {
  const items: SessionPlanItem[] = [...params.items]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((item): item is typeof item & { promptId: string } => Boolean(item.promptId))
    .map((item) => ({
      ordinal: item.ordinal,
      promptId: item.promptId,
      part: item.part as PracticePart,
      topicKey: item.topicKey,
      topicTitle: item.topicTitle,
      topicPosition: item.topicPosition,
      questionPosition: item.questionPosition,
      clusterSize: item.clusterSize,
      isCueCard: item.isCueCard,
    }));

  const topics: SessionPlanTopic[] = [];
  for (const item of items) {
    const existing = topics.find((t) => t.topicPosition === item.topicPosition);
    if (existing) existing.size = Math.max(existing.size, item.questionPosition);
    else topics.push({
      topicPosition: item.topicPosition,
      part: item.part,
      topicKey: item.topicKey,
      topicTitle: item.topicTitle,
      size: item.clusterSize,
      startOrdinal: item.ordinal,
    });
  }
  topics.sort((a, b) => a.topicPosition - b.topicPosition);

  return {
    planVersion: params.planVersion,
    mode: params.mode,
    seed: params.seed,
    items,
    topics,
    limitations: [...(params.limitations ?? [])],
  };
}
