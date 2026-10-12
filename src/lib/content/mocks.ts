import { and, asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { contentVersions, mockAttempts, mockSections, mockTests, type MockAttemptSnapshot } from "@/db/schema";
import {
  bandFor,
  overallMockBand,
  mockTimingPolicy,
  readingPolicyFor,
  scorePolicy,
  sectionSecondsFor,
  type ScorePolicyId,
} from "./score-policy";
import { isKnownContentType, isUnspecifiedTrack, referenceProblems, type Track } from "./taxonomy";
import { versionById, type VersionReader } from "./versions";

/**
 * Mock composition.
 *
 * A mock is an ORCHESTRATION OBJECT: it holds references to canonical content at
 * pinned versions, plus the assessment policy that used to be implicit in React.
 * Nothing is copied, so editing a Listening test cannot leave a stale duplicate
 * inside a mock, and the mock that a learner sat stays reconstructible forever.
 *
 * Everything in this file except the two persistence functions is pure, so the
 * compatibility rules can be unit-tested and reused by the composer UI without a
 * database.
 */

export type MockKind = "full" | "sectional" | "diagnostic" | "custom";
export const MOCK_KINDS: MockKind[] = ["full", "sectional", "diagnostic", "custom"];

export type MockSectionInput = {
  skill: string;
  module: string;
  contentType: string;
  sourceRef: string;
  /** Pinned revision. Required for formal compositions. */
  contentVersionId?: string | null;
  label?: string | null;
  questionCount?: number | null;
  seconds?: number | null;
  optional?: boolean;
};

export type MockCompositionInput = {
  track: Track;
  kind: MockKind;
  title: string;
  timingPolicyId?: string | null;
  /** A partial override ON TOP of the kind's default policy; the default is not implicit. */
  navigation?: Partial<MockNavigationPolicy> | null;
  sections: MockSectionInput[];
};

export type MockCompositionIssue = {
  code: string;
  message: string;
  /** Which section the problem belongs to, when it belongs to one. */
  position?: number;
};

export type MockCompositionReport = {
  ok: boolean;
  errors: MockCompositionIssue[];
  warnings: MockCompositionIssue[];
  /** Total timed seconds across non-optional sections. */
  totalSeconds: number;
  /** Skill → question count, for the §63 formal-rule checks. */
  questionCounts: Record<string, number>;
};

/* -------------------------------------------------------------------------- */
/* Navigation policy (§16)                                                    */
/* -------------------------------------------------------------------------- */

export type MockNavigationPolicy = {
  canReturnToPreviousSection: boolean;
  canPause: boolean;
  canResume: boolean;
  autoSubmitOnExpiry: boolean;
  breakAllowed: boolean;
  reviewBeforeSubmit: boolean;
  sectionLocks: boolean;
};

/**
 * The defaults are the FORMAL EXAM default: no going back once a section closed,
 * no pausing, auto-submit when the clock runs out. A sectional practice mock may
 * relax them, but that is a decision recorded on the mock, not a behaviour that
 * happens to fall out of which component rendered it.
 */
export const FORMAL_NAVIGATION: MockNavigationPolicy = {
  canReturnToPreviousSection: false,
  canPause: false,
  canResume: true,
  autoSubmitOnExpiry: true,
  breakAllowed: false,
  reviewBeforeSubmit: false,
  sectionLocks: true,
};

export const PRACTICE_NAVIGATION: MockNavigationPolicy = {
  canReturnToPreviousSection: true,
  canPause: true,
  canResume: true,
  autoSubmitOnExpiry: false,
  breakAllowed: true,
  reviewBeforeSubmit: true,
  sectionLocks: false,
};

export function navigationPolicyFor(kind: MockKind, override?: Partial<MockNavigationPolicy> | null): MockNavigationPolicy {
  const base = kind === "full" || kind === "diagnostic" ? FORMAL_NAVIGATION : PRACTICE_NAVIGATION;
  return { ...base, ...(override ?? {}) };
}

export function navigationPolicyIssues(kind: MockKind, policy: MockNavigationPolicy): MockCompositionIssue[] {
  const issues: MockCompositionIssue[] = [];
  if (kind === "full" || kind === "diagnostic") {
    if (policy.canPause) issues.push({ code: "formal_cannot_pause", message: "A formal mock cannot be paused, because the exam clock is server-authoritative." });
    if (!policy.autoSubmitOnExpiry)
      issues.push({ code: "formal_requires_autosubmit", message: "A formal mock must submit itself when the section clock expires." });
    if (policy.canReturnToPreviousSection && policy.sectionLocks)
      issues.push({
        code: "contradictory_navigation",
        message: "A mock cannot both lock finished sections and allow returning to them.",
      });
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Composition validation (§63)                                               */
/* -------------------------------------------------------------------------- */

/** IELTS formal rules, expressed as data so the composer and the API agree. */
const FORMAL_QUESTION_COUNTS: Record<string, number> = { listening: 40, reading: 40 };

const SECTION_ORDER: Record<string, number> = { listening: 0, reading: 1, writing: 2, speaking: 3 };

const FORMAL_TRACK_RULES = {
  academic: { listening: "academic", reading: "academic", writingTask1: "task1" },
  general_training: { listening: "general_training", reading: "general_training", writingTask1: "task1" },
} as const;

/**
 * Validate a composition BEFORE it can be published (§63).
 *
 * The rules, explicitly:
 *  1. every section references a known content type of a known module;
 *  2. `skill` and `module` agree (a Writing section cannot point at Reading);
 *  3. a formal composition pins an exact content version;
 *  4. a full mock has Listening + Reading + Writing, in that order, and nothing twice;
 *  5. an Academic mock never contains General Training material and vice versa;
 *  6. a full mock's Listening and Reading sections must add up to the formal count;
 *  7. the timing policy exists, and every section can be given a duration.
 */
export function validateMockComposition(input: MockCompositionInput): MockCompositionReport {
  const errors: MockCompositionIssue[] = [];
  const warnings: MockCompositionIssue[] = [];
  const formal = input.kind === "full" || input.kind === "diagnostic";

  if (!input.title.trim()) errors.push({ code: "missing_title", message: "A mock needs a title." });
  if (!MOCK_KINDS.includes(input.kind)) errors.push({ code: "unknown_kind", message: `Unknown mock kind "${input.kind}".` });
  if (!input.sections.length) errors.push({ code: "no_sections", message: "A mock needs at least one section." });

  const timing = input.timingPolicyId ? mockTimingPolicy(input.timingPolicyId) : null;
  if (input.timingPolicyId && !timing)
    errors.push({ code: "unknown_timing_policy", message: `Unknown timing policy "${input.timingPolicyId}".` });
  if (formal && !timing) errors.push({ code: "timing_policy_required", message: "A formal mock must declare a timing policy." });

  const navigation = navigationPolicyFor(input.kind, input.navigation);
  errors.push(...navigationPolicyIssues(input.kind, navigation));

  const seen = new Map<string, number>();
  const questionCounts: Record<string, number> = {};
  let totalSeconds = 0;

  input.sections.forEach((section, index) => {
    const position = index + 1;
    const at = { position };
    if (section.skill !== section.module)
      errors.push({
        ...at,
        code: "skill_module_mismatch",
        message: `Section ${position}: skill "${section.skill}" cannot be a ${section.module} section.`,
      });
    if (!isKnownContentType(section.module, section.contentType))
      errors.push({
        ...at,
        code: "unknown_content_type",
        message: `Section ${position}: ${section.module} has no content type "${section.contentType}".`,
      });
    if (!section.sourceRef.trim())
      errors.push({ ...at, code: "missing_source_ref", message: `Section ${position}: the reference has no source identity.` });

    const key = `${section.skill}:${section.sourceRef}`;
    if (seen.has(key))
      errors.push({
        ...at,
        code: "duplicate_section",
        message: `Section ${position}: "${section.sourceRef}" already appears at position ${seen.get(key)}.`,
      });
    seen.set(key, position);

    if (formal && !section.contentVersionId)
      errors.push({
        ...at,
        code: "version_required",
        message: `Section ${position}: a formal mock must pin the exact content version it will grade against.`,
      });
    if (formal && section.optional)
      errors.push({ ...at, code: "optional_in_formal_mock", message: `Section ${position}: a formal mock has no optional sections.` });

    const problem = referenceProblems(
      { module: section.module, contentType: section.contentType, sourceRef: section.sourceRef, track: input.track, versionId: section.contentVersionId ?? null },
      // `requireVersion` is checked above with a message that names the section's
      // own problem, so the generic copy is not repeated here.
      { track: input.track },
    );
    for (const entry of problem) errors.push({ ...at, code: entry.code, message: `Section ${position}: ${entry.message}` });

    const seconds = section.seconds ?? (timing ? sectionSecondsFor(timing, section.skill) : null);
    if (formal && !seconds) errors.push({ ...at, code: "missing_duration", message: `Section ${position}: no duration could be resolved.` });
    if (!section.optional && seconds) totalSeconds += seconds;

    if (typeof section.questionCount === "number" && section.questionCount > 0)
      questionCounts[section.skill] = (questionCounts[section.skill] ?? 0) + section.questionCount;
  });

  if (formal) {
    const skills = input.sections.map((section) => section.skill);
    for (const required of ["listening", "reading", "writing"])
      if (!skills.includes(required))
        errors.push({ code: "missing_required_skill", message: `A full mock needs a ${required} section.` });
    for (const skill of skills) if (!["listening", "reading", "writing", "speaking"].includes(skill))
      errors.push({ code: "unknown_skill", message: `Unknown skill "${skill}".` });
    // Order: Listening → Reading → Writing → (Speaking).
    const ordered = [...skills].sort((a, b) => (SECTION_ORDER[a] ?? 99) - (SECTION_ORDER[b] ?? 99));
    if (ordered.join(",") !== skills.join(","))
      errors.push({ code: "wrong_section_order", message: "A full mock runs Listening, then Reading, then Writing, then Speaking." });
    // Track: the reading and listening material must match the mock's track.
    for (const section of input.sections) {
      const track = (section as MockSectionInput & { track?: string | null }).track;
      if (track && !isUnspecifiedTrack(input.track) && !isUnspecifiedTrack(track as Track) && track !== input.track)
        errors.push({
          code: "track_mismatch",
          message: `${section.skill} "${section.sourceRef}" is ${track} material but this is a ${input.track} mock.`,
        });
    }
    for (const [skill, expected] of Object.entries(FORMAL_QUESTION_COUNTS))
      if (questionCounts[skill] !== undefined && questionCounts[skill] !== expected)
        errors.push({
          code: "formal_question_count",
          message: `${skill} expects ${expected} questions in a full mock; the composition adds up to ${questionCounts[skill]}.`,
        });
  }

  if (input.kind === "custom" && input.sections.some((section) => !section.contentVersionId))
    warnings.push({ code: "unpinned_reference", message: "This practice set follows the latest published revision of at least one item." });

  return { ok: errors.length === 0, errors, warnings, totalSeconds, questionCounts };
}

/* -------------------------------------------------------------------------- */
/* Timing plan                                                                */
/* -------------------------------------------------------------------------- */

export type MockTimingPlan = {
  sections: { position: number; skill: string; sourceRef: string; seconds: number; startsAtSeconds: number; endsAtSeconds: number; breakSeconds: number }[];
  totalSeconds: number;
};

/**
 * A plan, not a countdown: the server derives each section's window from the
 * attempt's start moment, so a page refresh cannot restart or extend the clock
 * (§15). The browser only renders what this returns.
 */
export function composeTimingPlan(input: MockCompositionInput): MockTimingPlan {
  const timing = input.timingPolicyId ? mockTimingPolicy(input.timingPolicyId) : null;
  let cursor = 0;
  const sections: MockTimingPlan["sections"] = [];
  input.sections.forEach((section, index) => {
    if (section.optional) return;
    const seconds = section.seconds ?? (timing ? sectionSecondsFor(timing, section.skill) : null) ?? 0;
    const breakSeconds = timing?.sections.find((entry) => entry.skill === section.skill)?.breakSeconds ?? 0;
    sections.push({
      position: index + 1,
      skill: section.skill,
      sourceRef: section.sourceRef,
      seconds,
      startsAtSeconds: cursor,
      endsAtSeconds: cursor + seconds,
      breakSeconds,
    });
    cursor += seconds + breakSeconds;
  });
  return { sections, totalSeconds: cursor };
}

/** Which section the clock is in at a given elapsed time, and how much is left. */
export function sectionStateAt(plan: MockTimingPlan, elapsedSeconds: number): { position: number; remainingSeconds: number; expired: boolean } | null {
  if (elapsedSeconds < 0) return null;
  const last = plan.sections.at(-1);
  if (!last || elapsedSeconds >= last.endsAtSeconds) return null;
  const section = plan.sections.find((entry) => elapsedSeconds >= entry.startsAtSeconds && elapsedSeconds < entry.endsAtSeconds);
  if (!section) return null;
  return { position: section.position, remainingSeconds: section.endsAtSeconds - elapsedSeconds, expired: false };
}

/* -------------------------------------------------------------------------- */
/* Scoring (§21)                                                              */
/* -------------------------------------------------------------------------- */

export type MockSectionResult = {
  skill: string;
  sourceRef: string;
  raw: number | null;
  total: number | null;
  band: number | null;
  contentVersionId: string | null;
  attemptId: string | null;
};

export function scorePolicyRefFor(skill: string, track: Track): string {
  if (skill === "reading") return `${readingPolicyFor(track).id}@${readingPolicyFor(track).version}`;
  if (skill === "listening") return `${scorePolicy("listening").id}@${scorePolicy("listening").version}`;
  return `${skill}@criterion-v1`;
}

export function policyIdFromRef(ref: string): ScorePolicyId | null {
  const id = ref.split("@")[0];
  return id === "listening" || id === "reading_academic" || id === "reading_general_training" ? id : null;
}

export function bandForSection(skill: string, raw: number | null, total: number | null, track: Track): number | null {
  if (raw === null || total === null || total <= 0) return null;
  if (skill !== "listening" && skill !== "reading") return null;
  const policy = skill === "reading" ? readingPolicyFor(track) : scorePolicy("listening");
  if (total === policy.total) return bandFor(policy, raw)?.band ?? null;
  // A sectional mock may use fewer questions: scale, and say so by returning the policy that produced it.
  const scaled = Math.round((raw / total) * policy.total);
  return bandFor(policy, scaled)?.band ?? null;
}

export type MockResult = {
  sections: MockSectionResult[];
  overallBand: number | null;
  rawScore: number | null;
  scorePolicyVersion: string | null;
};

/**
 * Assemble a mock result. Sections stay independently inspectable; the overall
 * band appears only when every required section has one (§21), and it is computed
 * by the shared rule rather than invented here.
 */
export function assembleMockResult(sections: MockSectionResult[], track: Track): MockResult {
  // The overall band appears only when EVERY section carries a band of its own;
  // a raw-count section without a band must not be skipped, and must not be
  // silently counted as zero either.
  const overall = sections.length > 0 ? overallMockBand(sections.map((section) => ({ skill: section.skill, band: section.band }))) : null;
  const raw = sections.every((section) => section.raw !== null) ? sections.reduce((sum, section) => sum + (section.raw ?? 0), 0) : null;
  return {
    sections,
    overallBand: overall,
    rawScore: raw,
    scorePolicyVersion: `${readingPolicyFor(track).version}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export type MockCompositionRow = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  track: string;
  kind: string;
  skill: string;
  timingPolicyId: string | null;
  timingPolicyVersion: string | null;
  navigation: MockNavigationPolicy | null;
  scorePolicies: Record<string, string> | null;
  publicationState: string;
  version: number;
  createdByUserId: string | null;
};

export async function loadMockComposition(
  mockId: string,
  executor: { select: typeof db.select } = db,
): Promise<{ mock: MockCompositionRow; sections: MockSectionInput[] } | null> {
  const rows = await executor.select().from(mockTests).where(eq(mockTests.id, mockId)).limit(1);
  const mock = rows[0];
  if (!mock) return null;
  const sectionRows = await executor
    .select()
    .from(mockSections)
    .where(eq(mockSections.mockTestId, mockId))
    .orderBy(asc(mockSections.position));
  return {
    mock: {
      id: mock.id,
      courseId: mock.courseId,
      title: mock.title,
      description: mock.description,
      track: mock.track,
      kind: mock.kind,
      skill: mock.skill,
      timingPolicyId: mock.timingPolicyId,
      timingPolicyVersion: mock.timingPolicyVersion,
      navigation: (mock.navigation as MockNavigationPolicy | null) ?? null,
      scorePolicies: (mock.scorePolicies as Record<string, string> | null) ?? null,
      publicationState: mock.publicationState,
      version: mock.version,
      createdByUserId: mock.createdByUserId,
    },
    sections: sectionRows.map((section) => ({
      skill: section.skill,
      module: section.module,
      contentType: section.contentType,
      sourceRef: section.sourceRef,
      contentVersionId: section.contentVersionId,
      label: section.label,
      questionCount: section.questionCount,
      seconds: section.seconds,
      optional: section.optional,
    })),
  };
}

export type MockWriter = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
};

export type SaveMockInput = {
  mockId?: string;
  courseId: string;
  composition: MockCompositionInput & { description?: string | null };
  actorUserId: string;
  provenance?: Record<string, unknown> | null;
};

export type SaveMockResult =
  | { ok: true; mockId: string; version: number; report: MockCompositionReport; created: boolean }
  | { ok: false; report: MockCompositionReport };

/**
 * Write a composition. The compatibility report is a HARD gate: an invalid mock
 * cannot be stored, so "cannot publish an invalid mock composition" holds by
 * construction rather than by remembering to check later.
 *
 * Replacing sections bumps `version`, which is what an attempt records — so an
 * attempt started before the change is still explainable afterwards.
 */
/**
 * Every pinned revision must be the revision OF the content the section names.
 * Without this, a composer could pin an unrelated (or empty) version and the mock
 * would claim to assess material it does not contain — "forged mock membership"
 * (§102). Checked against the version rows themselves, not against user input.
 */
export async function versionIdentityProblems(
  sections: MockSectionInput[],
  executor: VersionReader,
): Promise<MockCompositionIssue[]> {
  const problems: MockCompositionIssue[] = [];
  for (const [index, section] of sections.entries()) {
    if (!section.contentVersionId) continue;
    const version = await versionById(section.contentVersionId, executor);
    if (!version) {
      problems.push({ position: index + 1, code: "version_not_found", message: `Section ${index + 1}: the pinned revision does not exist.` });
      continue;
    }
    if (version.module !== section.module || version.contentType !== section.contentType || version.sourceRef !== section.sourceRef)
      problems.push({
        position: index + 1,
        code: "version_identity_mismatch",
        message: `Section ${index + 1}: revision ${version.module}:${version.contentType}:${version.sourceRef} is not a revision of ${section.module}:${section.contentType}:${section.sourceRef}.`,
      });
  }
  return problems;
}

export async function saveMockComposition(tx: MockWriter, input: SaveMockInput): Promise<SaveMockResult> {
  const report = validateMockComposition(input.composition);
  const identityIssues = await versionIdentityProblems(input.composition.sections, tx as VersionReader);
  if (identityIssues.length) report.errors.push(...identityIssues);
  if (!report.ok) return { ok: false, report };

  const navigation = navigationPolicyFor(input.composition.kind, input.composition.navigation);
  const scorePolicies = Object.fromEntries(
    [...new Set(input.composition.sections.map((section) => section.skill))].map((skill) => [
      skill,
      scorePolicyRefFor(skill, input.composition.track),
    ]),
  );

  const values = {
    courseId: input.courseId,
    title: input.composition.title,
    description: input.composition.description ?? null,
    track: input.composition.track,
    kind: input.composition.kind,
    skill: input.composition.kind === "full" ? "full" : input.composition.sections[0]!.skill,
    timingPolicyId: input.composition.timingPolicyId ?? null,
    timingPolicyVersion: input.composition.timingPolicyId ? mockTimingPolicy(input.composition.timingPolicyId)?.version ?? null : null,
    navigation: navigation as unknown as Record<string, boolean>,
    scorePolicies,
    createdByUserId: input.actorUserId,
    provenance: input.provenance ?? null,
    updatedAt: new Date(),
  };

  let mockId = input.mockId;
  let created = false;
  let version = 1;

  if (mockId) {
    const existing = await tx.select().from(mockTests).where(eq(mockTests.id, mockId)).limit(1);
    const current = existing[0];
    if (!current) return { ok: false, report: { ok: false, errors: [{ code: "not_found", message: "Unknown mock." }], warnings: [], totalSeconds: 0, questionCounts: {} } };
    if (current.publicationState === "published")
      return {
        ok: false,
        report: {
          ok: false,
          errors: [{ code: "mock_published", message: "A published mock is frozen: archive it before changing its sections." }],
          warnings: [],
          totalSeconds: 0,
          questionCounts: {},
        },
      };
    version = current.version + 1;
    await tx
      .update(mockTests)
      .set({ ...values, version })
      .where(eq(mockTests.id, mockId));
    await tx.delete(mockSections).where(eq(mockSections.mockTestId, mockId));
  } else {
    const [row] = await tx.insert(mockTests).values({ ...values, version: 1 }).returning({ id: mockTests.id });
    mockId = row!.id;
    created = true;
  }

  await tx.insert(mockSections).values(
    input.composition.sections.map((section, index) => ({
      mockTestId: mockId!,
      position: index + 1,
      skill: section.skill,
      module: section.module,
      contentType: section.contentType,
      sourceRef: section.sourceRef,
      contentVersionId: section.contentVersionId ?? null,
      label: section.label ?? null,
      questionCount: section.questionCount ?? null,
      seconds: section.seconds ?? null,
      optional: section.optional ?? false,
    })),
  );

  return { ok: true, mockId: mockId!, version, report, created };
}

/* -------------------------------------------------------------------------- */
/* Publication gate                                                           */
/* -------------------------------------------------------------------------- */

export type MockPublicationGate = { canPublish: boolean; reasons: MockCompositionIssue[] };

/**
 * Publication requires: a valid composition, every formal section pinned to a
 * version whose row is still readable, and no reference to material that has since
 * been archived. Checked at publish time, not only at save time, because content
 * can be archived after a mock was composed.
 */
export async function mockPublicationGate(
  mockId: string,
  executor: VersionReader = db,
): Promise<MockPublicationGate> {
  const loaded = await loadMockComposition(mockId, executor as { select: typeof db.select });
  if (!loaded) return { canPublish: false, reasons: [{ code: "not_found", message: "Unknown mock." }] };
  const formal = loaded.mock.kind === "full" || loaded.mock.kind === "diagnostic";
  const composition: MockCompositionInput = {
    track: loaded.mock.track as Track,
    kind: loaded.mock.kind as MockKind,
    title: loaded.mock.title,
    timingPolicyId: loaded.mock.timingPolicyId,
    navigation: loaded.mock.navigation,
    sections: loaded.sections,
  };
  const report = validateMockComposition(composition);
  const reasons = [...report.errors, ...(await versionIdentityProblems(loaded.sections, executor))];
  for (const [index, section] of loaded.sections.entries()) {
    if (!section.contentVersionId) continue;
    const version = await versionById(section.contentVersionId, executor);
    if (version && version.status === "archived")
      reasons.push({ position: index + 1, code: "version_archived", message: `Section ${index + 1}: the pinned revision was archived.` });
  }
  if (formal && !loaded.mock.scorePolicies)
    reasons.push({ code: "score_policy_required", message: "A formal mock must declare its score conversion policies." });
  return { canPublish: reasons.length === 0, reasons };
}

/** The mock version an attempt must be started against. */
export async function currentMockVersion(mockId: string, executor: { select: typeof db.select } = db): Promise<number | null> {
  const rows = await executor.select({ version: mockTests.version, state: mockTests.publicationState }).from(mockTests).where(eq(mockTests.id, mockId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.state !== "published") return null;
  return row.version;
}

/** Sections of the version a learner is starting, with the bindings frozen. */
export function freezeBindings(sections: MockSectionInput[]): Record<string, string | null> {
  return Object.fromEntries(sections.map((section, index) => [String(index + 1), section.contentVersionId ?? null]));
}

export type { MockAttemptSnapshot };

export type StartMockAttemptResult =
  | { ok: true; attemptId: string; mockVersion: number; bindings: Record<string, string | null> }
  | { ok: false; reason: "mock_not_found" | "mock_not_published" | "no_sections" };

/**
 * Start an attempt against the PUBLISHED version. The composition version, the
 * per-section content revisions and a readable snapshot are all copied into the
 * attempt row, so later edits to the mock or to the content never rewrite what the
 * learner actually sat (§13, §71).
 */
export async function startMockAttempt(
  tx: MockWriter,
  input: { mockId: string; userId: string; now?: Date },
): Promise<StartMockAttemptResult> {
  const loaded = await loadMockComposition(input.mockId, tx as { select: typeof db.select });
  if (!loaded) return { ok: false, reason: "mock_not_found" };
  if (loaded.sections.length === 0) return { ok: false, reason: "no_sections" };
  const version = await currentMockVersion(input.mockId, tx as { select: typeof db.select });
  if (version === null) return { ok: false, reason: "mock_not_published" };

  const snapshot: MockAttemptSnapshot = {
    title: loaded.mock.title,
    track: loaded.mock.track,
    kind: loaded.mock.kind,
    timingPolicyId: loaded.mock.timingPolicyId,
    scorePolicies: loaded.mock.scorePolicies,
  };
  const bindings = freezeBindings(loaded.sections);
  const [row] = await tx
    .insert(mockAttempts)
    .values({
      userId: input.userId,
      mockTestId: input.mockId,
      mockVersion: version,
      status: "in_progress",
      startedAt: input.now ?? new Date(),
      contentVersionBindings: bindings,
      mockSnapshot: snapshot,
    })
    .returning({ id: mockAttempts.id });
  return { ok: true, attemptId: row!.id, mockVersion: version, bindings };
}

/** A published mock is frozen: sections may not be replaced while it is live. */
export async function mockIsEditable(mockId: string, executor: { select: typeof db.select } = db): Promise<boolean> {
  const rows = await executor
    .select({ state: mockTests.publicationState })
    .from(mockTests)
    .where(eq(mockTests.id, mockId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  return row.state !== "published";
}

export type { PgColumn, PgTable };
