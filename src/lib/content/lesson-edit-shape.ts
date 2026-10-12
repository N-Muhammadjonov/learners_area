import type { LessonBlockInput } from "@/lib/content/blocks";

/**
 * THE EDITABLE LESSON BLOCK — the shape the authoring desk hydrates a lesson into,
 * and the exact mapping from that shape back to the authored payload.
 *
 * It lives in its own module, apart from the database projection that produces it,
 * for one reason: the desk is a CLIENT component and the projection reads Postgres.
 * Extracting the shape and its payload mapping here means the editor and the server
 * describe a block EXACTLY once — there is no second, drifting copy of the block
 * vocabulary on the client, and nothing in this file reads storage, decides validity
 * or knows about publication. Validity stays where it always was: `blocks.ts`.
 */

/** A block as the editor edits it: the authored shape, with its media metadata intact. */
export type EditableLessonBlock = {
  type: string;
  text: string | null;
  url: string | null;
  objectKey: string | null;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  ref: { module: string; contentType: string; sourceRef: string; versionId?: string | null } | null;
  quiz: { questionType: string; prompt: string; options: string[] | null; answer: string; explanation: string | null } | null;
};

export const EMPTY_QUIZ = {
  questionType: "mcq_single",
  prompt: "",
  options: null as string[] | null,
  answer: "",
  explanation: null as string | null,
};

/** Editable block → the authored payload the lesson author validates and stores. */
export function blockPayload(block: EditableLessonBlock): LessonBlockInput {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text ?? "" };
    case "link":
      return { type: "link", text: block.text ?? null, url: block.url ?? "" };
    case "image":
    case "audio":
    case "video":
    case "file":
      return {
        type: block.type,
        objectKey: block.objectKey ?? null,
        originalName: block.originalName ?? null,
        mimeType: block.mimeType ?? null,
        size: block.size ?? null,
      };
    case "quiz":
      return {
        type: "quiz",
        quiz: {
          questionType: block.quiz?.questionType ?? EMPTY_QUIZ.questionType,
          prompt: block.quiz?.prompt ?? "",
          options: block.quiz?.options ?? null,
          answer: block.quiz?.answer ?? "",
          explanation: block.quiz?.explanation ?? null,
        },
      };
    case "content_reference":
      return {
        type: "content_reference",
        ref: block.ref
          ? { module: block.ref.module, contentType: block.ref.contentType, sourceRef: block.ref.sourceRef, versionId: block.ref.versionId ?? null }
          : null,
      };
    default:
      return { type: block.type };
  }
}
