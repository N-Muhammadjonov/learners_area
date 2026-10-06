import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, lessons } from "@/db/schema";
import { listRegisteredAuthors, registerModuleAuthors } from "@/lib/content/authors";
import { contentTypeKey } from "@/lib/content/taxonomy";
import { isKnownContentType, isKnownModule } from "@/lib/content/taxonomy";
import { latestVersion, versionContent, versionIdentity, type VersionReader } from "@/lib/content/versions";

/**
 * NATIVE PREVIEW (§Z).
 *
 * One truthful preview path for every authorable canonical content type, built on the
 * SAME canonical data the learner renderer consumes — the version snapshot — and
 * deliberately independent of publication: a draft is exactly what needs previewing.
 *
 * The rules this module exists to keep:
 *
 *   • a preview NEVER requires publication. It reads the revision, whatever its state;
 *   • a preview is staff-only. That is enforced at the route (`isStaff`), and the
 *     service itself is never reachable from a learner read path;
 *   • a preview NEVER executes authored code. A Listening revision whose canonical
 *     content still carries an `authoredRuntime` is reported as executable material and
 *     is NOT rendered here — that surface stays the opaque-origin sandbox, and no HTML
 *     is handed to the preview caller;
 *   • answer keys ARE shown, because verifying them before publishing is the point —
 *     and the flag `answerKeyVisible` says so explicitly instead of leaving it implicit;
 *   • an OPTIONAL region fails locally (`PreviewPart.problem`) while the rest of the
 *     preview stands; a missing CORE region makes the preview honestly `MISSING`
 *     instead of rendering an empty shell that looks like valid content.
 */

export type PreviewRegionStatus = "PREVIEW_READY" | "PARTIAL" | "MISSING";

export type PreviewPart = {
  key: string;
  label: string;
  kind: "text" | "questions" | "passages" | "blocks" | "media" | "words" | "sentences" | "notice";
  /** The canonical data itself — never HTML, never executable. */
  value: unknown;
  /** Set when this optional region could not be resolved; the part is still returned. */
  problem?: string;
};

export type ContentPreview = {
  identity: {
    module: string;
    contentType: string;
    sourceRef: string;
    contentKey: string;
    versionId: string;
    versionNo: number;
    /** `module:contentType:sourceRef@vN` — the identity a pinned reference names. */
    versionIdentity: string;
    status: string;
    publicationState: string;
    track: string;
    title: string;
  };
  /** Exactly what the version store holds, unchanged. */
  canonical: unknown;
  parts: PreviewPart[];
  /** Staff previews legitimately show the key; the flag states it rather than hiding it. */
  answerKeyVisible: boolean;
  problems: string[];
  status: PreviewRegionStatus;
};

/**
 * What a projection knows about the revision it is projecting, beyond its bytes.
 * Additive: a projection that does not need it ignores it, and none is forced to
 * restate the identity the version store already holds.
 */
export type PreviewBuildContext = {
  /** The row this revision was pinned against (e.g. the lesson), when it names one. */
  targetId: string | null;
};

export type PreviewProjection = {
  /** Which authorable type this projection serves. */
  module: string;
  contentType: string;
  /** Core regions that must be present for the preview to be whole. */
  requiredParts: string[];
  build: (content: unknown, executor: VersionReader, context: PreviewBuildContext) => Promise<PreviewPart[]> | PreviewPart[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Does this canonical content carry authored executable material?
 *
 * A legacy Listening revision can still hold an `authoredRuntime` (HTML/JS/CSS the
 * package shipped with). That material is DATA in the version store, but a preview that
 * echoes it would hand authored markup to whatever renders the preview next — the exact
 * path this module exists to avoid. Executable content is therefore REDACTED from the
 * preview response entirely, and the caller is told why.
 */
function carriesExecutableContent(content: unknown): boolean {
  if (!isRecord(content)) return false;
  return content.authoredRuntime !== undefined || content.runtime !== undefined;
}

const arrayAt = (content: unknown, key: string): unknown[] => (isRecord(content) && Array.isArray(content[key]) ? (content[key] as unknown[]) : []);

const questionsPart = (content: unknown, key: string, label: string): PreviewPart[] => {
  const questions = arrayAt(content, key);
  return [
    {
      key,
      label,
      kind: "questions",
      value: questions,
      ...(questions.length === 0 ? { problem: "no_questions" } : {}),
    },
  ];
};

/**
 * A block list, with each `content_reference` resolved INDEPENDENTLY: one missing or
 * unpublished reference marks that block, and the rest of the lesson still previews.
 */
function lessonBlocksPart(content: unknown, resolved: Map<number, { ok: boolean; versionId?: string; publicationState?: string }>): PreviewPart[] {
  const blocks = arrayAt(content, "blocks");
  const rendered = blocks.map((block, index) => {
    if (!isRecord(block)) return block;
    if (block.type !== "content_reference") return block;
    const state = resolved.get(index);
    return {
      ...block,
      resolved: state
        ? state.ok
          ? { versionId: state.versionId, publicationState: state.publicationState }
          : { unavailable: true }
        : { unavailable: true, problem: "reference_not_checked" },
    };
  });
  return [
    {
      key: "blocks",
      label: "Typed blocks",
      kind: "blocks",
      value: rendered,
      ...(blocks.length === 0 ? { problem: "empty_lesson" } : {}),
    },
  ];
}

/**
 * The projections, one per authorable content type. A type with no projection is
 * reported as `MISSING` by the inventory rather than silently previewing nothing.
 */
export const PREVIEW_PROJECTIONS: PreviewProjection[] = [
  {
    module: "listening",
    contentType: "full_test",
    requiredParts: ["questions"],
    build: (content) => {
      // Defence in depth: the service already redacts executable content before a
      // projection runs, so this branch should be unreachable — it stays because a
      // future caller must not be able to route authored markup through a projection.
      if (carriesExecutableContent(content))
        return [{ key: "executable_runtime", label: "Executable material", kind: "notice", value: null, problem: "executable_runtime_not_previewable" }];
      return [
        ...questionsPart(content, "questions", "Questions (with keys)"),
        ...(isRecord(content) && typeof content.sectionNo === "number"
          ? [{ key: "sectionNo", label: "Section", kind: "text" as const, value: content.sectionNo }]
          : []),
      ];
    },
  },
  {
    module: "listening",
    contentType: "section",
    requiredParts: ["questions"],
    build: (content) => [
      {
        key: "sectionNo",
        label: "Section number",
        kind: "text",
        value: isRecord(content) ? content.sectionNo ?? null : null,
        ...(isRecord(content) && typeof content.sectionNo === "number" ? {} : { problem: "missing_section_no" }),
      },
      ...questionsPart(content, "questions", "Questions (with keys)"),
    ],
  },
  {
    module: "reading",
    contentType: "general_set",
    requiredParts: ["passages"],
    build: (content) => [
      { key: "passages", label: "Passages", kind: "passages", value: arrayAt(content, "passages"), ...(arrayAt(content, "passages").length === 0 ? { problem: "no_passages" } : {}) },
      ...(isRecord(content) && typeof content.timeLimitMinutes === "number"
        ? [{ key: "timeLimitMinutes", label: "Time limit (minutes)", kind: "text" as const, value: content.timeLimitMinutes }]
        : []),
    ],
  },
  {
    module: "reading",
    contentType: "passage",
    requiredParts: ["passages"],
    build: (content) => [
      { key: "passages", label: "Passage", kind: "passages", value: arrayAt(content, "passages"), ...(arrayAt(content, "passages").length === 1 ? {} : { problem: "passage_item_must_hold_exactly_one" }) },
    ],
  },
  {
    module: "writing",
    contentType: "task1",
    requiredParts: ["prompt"],
    build: writingTaskPreview,
  },
  {
    module: "writing",
    contentType: "task2",
    requiredParts: ["prompt"],
    build: writingTaskPreview,
  },
  {
    module: "writing",
    contentType: "lesson",
    requiredParts: ["body"],
    build: (content) => [
      { key: "body", label: "Lesson body", kind: "text", value: isRecord(content) ? content.body ?? null : null, ...(isRecord(content) && typeof content.body === "string" && content.body.trim() ? {} : { problem: "missing_body" }) },
    ],
  },
  {
    module: "writing",
    contentType: "model_text",
    requiredParts: ["body"],
    build: (content) => [
      { key: "body", label: "Model text", kind: "text", value: isRecord(content) ? content.body ?? null : null, ...(isRecord(content) && typeof content.body === "string" && content.body.trim() ? {} : { problem: "missing_body" }) },
      ...(isRecord(content) && typeof content.wordCount === "number" ? [{ key: "wordCount", label: "Words", kind: "text" as const, value: content.wordCount }] : []),
    ],
  },
  {
    module: "writing",
    contentType: "pattern",
    requiredParts: ["pattern"],
    build: (content) => [
      { key: "pattern", label: "Pattern", kind: "text", value: isRecord(content) ? content.pattern ?? null : null, ...(isRecord(content) && typeof content.pattern === "string" && content.pattern.trim() ? {} : { problem: "missing_pattern" }) },
      ...(isRecord(content) && typeof content.example === "string" ? [{ key: "example", label: "Example", kind: "text" as const, value: content.example }] : []),
    ],
  },
  {
    module: "writing",
    contentType: "translation_set",
    requiredParts: ["sentences"],
    build: (content) => [
      { key: "sentences", label: "Sentences", kind: "sentences", value: arrayAt(content, "sentences"), ...(arrayAt(content, "sentences").length === 0 ? { problem: "no_sentences" } : {}) },
    ],
  },
  {
    module: "speaking",
    contentType: "part1_question",
    requiredParts: ["promptText"],
    build: speakingPreview,
  },
  {
    module: "speaking",
    contentType: "cue_card",
    requiredParts: ["promptText"],
    build: speakingPreview,
  },
  {
    module: "speaking",
    contentType: "part3_question",
    requiredParts: ["promptText"],
    build: speakingPreview,
  },
  {
    module: "speaking",
    contentType: "material",
    requiredParts: ["primary"],
    build: (content) => {
      const record = isRecord(content) ? content : {};
      const primaryType = typeof record.primaryType === "string" ? record.primaryType : null;
      const primaryUrl = typeof record.primaryUrl === "string" ? record.primaryUrl : null;
      const hasPrimary = record.hasPrimary === true || Boolean(primaryUrl);
      const blocks = Array.isArray(record.blocks) ? record.blocks : [];
      return [
        {
          key: "primary",
          label: "Primary",
          kind: "text" as const,
          value: hasPrimary ? `${primaryType ?? "file"}${primaryUrl ? ` — ${primaryUrl}` : ""}` : null,
          // A material with no primary and no blocks would be an empty promise, so it
          // is reported as a missing core region rather than previewed as a shell.
          ...(hasPrimary || blocks.length > 0 ? {} : { problem: "missing_primary" }),
        },
        {
          key: "attachments",
          label: "Attached blocks",
          kind: "notice" as const,
          value: blocks.map((block) => (isRecord(block) ? (block.text ?? block.link ?? block.type ?? "block") : "block")),
        },
        { key: "category", label: "Category", kind: "text" as const, value: typeof record.category === "string" ? record.category : null },
      ];
    },
  },
  {
    module: "grammar",
    contentType: "topic",
    requiredParts: ["exercises"],
    build: (content) => [
      { key: "explanation", label: "Explanation", kind: "text", value: isRecord(content) ? content.explanation ?? null : null, ...(isRecord(content) && typeof content.explanation === "string" && content.explanation.trim() ? {} : { problem: "missing_explanation" }) },
      { key: "exercises", label: "Exercises (with keys)", kind: "questions", value: arrayAt(content, "exercises"), ...(arrayAt(content, "exercises").length === 0 ? { problem: "no_exercises" } : {}) },
    ],
  },
  {
    module: "vocabulary",
    contentType: "topic_pack",
    requiredParts: ["words"],
    build: (content) => [
      { key: "words", label: "Canonical senses", kind: "words", value: arrayAt(content, "words"), ...(arrayAt(content, "words").length === 0 ? { problem: "no_words" } : {}) },
    ],
  },
  {
    module: "lesson",
    contentType: "lesson",
    requiredParts: ["blocks"],
    build: (content, executor, context) => lessonPreview(content, executor, context),
  },
  {
    module: "ted",
    contentType: "video_lesson",
    requiredParts: ["media"],
    build: mediaLessonPreview,
  },
  {
    module: "ted",
    contentType: "audio_lesson",
    requiredParts: ["media"],
    build: mediaLessonPreview,
  },
];

function writingTaskPreview(content: unknown): PreviewPart[] {
  const prompt = isRecord(content) ? content.prompt ?? null : null;
  return [
    {
      key: "prompt",
      label: "Prompt",
      kind: "text",
      value: prompt,
      ...(typeof prompt === "string" && prompt.trim() ? {} : { problem: "missing_prompt" }),
    },
    ...(isRecord(content) && typeof content.wordMinimum === "number"
      ? [{ key: "wordMinimum", label: "Minimum words", kind: "text" as const, value: content.wordMinimum }]
      : []),
  ];
}

function speakingPreview(content: unknown): PreviewPart[] {
  const promptText = isRecord(content) ? content.promptText ?? null : null;
  const cueCard = isRecord(content) ? content.cueCard ?? null : null;
  return [
    {
      key: "promptText",
      label: "Prompt",
      kind: "text",
      value: promptText,
      ...(typeof promptText === "string" && promptText.trim() ? {} : { problem: "missing_prompt" }),
    },
    ...(typeof cueCard === "string" && cueCard.trim() ? [{ key: "cueCard", label: "Cue card", kind: "text" as const, value: cueCard }] : []),
    ...(isRecord(content) && Array.isArray(content.followUps) && content.followUps.length
      ? [{ key: "followUps", label: "Follow-ups", kind: "text" as const, value: content.followUps }]
      : []),
  ];
}

function mediaLessonPreview(content: unknown): PreviewPart[] {
  const media = isRecord(content) ? content.media ?? content : null;
  const hasMedia = isRecord(media) && (typeof media.provider === "string" || typeof media.videoUrl === "string");
  return [
    {
      key: "media",
      label: "Media reference",
      kind: "media",
      value: media,
      ...(hasMedia ? {} : { problem: "missing_media_reference" }),
    },
    ...(isRecord(content) && Array.isArray(content.questions)
      ? [{ key: "questions", label: "Questions", kind: "questions" as const, value: content.questions }]
      : []),
    ...(isRecord(content) && Array.isArray(content.transcriptLines)
      ? []
      : isRecord(content) && typeof content.transcript === "string" && content.transcript.trim()
        ? [{ key: "transcript", label: "Transcript", kind: "text" as const, value: content.transcript }]
        : []),
  ];
}

/**
 * What the revision says the lesson IS — its area, description, teacher notes and
 * estimated time — read defensively.
 *
 * A revision pinned before migration 0050 holds `{ blocks }` only. It must stay
 * readable, so when the snapshot carries no metadata at all the part falls back to the
 * LESSON ROW (the authoring truth) and says so with `source: "lesson_row"`. Nothing is
 * invented and nothing is rewritten: the same revision keeps previewing exactly as it
 * did, now with the metadata the lesson actually has.
 *
 * Teacher notes are shown here deliberately: this is the staff verification surface
 * (the route is `isStaff`), and verifying the centre's notes before publishing is
 * precisely what the preview is for. They are never rendered to a learner by this path.
 */
async function lessonMetadataParts(
  content: unknown,
  executor: VersionReader,
  context: PreviewBuildContext,
): Promise<PreviewPart[]> {
  const record = isRecord(content) ? content : {};
  const snapshotSays = ["learningArea", "summary", "teacherNotes", "estimatedMinutes"].some((key) => key in record);
  const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  const readNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

  let learningArea = readString(record.learningArea);
  let summary = readString(record.summary);
  let teacherNotes = readString(record.teacherNotes);
  let estimatedMinutes = readNumber(record.estimatedMinutes);
  let source: "revision" | "lesson_row" | "unclassified" = snapshotSays ? "revision" : "unclassified";

  if (!snapshotSays && context.targetId) {
    const [lesson] = await executor
      .select({
        learningArea: lessons.learningArea,
        summary: lessons.summary,
        teacherNotes: lessons.teacherNotes,
        estimatedMinutes: lessons.estimatedMinutes,
      })
      .from(lessons)
      .where(eq(lessons.id, context.targetId))
      .limit(1);
    if (lesson) {
      learningArea = readString(lesson.learningArea);
      summary = readString(lesson.summary);
      teacherNotes = readString(lesson.teacherNotes);
      estimatedMinutes = readNumber(lesson.estimatedMinutes);
      source = "lesson_row";
    }
  }

  return [
    {
      key: "lesson_metadata",
      label: "Lesson metadata",
      kind: "text",
      value: {
        learningArea,
        summary,
        teacherNotes,
        estimatedMinutes,
        // Where the values came from. `unclassified` is the truthful answer for a
        // pre-0050 revision whose lesson row is gone or still unspecified.
        source,
      },
    },
  ];
}

/** Blocks, plus each canonical reference resolved on its own. */
async function lessonPreview(content: unknown, executor: VersionReader, context: PreviewBuildContext): Promise<PreviewPart[]> {
  const blocks = arrayAt(content, "blocks");
  const resolved = new Map<number, { ok: boolean; versionId?: string; publicationState?: string }>();
  for (const [index, block] of blocks.entries()) {
    if (!isRecord(block) || block.type !== "content_reference") continue;
    const ref = isRecord(block.ref) ? block.ref : null;
    if (!ref || typeof ref.sourceRef !== "string" || typeof ref.module !== "string" || typeof ref.contentType !== "string") {
      resolved.set(index, { ok: false });
      continue;
    }
    try {
      // A pinned reference names its revision directly; an unpinned one follows the
      // newest revision of that item. Either way the row is re-read, so the preview
      // reports the state of the revision it would ACTUALLY open.
      let targetId = typeof ref.versionId === "string" ? ref.versionId : null;
      if (!targetId) targetId = (await latestVersion(ref.module, ref.contentType, ref.sourceRef, executor))?.id ?? null;
      if (!targetId) {
        resolved.set(index, { ok: false });
        continue;
      }
      const [row] = await executor
        .select({ publicationState: contentVersions.publicationState, id: contentVersions.id })
        .from(contentVersions)
        .where(eq(contentVersions.id, targetId))
        .limit(1);
      resolved.set(index, { ok: Boolean(row), versionId: row?.id, publicationState: row?.publicationState });
    } catch {
      // One unresolvable reference is a local problem, never a failed preview.
      resolved.set(index, { ok: false });
    }
  }
  return [...(await lessonMetadataParts(content, executor, context)), ...lessonBlocksPart(content, resolved)];
}

export function projectionFor(module: string, contentType: string): PreviewProjection | undefined {
  return PREVIEW_PROJECTIONS.find((entry) => entry.module === module && entry.contentType === contentType);
}

/**
 * The §Z inventory, computed from the registry rather than hand-written: every
 * authorable type is either PREVIEW_READY (a projection exists and declares its core
 * regions) or MISSING (it does not). A type that is registered but has no author is
 * listed as not applicable.
 */
export function previewInventory(): { module: string; contentType: string; status: PreviewRegionStatus; requiredParts: string[] }[] {
  registerModuleAuthors();
  return listRegisteredAuthors().map(({ module, contentType }) => {
    const projection = projectionFor(module, contentType);
    return {
      module,
      contentType,
      status: projection ? (projection.requiredParts.length ? "PREVIEW_READY" : "PARTIAL") : "MISSING",
      requiredParts: projection?.requiredParts ?? [],
    };
  });
}

/**
 * Preview one revision. Staff-only is enforced by the caller; this function answers
 * only "what would a staff member see", and it never loads anything a learner read
 * path loads, so a draft preview cannot make a draft visible to anyone else.
 */
export async function previewContentVersion(versionId: string, executor: VersionReader = db): Promise<ContentPreview | null> {
  const [row] = await executor
    .select({
      id: contentVersions.id,
      module: contentVersions.module,
      contentType: contentVersions.contentType,
      sourceRef: contentVersions.sourceRef,
      versionNo: contentVersions.versionNo,
      status: contentVersions.status,
      publicationState: contentVersions.publicationState,
      title: contentVersions.title,
      track: contentVersions.track,
      // The revision's own target, so a projection whose OLDER snapshots predate a
      // metadata field can fall back to the row it describes (see lessonMetadataParts).
      targetId: contentVersions.targetId,
    })
    .from(contentVersions)
    .where(eq(contentVersions.id, versionId))
    .limit(1);
  if (!row) return null;

  const stored = await versionContent(versionId, executor);
  const projection = projectionFor(row.module, row.contentType);
  const problems: string[] = [];
  let parts: PreviewPart[] = [];

  // Executable material is withheld BEFORE anything else can look at it, so no code path
  // downstream — projection, serialization, a renderer — can reach the authored markup.
  const executable = carriesExecutableContent(stored);
  const canonical = executable ? null : stored;

  if (!isKnownModule(row.module) || !isKnownContentType(row.module, row.contentType)) problems.push("unknown_content_type");
  if (stored === null) problems.push("content_snapshot_missing");
  if (executable)
    problems.push("executable_content_not_previewable", "executable_content_redacted");

  if (projection && canonical !== null) {
    try {
      parts = await projection.build(canonical, executor, { targetId: row.targetId ?? null });
    } catch {
      // A projection that cannot read its own content is a core failure and says so.
      problems.push("projection_failed");
      parts = [];
    }
  } else if (!projection && !executable) {
    problems.push("preview_not_implemented");
  }

  // The executable case gets one honest notice part: staff are told the material exists
  // and that previewing it is the sandbox surface's job, not this one's.
  if (executable && projection)
    parts = [{ key: "executable_runtime", label: "Executable material", kind: "notice", value: null, problem: "executable_runtime_not_previewable" }];

  for (const part of parts) if (part.problem) problems.push(`${part.key}:${part.problem}`);

  const presentKeys = new Set(parts.map((part) => part.key));
  const missingCore = (projection?.requiredParts ?? []).filter((key) => !presentKeys.has(key));
  if (missingCore.length) problems.push(...missingCore.map((key) => `missing_core:${key}`));

  const status: PreviewRegionStatus =
    !projection || executable || canonical === null || problems.some((problem) => problem.startsWith("missing_core") || problem === "content_snapshot_missing" || problem === "preview_not_implemented")
      ? "MISSING"
      : problems.length > 0
        ? "PARTIAL"
        : "PREVIEW_READY";

  return {
    identity: {
      module: row.module,
      contentType: row.contentType,
      sourceRef: row.sourceRef,
      contentKey: contentTypeKey(row.module, row.contentType),
      versionId: row.id,
      versionNo: row.versionNo,
      versionIdentity: versionIdentity(row),
      status: row.status,
      publicationState: row.publicationState,
      track: row.track,
      title: row.title,
    },
    canonical,
    parts,
    answerKeyVisible: true,
    problems,
    status,
  };
}

/** Preview the newest revision of an item — what the authoring workspace opens. */
export async function previewLatestRevision(module: string, contentType: string, sourceRef: string, executor: VersionReader = db): Promise<ContentPreview | null> {
  const latest = await latestVersion(module, contentType, sourceRef, executor);
  if (!latest) return null;
  return previewContentVersion(latest.id, executor);
}
