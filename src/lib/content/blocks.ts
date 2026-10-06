import { moduleDescriptor, referenceProblems } from "@/lib/content/taxonomy";
import { answerShapeIssues, gradeForType, questionType, type GradingInput, type GradingResult } from "@/lib/content/question-types";

/**
 * LESSON BLOCKS — the typed contract that decides what a lesson may contain (§26).
 *
 * A lesson is a sequence of typed native blocks. It is deliberately NOT a place
 * where arbitrary markup is stored and later executed:
 *
 *   - `text` is PLAIN TEXT. There is no HTML block, so a lesson cannot ship a
 *     script, an iframe or an event handler, and `sanitize-html` is not the only
 *     thing standing between an author and a learner's browser.
 *   - `link` must be an absolute https URL. `javascript:`, `data:` and
 *     protocol-relative URLs are refused at the contract, not at render time.
 *   - `file`/`image`/`audio`/`video` carry a PRIVATE storage key (the object goes
 *     through the existing upload-intent pipeline and is served through the
 *     existing authenticated resource route), never an author-supplied remote URL.
 *   - `quiz` names a canonical question type and its answer model; grading is
 *     `gradeForType`, so a lesson quiz and an exam question cannot disagree.
 *   - `content_reference` points at canonical content — by source ref, optionally
 *     pinned to an exact revision — and copies nothing.
 *
 * This module is pure: no database, no React, safe on the client, and it is the
 * single source of truth used by the authoring service, the learner reader and the
 * tests.
 */

export const LESSON_BLOCK_TYPES = ["text", "image", "audio", "video", "file", "link", "quiz", "content_reference"] as const;
export type LessonBlockType = (typeof LESSON_BLOCK_TYPES)[number];

export type LessonBlockInput = {
  type: LessonBlockType | string;
  /** text */
  text?: string | null;
  /** link */
  url?: string | null;
  /** file | image | audio | video — a storage key owned by an upload intent */
  objectKey?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  /** content_reference */
  ref?: { module: string; contentType: string; sourceRef: string; versionId?: string | null } | null;
  /** quiz */
  quiz?: { questionType: string; prompt: string; options?: string[] | null; answer: unknown; explanation?: string | null } | null;
};

export type LessonBlockIssue = { code: string; message: string; position?: number; field?: string };

const MAX_TEXT = 20000;
const MAX_PROMPT = 2000;
const HTTPS = /^https:\/\/[^\s]+$/i;

/** Per-type presentation contract: what a renderer may assume, and what is refused. */
export type LessonBlockDescriptor = {
  type: LessonBlockType;
  label: string;
  /** Fields this type uses. Anything else carries no meaning and is not stored. */
  fields: string[];
  /** Does this type point at canonical content instead of carrying it? */
  referencesContent: boolean;
  /** Does it carry a question that must be graded through the registry? */
  graded: boolean;
  /** Learner-visible meaning, used for the accessibility contract (§83). */
  accessibility: string;
};

export const LESSON_BLOCK_DESCRIPTORS: Record<LessonBlockType, LessonBlockDescriptor> = {
  text: {
    type: "text",
    label: "Text",
    fields: ["text"],
    referencesContent: false,
    graded: false,
    accessibility: "Rendered as plain paragraphs; markup in the authored text is not interpreted.",
  },
  image: {
    type: "image",
    label: "Image",
    fields: ["objectKey", "originalName", "mimeType", "size"],
    referencesContent: false,
    graded: false,
    accessibility: "Requires alt text authored as a following text block; images are never the only carrier of meaning.",
  },
  audio: {
    type: "audio",
    label: "Audio",
    fields: ["objectKey", "originalName", "mimeType", "size"],
    referencesContent: false,
    graded: false,
    accessibility: "Always has a transcript or a text block beside it; native audio controls are keyboard reachable.",
  },
  video: {
    type: "video",
    label: "Video",
    fields: ["objectKey", "originalName", "mimeType", "size"],
    referencesContent: false,
    graded: false,
    accessibility: "Native video controls; captions come from the media itself, and a text block carries the summary.",
  },
  file: {
    type: "file",
    label: "File",
    fields: ["objectKey", "originalName", "mimeType", "size"],
    referencesContent: false,
    graded: false,
    accessibility: "Download link states the file name and type; served through the authenticated resource route.",
  },
  link: {
    type: "link",
    label: "External link",
    fields: ["url", "text"],
    referencesContent: false,
    graded: false,
    accessibility: "Absolute https URL with a text label; opens outside the lesson chrome.",
  },
  quiz: {
    type: "quiz",
    label: "Quiz question",
    fields: ["quiz"],
    referencesContent: false,
    graded: true,
    accessibility: "One canonical question type per block; options are labelled A, B, C… and never distinguished by colour alone.",
  },
  content_reference: {
    type: "content_reference",
    label: "Canonical content",
    fields: ["ref"],
    referencesContent: true,
    graded: false,
    accessibility: "Renders the referenced canonical material through its own module renderer; nothing is copied into the lesson.",
  },
};

function isBlockType(value: string): value is LessonBlockType {
  return (LESSON_BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * Validate a block list. Every issue names its position, because a lesson author
 * fixes the fifth block, not "the payload".
 */
export function validateLessonBlocks(blocks: LessonBlockInput[]): LessonBlockIssue[] {
  const issues: LessonBlockIssue[] = [];
  const positions = new Map<number, number>();

  blocks.forEach((block, index) => {
    const position = index + 1;
    if (!isBlockType(block.type)) {
      issues.push({ code: "unknown_block_type", message: `Unknown block type "${block.type}".`, position, field: "type" });
      return;
    }
    positions.set(position, (positions.get(position) ?? 0) + 1);

    switch (block.type) {
      case "text": {
        const text = block.text ?? "";
        if (!text.trim()) issues.push({ code: "missing_text", message: "A text block needs text.", position, field: "text" });
        else if (text.length > MAX_TEXT) issues.push({ code: "text_too_long", message: `Text blocks are limited to ${MAX_TEXT} characters.`, position, field: "text" });
        break;
      }
      case "link": {
        const url = (block.url ?? "").trim();
        if (!url) issues.push({ code: "missing_url", message: "A link block needs a URL.", position, field: "url" });
        else if (!HTTPS.test(url))
          issues.push({ code: "insecure_url", message: "Links must be absolute https URLs (no javascript:, data: or relative targets).", position, field: "url" });
        break;
      }
      case "image":
      case "audio":
      case "video":
      case "file": {
        if (!block.objectKey?.trim())
          issues.push({
            code: "missing_object_key",
            message: `A ${block.type} block needs an uploaded object; media is served from private storage, not from a URL.`,
            position,
            field: "objectKey",
          });
        break;
      }
      case "quiz": {
        const quiz = block.quiz;
        if (!quiz || !quiz.prompt?.trim())
          issues.push({ code: "missing_prompt", message: "A quiz block needs a prompt.", position, field: "quiz.prompt" });
        if (!quiz || !quiz.questionType?.trim()) {
          issues.push({ code: "missing_question_type", message: "A quiz block must name a canonical question type.", position, field: "quiz.questionType" });
          break;
        }
        const type = questionType(quiz.questionType);
        if (!type) {
          issues.push({ code: "unknown_question_type", message: `Unknown question type "${quiz.questionType}".`, position, field: "quiz.questionType" });
          break;
        }
        if (quiz.prompt.length > MAX_PROMPT)
          issues.push({ code: "prompt_too_long", message: `Prompts are limited to ${MAX_PROMPT} characters.`, position, field: "quiz.prompt" });
        for (const issue of answerShapeIssues(type.id, { key: typeof quiz.answer === "string" ? quiz.answer : undefined, options: quiz.options ?? undefined }))
          issues.push({ code: issue.code, message: issue.message, position, field: "quiz.answer" });
        break;
      }
      case "content_reference": {
        const ref = block.ref;
        if (!ref) {
          issues.push({ code: "missing_reference", message: "A content reference needs a target.", position, field: "ref" });
          break;
        }
        const descriptor = moduleDescriptor(ref.module);
        if (descriptor && !descriptor.contentTypes.includes(ref.contentType))
          issues.push({
            code: "unknown_content_type",
            message: `"${ref.contentType}" is not a content type of the ${descriptor.label} module.`,
            position,
            field: "ref.contentType",
          });
        for (const problem of referenceProblems(
          { module: ref.module, contentType: ref.contentType, sourceRef: ref.sourceRef, versionId: ref.versionId ?? null },
          { requireVersion: false },
        ))
          issues.push({ code: problem.code, message: problem.message, position, field: "ref" });
        break;
      }
    }
  });

  // The storage contract is one position per slot; catch it before the database does.
  for (const [position, count] of positions)
    if (count > 1) issues.push({ code: "duplicate_position", message: `Position ${position} is used more than once.`, position });
  return issues;
}

/** A lesson may not be published without at least one block (an empty lesson teaches nothing). */
export function validateLessonForPublication(blocks: LessonBlockInput[]): LessonBlockIssue[] {
  const issues = validateLessonBlocks(blocks);
  if (blocks.length === 0) issues.push({ code: "empty_lesson", message: "A lesson needs at least one block before it can be published." });
  return issues;
}

/**
 * Grade a quiz answer through the canonical registry. Never a second grader:
 * a lesson quiz and an exam question with the same type get the same verdict.
 */
export function gradeLessonQuiz(questionTypeId: string, input: GradingInput): (GradingResult & { typeId: string }) | null {
  const type = questionType(questionTypeId);
  if (!type) return null;
  return { ...gradeForType(type, input), typeId: type.id };
}

/** The canonical answer model a quiz block's payload means, for the reader and the editor. */
export type QuizBlockContract = {
  questionTypeId: string;
  /** Which module the type belongs to, so a Listening quiz is not graded as Reading. */
  module: string;
  storageType: "multiple_choice" | "short_answer";
  requiresOptions: boolean;
  accessibility: string;
  review: string;
};

export function quizContract(questionTypeId: string): QuizBlockContract | null {
  const type = questionType(questionTypeId);
  if (!type) return null;
  return {
    questionTypeId: type.id,
    module: type.module,
    storageType: type.storageType,
    requiresOptions: type.storageType === "multiple_choice",
    accessibility: type.accessibility,
    review: type.review,
  };
}
