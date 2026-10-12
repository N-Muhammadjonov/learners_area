import { questionType, resolveQuestionType } from "@/lib/content/question-types";

/**
 * THE CANONICAL IDENTITY OF A LISTENING QUESTION — decided once, at the boundary where source
 * material becomes stored content.
 *
 * WHY THIS MODULE EXISTS. The registry has always had two operations, and they are not the same
 * operation: `questionType(id)` looks up a CANONICAL type, `resolveQuestionType(alias)` turns a
 * SOURCE ALIAS into one. Canonical STORAGE must converge on the canonical id — a row that keeps
 * storing "mcq" forces every renderer and grader to understand both spellings forever — but the
 * canonical Listening import did not converge at all: it wrote `type_code = NULL` and hand-rolled
 * the coarse enum from `options.length`, so
 *
 *   • a COMPLETION question that carried an options list (a word bank, a hint list) was stored as
 *     `multiple_choice` — the "options ⇒ MCQ" mistake, at the storage layer, where no registry
 *     lookup downstream could recover the truth because there was no type code to look up;
 *   • a MATCHING question was stored with the same coarse bucket as a typed answer;
 *   • a MAP / PLAN question was stored as `multiple_choice`, which is exactly the owner's
 *     forbidden "Q11–14 become MCQ";
 *   • and nothing could be recorded for the specific completion kinds, so the answer MODEL of an
 *     imported question was a coin flip rather than a decision.
 *
 * THE TWO RULES, STATED ONCE:
 *
 *   1. A SOURCE THAT NAMES ITS TYPE KEEPS ITS TYPE. If the material says `note_completion`,
 *      `plan_labeling` or `mcq_multi`, that exact canonical id is stored — first as a canonical id,
 *      then as a source alias, through the same two doors the rest of the product uses. Nothing is
 *      upgraded, downgraded or "simplified".
 *   2. A SOURCE THAT ONLY GROUPS ITS TYPE IS NOT GUESSED AT. A source that says only "completion"
 *      has NOT proved whether it is form / note / table / flow-chart / summary / sentence
 *      completion, and a source that says only "map" has not proved whether it is a map or a plan.
 *      Those two cases resolve to the LEAST SPECIFIC canonical type that is still true — a typed
 *      answer (`short_answer`, the same answer model every completion subtype shares) and the
 *      registry's map type — and are REPORTED for staff review instead of being silently invented.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it never adds a generic `completion` canonical type
 * (which would destroy the precision the registry exists to keep), never treats a canonical id as
 * an alias, never infers `mcq_multi` from an activity name, and never invents a `map_plan` type
 * because an activity card is called "Map / Plan Mastery".
 */

/** The coarse shape a package question declares — the vocabulary of the stored payload. */
export const LISTENING_QUESTION_KINDS = ["completion", "mcq", "matching", "map"] as const;
export type ListeningQuestionKind = (typeof LISTENING_QUESTION_KINDS)[number];

/** The storage enum a question row is persisted with (a module-level compatibility bucket). */
export type ListeningStorageType = "multiple_choice" | "short_answer";

/**
 * The canonical Listening types that ARE genuine multiple choice. The stored `multiple_choice`
 * enum is read by the MCQ surfaces as "this row is an MCQ" (`listMcqQuestions` filters on it), so
 * this set — not the row's option pool — is what may ever be stored under it: a matching or
 * map/plan question carries an option pool too, and filing one there would put it in MCQ Mastery.
 */
const MCQ_TYPES: readonly string[] = ["mcq_single", "mcq_multi"];

/**
 * Which coarse package kind a canonical Listening type belongs to.
 *
 * Written out rather than derived, because the registry does NOT carry this axis: `matching`,
 * `classification`, `map_labeling` and `plan_labeling` are indistinguishable by answer model,
 * accessibility or grouping — they are all "choose a label from a shared pool". Deriving the kind
 * from those fields would therefore be a guess dressed as a lookup.
 *
 * `questionTypesFor("listening")` is asserted EXHAUSTIVE against this table by the test suite, so
 * a newly registered Listening type cannot silently escape it: adding one fails the test until
 * someone states which kind it is.
 */
const KIND_BY_TYPE: Record<string, ListeningQuestionKind> = {
  // A typed answer. The generic `short_answer` is the honest home for a source that only said
  // "completion" — every completion subtype shares this answer model.
  short_answer: "completion",
  form_completion: "completion",
  note_completion: "completion",
  table_completion: "completion",
  flow_chart_completion: "completion",
  summary_completion: "completion",
  sentence_completion: "completion",
  // Genuine multiple choice, single or choose-two/three.
  mcq_single: "mcq",
  mcq_multi: "mcq",
  // A label chosen from a shared pool over items that are matched to it.
  matching: "matching",
  classification: "matching",
  // A label placed on a drawing: the same answer model for map, plan and diagram.
  map_labeling: "map",
  plan_labeling: "map",
  diagram_labeling: "map",
};

/** The coarse kind of a canonical type id, or null when the registry does not know it. */
export function listeningKindOfType(typeId: string): ListeningQuestionKind | null {
  return KIND_BY_TYPE[typeId] ?? null;
}

/** Every registered Listening type, for the exhaustiveness guard. */
export function listeningKindMap(): Readonly<Record<string, ListeningQuestionKind>> {
  return KIND_BY_TYPE;
}

/** Resolve a source's own statement (a canonical id OR a source alias) — never a guess. */
export function canonicalListeningTypeId(stated: string | null | undefined): string | null {
  if (!stated) return null;
  return questionType(stated, "listening")?.id ?? resolveQuestionType(stated, "listening")?.id ?? null;
}

export type ListeningQuestionIdentity = {
  /**
   * The CANONICAL id to store. Null only when the source proved nothing at all — the row then
   * keeps the legacy fallback and is reported for review.
   */
  typeCode: string | null;
  /** The compatibility enum. `multiple_choice` ONLY for genuine MCQ types. */
  storageType: ListeningStorageType;
  /** What staff must confirm because the source did not prove it. Null when nothing is unproven. */
  review: string | null;
};

/**
 * The canonical identity of ONE package question.
 *
 * `question.typeCode` is the source's own specific type (when the package carries one);
 * `question.kind` is the coarse shape it declared.
 */
export function listeningQuestionIdentity(question: {
  kind?: string | null;
  typeCode?: string | null;
}): ListeningQuestionIdentity {
  const stated = canonicalListeningTypeId(question.typeCode);
  if (stated) {
    // The source named a type the registry knows: store exactly that. No review note, because
    // nothing about the item's identity is unknown.
    return { typeCode: stated, storageType: MCQ_TYPES.includes(stated) ? "multiple_choice" : "short_answer", review: null };
  }

  // The source named something we could not resolve (a spellings we do not know, or a raw
  // category like "completion"): fall back to what that statement PROVES, and say so.
  const unresolvable = (question.typeCode ?? "").trim();
  switch (question.kind) {
    case "completion":
      return {
        typeCode: "short_answer",
        storageType: "short_answer",
        review: unresolvable
          ? `the source declares question type "${unresolvable}", which is not a canonical Listening type; it is stored as a typed answer (short_answer) — confirm whether it is form/note/table/flow-chart/summary/sentence completion`
          : "the source states only \"completion\", which does not prove which completion kind this is; it is stored as a typed answer (short_answer) — confirm the specific kind",
      };
    case "mcq":
      return {
        typeCode: "mcq_single",
        storageType: "multiple_choice",
        review: unresolvable
          ? `the source declares question type "${unresolvable}"; it is stored as single-answer multiple choice — confirm the item is not a choose-TWO/THREE (mcq_multi)`
          : null,
      };
    case "matching":
      return { typeCode: "matching", storageType: "short_answer", review: null };
    case "map":
      return {
        typeCode: "map_labeling",
        storageType: "short_answer",
        review:
          "the source groups this item as map/plan, which does not prove whether the drawing is a map or a plan; it is stored as map_labeling — confirm map_labeling vs plan_labeling",
      };
    default:
      return {
        typeCode: null,
        storageType: "short_answer",
        review: unresolvable
          ? `the source declares question type "${unresolvable}", which is not a canonical Listening type, and no shape proves one; the question has no canonical identity yet`
          : "the source declares neither a question type nor a shape this product recognises; the question has no canonical identity yet",
      };
  }
}


/**
 * The review notes of a whole question list, each naming the questions it applies to.
 *
 * Used by BOTH doors that must not be silent: the import (which returns them as import warnings, so
 * an under-specified source is visible to the staff who receive the material) and the staff preview
 * (which prints them beside the type summary). One implementation, so the two surfaces can never
 * disagree about what is unproven.
 */
export function listeningIdentityReviewNotes(
  questions: readonly { number: number; kind?: string | null; typeCode?: string | null }[],
): string[] {
  const notes = new Map<string, number[]>();
  for (const question of questions) {
    const { review } = listeningQuestionIdentity(question);
    if (!review) continue;
    notes.set(review, [...(notes.get(review) ?? []), question.number]);
  }
  return [...notes.entries()].map(([note, numbers]) => `Q${numbers.join(", Q")}: ${note}.`);
}

/**
 * The canonical type summary of a question list: which type, how many.
 *
 * For the staff who validate material and for any surface that describes a set. A question whose
 * specific type the source did not prove is summarised by its coarse kind — the strongest statement
 * the source supports — and never by a guess at a specific type.
 */
export function listeningTypeSummary(
  questions: readonly { kind?: string | null; typeCode?: string | null }[],
): { typeId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const { typeCode, review } = listeningQuestionIdentity(question);
    const key = review ? question.kind ?? "unclassified" : typeCode ?? question.kind ?? "unclassified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([typeId, count]) => ({ typeId, count }));
}
