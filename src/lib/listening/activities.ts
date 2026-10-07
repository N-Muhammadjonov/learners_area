import type { ListeningPackage, ListeningSourceActivityId } from "./package";

/**
 * THE LISTENING ACTIVITY REGISTRY — the single authority for the question
 * "does THIS test genuinely support THIS activity?".
 *
 * A test hub must show the activities that really belong to the test in front of the
 * learner, not a fixed grid of ten cards. That answer is never guessed from a display
 * title and never forced for symmetry: every entry below is derived from AUTHORED or
 * STRUCTURAL facts about the test itself —
 *
 *   • the content owner's own `studyPack.activities` declaration, when the source
 *     carries one (that list is the strongest authored fact, and it is also the order
 *     the owner chose);
 *   • otherwise the questions that genuinely exist (an MCQ question is one that has
 *     options and is NOT a matching question; a matching question says so; a completion
 *     question says so), the full transcript, the vocabulary, the recall points and the
 *     legacy keyword rows;
 *   • plus what is true about THIS LEARNER: "Retry Weak Areas" needs real missed
 *     questions from a submitted attempt, and review of a result needs a submitted
 *     attempt to review. A card that cannot do anything is not shown at all — a
 *     disabled card would be a lie dressed as symmetry.
 *
 * Everything here is pure: it reads a Listening package and, optionally, a small
 * learner context. No database, no React, so the hub pages, the API routes and the tests
 * all ask the same question and cannot drift.
 */

export type ListeningActivityId = ListeningSourceActivityId | "keyword1" | "keyword2";

/** The practice activities whose answers are graded as a practice run. */
export type PracticeKind = "matching" | "completion" | "retry" | "map";

/** What is true about the learner looking at the test right now. */
export type ListeningLearner = {
  /** This learner has a SUBMITTED attempt for this test, so there is a result to review. */
  examSubmitted: boolean;
  /** Questions this learner answered wrongly or left blank in that attempt. */
  missedQuestions: number;
};

/** The authored/structural facts a support decision is made from. */
export type ListeningActivityFacts = {
  /** This is a full test (the canonical package shape only describes full tests). */
  full: boolean;
  /** There is at least one genuine multiple-choice question (options, and not matching). */
  mcq: boolean;
  /** There is at least one map/plan question (answered from a plan's shared label pool). */
  map: boolean;
  /** There is at least one matching question. */
  matching: boolean;
  /** There is at least one form/note completion question. */
  completion: boolean;
  /**
   * A FULL transcript exists for the recording — authored script parts, or the section
   * transcripts themselves. This is what the hub reports to the learner; the transcript
   * is never fabricated from a handful of sentences.
   */
  transcript: boolean;
  /**
   * Script Completion is USABLE here: at least one authored script part carries both its
   * transcript and the strategic blanks to fill in. A transcript without authored blanks
   * is not a completion exercise, and this registry never presents one as if it were.
   */
  script: boolean;
  /** Canonical vocabulary exists for the test. */
  vocabulary: boolean;
  /** Retrieval points exist for the parts. */
  recall: boolean;
  /** Legacy keyword rows (the pre-studyPack practice). */
  keyword1: boolean;
  keyword2: boolean;
  /** The source declared its own activity list. */
  authored: ListeningActivityId[] | null;
  /** The authored practice kinds, which are also the practice routes' own precondition. */
  authoredKinds: ListeningActivityId[] | null;
};

/** One row of the registry. */
export type ListeningActivityDescriptor = {
  id: ListeningActivityId;
  /** The route segment under `/app/listening/tests/:id/` that runs the activity. */
  path: string;
  /** Practice activities are graded and stored as practice runs; the rest are study. */
  practice: PracticeKind | null;
  /** True when the activity only makes sense for a learner with a submitted attempt. */
  learnerGated: "submitted" | "weakness" | null;
  /** Does the TEST itself support this activity, ignoring the learner? */
  supported: (facts: ListeningActivityFacts) => boolean;
};

/**
 * UNKNOWN kind is treated as multiple choice (that is how the importer stores it), but a
 * MATCHING question is never an MCQ even though it carries an option pool — the single
 * most tempting mistake in this area.
 */
function isMcqQuestion(question: ListeningPackage["questions"][number]): boolean {
  return (
    question.options.length >= 2 &&
    question.kind !== "matching" &&
    question.kind !== "completion" &&
    // A MAP question carries a label pool too. Treating it as MCQ would both inflate the MCQ
    // mastery set with questions that are not multiple choice and hide the map activity the
    // source actually authored — the same mistake as filing Matching as MCQ.
    question.kind !== "map"
  );
}

/** Read the authored/structural facts once, so every predicate sees the same truth. */
export function activityFacts(p: ListeningPackage): ListeningActivityFacts {
  const questions = p.questions ?? [];
  const authored = p.studyPack?.activities ? (p.studyPack.activities as ListeningActivityId[]) : null;
  const scriptParts = p.studyPack?.scriptParts ?? [];
  const audited = p.studyPack?.activities ?? null;
  return {
    full: true,
    mcq: questions.some(isMcqQuestion),
    map: questions.some((question) => question.kind === "map"),
    matching: questions.some((question) => question.kind === "matching"),
    completion: questions.some((question) => question.kind === "completion"),
    transcript:
      scriptParts.some((part) => (part.transcript ?? "").trim().length > 0) ||
      (p.sections ?? []).some((section) => (section.transcript ?? "").trim().length > 0),
    script: scriptParts.some((part) => (part.transcript ?? "").trim().length > 0 && (part.gaps ?? []).length > 0),
    vocabulary: (p.vocabulary ?? []).length > 0,
    recall: (p.studyPack?.recall ?? []).length > 0,
    keyword1: (p.keyword1 ?? []).length > 0,
    keyword2: (p.keyword2 ?? []).length > 0,
    authored,
    authoredKinds: audited,
  };
}

/**
 * The registry, in the order a hub presents activities when the source did not author an
 * order: the exam first, then study and feedback, then the skill drills, then the
 * learner-specific retry.
 */
export const LISTENING_ACTIVITIES: readonly ListeningActivityDescriptor[] = [
  { id: "exam", path: "1", practice: null, learnerGated: null, supported: (facts) => facts.full },
  { id: "review", path: "2", practice: null, learnerGated: "submitted", supported: (facts) => facts.full },
  {
    id: "script",
    path: "3",
    practice: null,
    learnerGated: null,
    // Script Completion blanks AUTHORED items across the full transcript. A recording with
    // a transcript but no authored blanks is not this exercise and is never dressed as one.
    supported: (facts) => facts.script,
  },
  {
    id: "keyword1",
    // Activity 3 is the decoding surface: it renders Script Completion when the authored
    // blanks exist, and the authored keyword drill otherwise. So the keyword card appears
    // exactly when the script exercise does not — never both, never neither when content exists.
    supported: (facts) => facts.keyword1 && !facts.script,
    path: "3",
    practice: null,
    learnerGated: null,
  },
  { id: "recall", path: "4", practice: null, learnerGated: null, supported: (facts) => facts.recall },
  // The same rule for activity 4: retrieval notes when they are authored, otherwise the
  // second keyword drill.
  { id: "keyword2", path: "4", practice: null, learnerGated: null, supported: (facts) => facts.keyword2 && !facts.recall },
  { id: "vocab", path: "5", practice: null, learnerGated: null, supported: (facts) => facts.vocabulary },
  { id: "mcq", path: "mcq", practice: null, learnerGated: null, supported: (facts) => facts.mcq },
  // The graded practice screens demand more than a question shape: their route only runs a
  // kind the source AUTHORED into its study pack, so the card is offered only then.
  { id: "matching", path: "matching", practice: "matching", learnerGated: null, supported: (facts) => facts.matching && authoredKind(facts, "matching") },
  { id: "completion", path: "completion", practice: "completion", learnerGated: null, supported: (facts) => facts.completion && authoredKind(facts, "completion") },
  // Map / Plan Mastery: offered when the test genuinely contains map/plan questions AND the
  // source declared the activity — the same precondition its route asks, so the card and the
  // route can never disagree.
  { id: "map", path: "map", practice: "map", learnerGated: null, supported: (facts) => facts.map && authoredKind(facts, "map") },
  {
    id: "retry",
    path: "retry",
    practice: "retry",
    learnerGated: "weakness",
    // Retry drills the questions the learner really missed, so it needs both authorship and
    // a learner with something to retry (see `learnerAllows`).
    supported: (facts) => authoredKind(facts, "retry"),
  },
];

/** Was this practice kind authored into the source's own activity list? */
function authoredKind(facts: ListeningActivityFacts, kind: ListeningActivityId): boolean {
  return (facts.authoredKinds ?? []).includes(kind);
}

const BY_ID = new Map(LISTENING_ACTIVITIES.map((activity) => [activity.id, activity]));

/** The route segment under `/app/listening/tests/:id/`, for callers that link. */
export const activityPath: Record<string, string> = Object.fromEntries(
  LISTENING_ACTIVITIES.map((activity) => [activity.id, activity.path]),
);

/** The part of a full test whose plan/map this package's single `mapDiagram` belongs to. */
export const HISTORICAL_MAP_PART = 2;

/**
 * WHICH PARTS RENDER THE `mapDiagram`.
 *
 * The package carries ONE plan/map drawing, and the parts that need it are the parts that actually
 * contain map/plan questions — read from the questions themselves, so a test whose plan sits in a
 * different part, or in more than one, renders it in the right place without a hard-coded part
 * number.
 *
 * A package that predates the `map` kind declares its map questions as `mcq` (the old importer had
 * only three kinds), so deriving strictly from `kind` would make the plan vanish from tests that
 * have been showing it all along. That is why an empty answer falls back to the historical
 * placement — Part 2 — which is where such a package's plan has always been rendered. The fallback
 * is named, not inlined, so it is visible and testable rather than a magic number.
 */
export function mapDiagramSections(p: ListeningPackage): number[] {
  const sections = [...new Set((p.questions ?? []).filter((question) => question.kind === "map").map((question) => question.section))].sort(
    (a, b) => a - b,
  );
  return sections.length ? sections : [HISTORICAL_MAP_PART];
}

/** The registry row for an activity id, or null when the id is not an activity. */
export function activityDescriptor(id: string): ListeningActivityDescriptor | null {
  return BY_ID.get(id as ListeningActivityId) ?? null;
}

/** Does this TEST support this activity, ignoring who is looking? */
export function supportsActivity(p: ListeningPackage, id: string): boolean {
  const descriptor = activityDescriptor(id);
  if (!descriptor) return false;
  return descriptor.supported(activityFacts(p));
}

/** Is the learner-specific precondition of this activity satisfied? */
function learnerAllows(descriptor: ListeningActivityDescriptor, learner: ListeningLearner | undefined): boolean {
  if (descriptor.learnerGated === "submitted") return Boolean(learner?.examSubmitted);
  if (descriptor.learnerGated === "weakness") return (learner?.missedQuestions ?? 0) > 0;
  return true;
}

/**
 * WHAT THE TEST ITSELF SUPPORTS, with no learner in the picture.
 *
 * This is the staff question — the import preview asks it before a test exists and before
 * anybody could have a result to review — and it is why review and retry are absent here:
 * a preview has no learner, so a card nobody could use is not offered. A LEARNER surface
 * must call `packageActivities(payload, learner)` instead; the test suite guards that.
 */
export function testActivities(p: ListeningPackage): ListeningActivityId[] {
  const facts = activityFacts(p);
  const allowed = (id: ListeningActivityId) => {
    const descriptor = BY_ID.get(id);
    return Boolean(descriptor) && descriptor!.supported(facts) && learnerAllows(descriptor!, undefined);
  };
  return activityList(p, facts, allowed);
}

/**
 * THE ACTIVITY LIST OF A TEST FOR ONE LEARNER.
 *
 * With a learner context this is exactly what a hub may show: activities that need a
 * submitted attempt — review of a result, retry of real weakness — appear only when they
 * really exist for that person.
 */
export function packageActivities(p: ListeningPackage, learner?: ListeningLearner): ListeningActivityId[] {
  const facts = activityFacts(p);
  const allowed = (id: ListeningActivityId) => {
    const descriptor = BY_ID.get(id);
    return Boolean(descriptor) && descriptor!.supported(facts) && learnerAllows(descriptor!, learner);
  };
  return activityList(p, facts, allowed);
}

/** The one ordering rule, shared by both questions above. */
function activityList(
  p: ListeningPackage,
  facts: ListeningActivityFacts,
  allowed: (id: ListeningActivityId) => boolean,
): ListeningActivityId[] {
  void p;
  // The source's own declaration is the strongest authored fact, and it is also the order
  // the owner chose — filtered, so a declared activity whose content does not exist (an
  // activity with no transcript, say) never becomes an empty card.
  if (facts.authored) return facts.authored.filter(allowed);
  // Otherwise the registry's own order. A legacy recording falls out of it naturally as
  // exam → review → keywords → vocabulary, because its other activities have no facts.
  return LISTENING_ACTIVITIES.map((activity) => activity.id).filter(allowed);
}

/** The practice kind an activity runs as, when it is a graded practice activity. */
export function practiceKindOf(id: string): PracticeKind | null {
  return activityDescriptor(id)?.practice ?? null;
}
