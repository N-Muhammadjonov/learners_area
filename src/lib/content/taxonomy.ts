import { CONTENT_MODULES, PROVENANCE_SOURCES, type ContentModule } from "@/lib/import/core/envelope";

/**
 * The shared content taxonomy — the vocabulary every other layer speaks.
 *
 * Deliberately NOT IELTS-specific: a course is a course, a module is a module, and
 * a track is whatever that course calls its variants. IELTS rules (which tracks
 * exist, which composition is valid, which band table applies) live in
 * `src/lib/content/ielts.ts` as a domain adapter, so adding SAT later does not
 * mean renaming the base entities.
 *
 * This module is pure data + pure functions: safe on the client, safe in a
 * migration script, no database, no React.
 */

export { CONTENT_MODULES };
export type { ContentModule };

/* -------------------------------------------------------------------------- */
/* Module classes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How a module behaves, which is what the shared layers actually branch on:
 * a `skill` has timed assessments and bands, a `subject` has graded exercises, a
 * `media` module is a source of language (transcripts, vocabulary), and a
 * `composition` module is built by REFERENCE and never owns content.
 */
export type ModuleClass = "skill" | "subject" | "media" | "composition";

export type ModuleDescriptor = {
  module: ContentModule;
  label: string;
  class: ModuleClass;
  /** Tracks this module distinguishes (`academic` / `general_training`), if any. */
  tracks: Track[];
  /** Learner-facing library route, when the module has a library. */
  libraryPath: string | null;
  /** Focus mode contract: does an assessment open outside the normal app chrome? */
  focus: "always" | "assessment-only" | "never";
  /** Canonical content types this module owns, in display order. */
  contentTypes: string[];
};

export type Track = "academic" | "general_training" | "unspecified";

export const TRACKS: Track[] = ["academic", "general_training", "unspecified"];

export const MODULE_DESCRIPTORS: ModuleDescriptor[] = [
  {
    module: "listening",
    label: "Listening",
    class: "skill",
    tracks: ["academic", "general_training"],
    libraryPath: "/listening",
    focus: "always",
    contentTypes: ["full_test", "section", "question_type_practice"],
  },
  {
    module: "reading",
    label: "Reading",
    class: "skill",
    tracks: ["academic", "general_training"],
    libraryPath: "/reading",
    focus: "assessment-only",
    contentTypes: ["general_set", "full_test", "passage", "passage_set", "question_type_practice"],
  },
  {
    module: "writing",
    label: "Writing",
    class: "skill",
    tracks: ["academic", "general_training"],
    libraryPath: "/writing",
    focus: "assessment-only",
    contentTypes: ["task1", "task2", "lesson", "model_text", "pattern", "translation_set"],
  },
  {
    module: "speaking",
    label: "Speaking",
    class: "skill",
    tracks: ["academic", "general_training"],
    libraryPath: "/speaking",
    focus: "never",
    /**
     * `topic_set` and `shadowing` are NOT declared content types, and that is a
     * deliberate correction rather than an omission:
     *
     *   • a "topic set" is the `topic` grouping over canonical `speaking_prompts`,
     *     managed by `manage-topic` against one bank — declaring a type for it would
     *     invite a second store for prompts that already have one;
     *   • `shadowing` is a CATEGORY of `speaking:material` (a row whose category is
     *     `shadowing`), read by the shadowing studio from the same table.
     */
    contentTypes: ["part1_question", "cue_card", "part3_question", "material"],
  },
  {
    module: "grammar",
    label: "Grammar",
    class: "subject",
    tracks: ["unspecified"],
    libraryPath: "/grammar",
    focus: "never",
    contentTypes: ["topic", "exercise"],
  },
  {
    module: "vocabulary",
    label: "Vocabulary",
    class: "subject",
    tracks: ["unspecified"],
    libraryPath: "/vocabulary",
    focus: "never",
    contentTypes: ["topic_pack", "retention_text"],
  },
  {
    module: "ted",
    label: "TED / Podcast",
    class: "media",
    tracks: ["unspecified"],
    libraryPath: "/video-lessons",
    focus: "never",
    contentTypes: ["video_lesson", "audio_lesson"],
  },
  {
    module: "lesson",
    label: "Lesson",
    class: "composition",
    tracks: ["unspecified"],
    libraryPath: "/courses",
    focus: "never",
    contentTypes: ["lesson"],
  },
];

export const COMPOSITION_KINDS = ["mock", "sectional_mock", "practice_set", "assignment", "lesson"] as const;
export type CompositionKind = (typeof COMPOSITION_KINDS)[number];

export type CompositionDescriptor = {
  kind: CompositionKind;
  label: string;
  /** Does it own educational content, or only references? Compositions never own. */
  ownsContent: false;
  /** Formal assessment compositions pin exact versions; informal ones may track latest. */
  versionBinding: "pinned" | "latest" | "either";
  /** Is publishing it gated by a compatibility check? */
  compatibilityChecked: boolean;
};

export const COMPOSITION_DESCRIPTORS: Record<CompositionKind, CompositionDescriptor> = {
  mock: { kind: "mock", label: "Full mock", ownsContent: false, versionBinding: "pinned", compatibilityChecked: true },
  sectional_mock: { kind: "sectional_mock", label: "Sectional mock", ownsContent: false, versionBinding: "pinned", compatibilityChecked: true },
  practice_set: { kind: "practice_set", label: "Practice set", ownsContent: false, versionBinding: "latest", compatibilityChecked: false },
  assignment: { kind: "assignment", label: "Assignment", ownsContent: false, versionBinding: "either", compatibilityChecked: false },
  lesson: { kind: "lesson", label: "Lesson", ownsContent: false, versionBinding: "latest", compatibilityChecked: false },
};

/* -------------------------------------------------------------------------- */
/* Content-type identity                                                      */
/* -------------------------------------------------------------------------- */

export type ContentTypeIdentity = {
  module: ContentModule;
  contentType: string;
};

const CONTENT_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,59}$/;

export function moduleDescriptor(module: string): ModuleDescriptor | undefined {
  return MODULE_DESCRIPTORS.find((entry) => entry.module === module);
}

export function isKnownModule(module: string): module is ContentModule {
  return (CONTENT_MODULES as readonly string[]).includes(module);
}

export function isKnownContentType(module: string, contentType: string): boolean {
  const descriptor = moduleDescriptor(module);
  return Boolean(descriptor && descriptor.contentTypes.includes(contentType));
}

/** `module:contentType` — the identity a composition and a version row store. */
export function contentTypeKey(module: string, contentType: string): string {
  return `${module}:${contentType}`;
}

export function parseContentTypeKey(key: string): ContentTypeIdentity | null {
  const [module, contentType, ...rest] = key.split(":");
  if (rest.length || !module || !contentType) return null;
  if (!isKnownModule(module) || !CONTENT_TYPE_PATTERN.test(contentType)) return null;
  return { module, contentType };
}

/**
 * The full identity of a piece of content: what it is, which track it serves and
 * which stable source identity it came from. Used in error messages and in the
 * version store, never as a substitute for a primary key.
 */
export type ContentIdentity = ContentTypeIdentity & {
  sourceRef: string;
  track: Track;
};

export function isUnspecifiedTrack(track: Track | null | undefined): boolean {
  return !track || track === "unspecified";
}

/* -------------------------------------------------------------------------- */
/* Cross-reference rules                                                      */
/* -------------------------------------------------------------------------- */

export type ReferenceTarget = {
  module: string;
  contentType: string;
  /** The stable identity of the referenced object. */
  sourceRef: string;
  /** Exact version pinned by the reference, when it pins one. */
  versionId?: string | null;
  /** Track the referenced material belongs to, when it declares one. */
  track?: string | null;
  /** Publication state at the moment the reference is validated. */
  publicationState?: string | null;
};

export type ReferenceProblem = {
  code: "unknown_module" | "unknown_content_type" | "track_mismatch" | "not_published" | "version_required" | "version_missing";
  message: string;
};

/**
 * Cross-reference validation (§48): a reference must point at a content type that
 * exists, must not mix tracks in one assessment, must be published/eligible, and
 * a formal composition must pin an exact version.
 */
export function referenceProblems(
  target: ReferenceTarget,
  options: { track?: Track; requireVersion?: boolean; requirePublished?: boolean } = {},
): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  if (!isKnownModule(target.module))
    return [{ code: "unknown_module", message: `Unknown module "${target.module}".` }];
  if (!isKnownContentType(target.module, target.contentType))
    problems.push({
      code: "unknown_content_type",
      message: `${target.module} has no content type "${target.contentType}".`,
    });
  if (options.track && !isUnspecifiedTrack(options.track) && !isUnspecifiedTrack(target.track as Track) && target.track !== options.track)
    problems.push({
      code: "track_mismatch",
      message: `A ${options.track} composition cannot include ${target.track} ${target.module} content.`,
    });
  if (options.requirePublished && target.publicationState && target.publicationState !== "published")
    problems.push({
      code: "not_published",
      message: `${target.module}:${target.contentType} "${target.sourceRef}" is ${target.publicationState}, not published.`,
    });
  if (options.requireVersion && !target.versionId)
    problems.push({
      code: "version_required",
      message: `A formal composition must pin an exact version of ${target.module}:${target.contentType} "${target.sourceRef}".`,
    });
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Publication                                                               */
/* -------------------------------------------------------------------------- */

export const PUBLICATION_STATES = ["draft", "scheduled", "published", "archived"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export function isPublicationState(value: string): value is PublicationState {
  return (PUBLICATION_STATES as readonly string[]).includes(value);
}

export { PROVENANCE_SOURCES };
