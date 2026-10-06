import { gradeAnswer } from "@/lib/services/reading/grading";
import type { ContentModule } from "./taxonomy";

/**
 * The canonical QUESTION-TYPE REGISTRY.
 *
 * Before this file, question behaviour was implicit: the Reading table had four
 * enum values (the source's TFNG/YNNG/MCQ/MH/MI/MF/MSE/DIAG/SC/NOTE/FLOW all
 * collapsed into them), Listening had two, and grading was one generic string
 * match. Adding a type meant editing a component.
 *
 * Here a type is declared once with everything the rest of the system needs:
 *
 *   id              canonical type id (stable; no spaces)
 *   module          which module owns it
 *   label           human name used in authoring, filters and review
 *   answerModel     the SHAPE of a correct answer (choice / ternary / text / labels / multi)
 *   grading         how a learner answer is judged (see `gradeForType`)
 *   importShapes    the aliases a source file may use for this type
 *   group           does it belong to a shared-stimulus group?
 *   accessibility   what a screen reader needs from the renderer
 *   review          what review may show after the attempt is eligible
 *
 * No renderer-specific CSS, no React, no database: this module is data plus pure
 * grading, so an importer, a migration tool and the exam component can all use the
 * same truth.
 */

/** Count "words" the way IELTS does: whitespace-separated tokens, hyphenated compounds stay one word. */
export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export type AnswerModel =
  /** Exactly one of a fixed choice set (TRUE/FALSE/NOT GIVEN, A/B/C/D). */
  | { kind: "ternary"; choices: string[] }
  | { kind: "choice"; min: number; max: number }
  /** Several choices, all required (MCQ-multi, choose-two). */
  | { kind: "choice_multi"; count: number }
  /** Free text with an optional word limit. */
  | { kind: "text"; wordLimit: number | null }
  /** A label/letter chosen from a shared option pool (matching, headings, map, plan). */
  | { kind: "labels"; poolRequired: boolean };

export type GradingStrategy =
  | "choice_exact"
  | "text_normalized"
  | "text_word_limit"
  | "multi_all"
  | "label_letter_equivalent";

export type QuestionTypeDescriptor = {
  id: string;
  module: ContentModule;
  label: string;
  answerModel: AnswerModel;
  grading: GradingStrategy;
  /** Source-file aliases (the `typeCode` values real packages carry). */
  importShapes: string[];
  /** True when the question shares one stimulus/option pool with its group. */
  group: boolean;
  accessibility: "radio_group" | "checkbox_group" | "labelled_text_input" | "select_from_pool";
  review: "answer" | "answer_and_evidence" | "answer_evidence_and_stimulus";
  /** The module-level storage enum this type is persisted as today (compatibility). */
  storageType: "multiple_choice" | "short_answer";
};

const TFNG_CHOICES = ["TRUE", "FALSE", "NOT GIVEN"];
const YNNG_CHOICES = ["YES", "NO", "NOT GIVEN"];

/** Declaration helper: keeps every entry's shape checked at the definition site. */
function defineQuestionType(descriptor: QuestionTypeDescriptor): QuestionTypeDescriptor {
  return descriptor;
}

/* -------------------------------------------------------------------------- */
/* Listening                                                                  */
/* -------------------------------------------------------------------------- */

const LISTENING_TYPES: QuestionTypeDescriptor[] = [
  defineQuestionType({
    id: "mcq_single",
    module: "listening",
    label: "Multiple choice (single answer)",
    answerModel: { kind: "choice", min: 2, max: 8 },
    grading: "choice_exact",
    importShapes: ["mcq", "multiple_choice", "MCQ"],
    group: false,
    accessibility: "radio_group",
    review: "answer_and_evidence",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "mcq_multi",
    module: "listening",
    label: "Multiple choice (two or three answers)",
    answerModel: { kind: "choice_multi", count: 2 },
    grading: "multi_all",
    importShapes: ["mcq_multi", "MCQ_MULTI", "choose_two", "choose_three"],
    group: false,
    accessibility: "checkbox_group",
    review: "answer_and_evidence",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "matching",
    module: "listening",
    label: "Matching",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["matching", "MATCHING"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "classification",
    module: "listening",
    label: "Classification",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["classification", "CLASSIFICATION"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "form_completion",
    module: "listening",
    label: "Form completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["form", "form_completion", "FORM"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_and_evidence",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "note_completion",
    module: "listening",
    label: "Note completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["note", "NOTE", "notes_completion", "note_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "table_completion",
    module: "listening",
    label: "Table completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["table", "TABLE", "table_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "flow_chart_completion",
    module: "listening",
    label: "Flow-chart completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["flow", "flowchart", "FLOW", "flow_chart_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "summary_completion",
    module: "listening",
    label: "Summary completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["summary", "SUMMARY", "summary_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "sentence_completion",
    module: "listening",
    label: "Sentence completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["sentence", "SC", "sentence_completion"],
    group: false,
    accessibility: "labelled_text_input",
    review: "answer_and_evidence",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "short_answer",
    module: "listening",
    label: "Short answer",
    answerModel: { kind: "text", wordLimit: 4 },
    grading: "text_normalized",
    importShapes: ["short_answer", "saq", "SAQ"],
    group: false,
    accessibility: "labelled_text_input",
    review: "answer_and_evidence",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "plan_labeling",
    module: "listening",
    label: "Plan labelling",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["plan", "PLAN", "plan_labeling", "plan_labelling"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "map_labeling",
    module: "listening",
    label: "Map labelling",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["map", "MAP", "map_labeling", "map_labelling"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "diagram_labeling",
    module: "listening",
    label: "Diagram labelling",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["diagram", "DIAG", "diagram_labeling", "diagram_labelling"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
];

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

const READING_TYPES: QuestionTypeDescriptor[] = [
  defineQuestionType({
    id: "true_false_not_given",
    module: "reading",
    label: "TRUE / FALSE / NOT GIVEN",
    answerModel: { kind: "ternary", choices: TFNG_CHOICES },
    grading: "choice_exact",
    importShapes: ["TFNG", "true_false_not_given", "true_false_ng"],
    group: false,
    accessibility: "radio_group",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "yes_no_not_given",
    module: "reading",
    label: "YES / NO / NOT GIVEN",
    answerModel: { kind: "ternary", choices: YNNG_CHOICES },
    grading: "choice_exact",
    importShapes: ["YNNG", "yes_no_not_given", "yes_no_ng"],
    group: false,
    accessibility: "radio_group",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "multiple_choice",
    module: "reading",
    label: "Multiple choice",
    answerModel: { kind: "choice", min: 2, max: 5 },
    grading: "choice_exact",
    importShapes: ["MCQ", "multiple_choice"],
    group: false,
    accessibility: "radio_group",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "multiple_choice_multi",
    module: "reading",
    label: "Multiple choice (two answers)",
    answerModel: { kind: "choice_multi", count: 2 },
    grading: "multi_all",
    importShapes: ["MCQ_MULTI", "multiple_choice_multi"],
    group: false,
    accessibility: "checkbox_group",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "matching_headings",
    module: "reading",
    label: "Matching headings",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["MH", "matching_headings"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "matching_information",
    module: "reading",
    label: "Matching information",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["MI", "matching_information"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "matching_features",
    module: "reading",
    label: "Matching features",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["MF", "matching_features"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "matching_sentence_endings",
    module: "reading",
    label: "Matching sentence endings",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["MSE", "matching_sentence_endings"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
  defineQuestionType({
    id: "sentence_completion",
    module: "reading",
    label: "Sentence completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["SC", "sentence_completion"],
    group: false,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "summary_completion",
    module: "reading",
    label: "Summary completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["summary", "SUMMARY", "summary_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "note_completion",
    module: "reading",
    label: "Note completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["NOTE", "note_completion", "notes"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "table_completion",
    module: "reading",
    label: "Table completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["table", "TABLE", "table_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "flow_chart_completion",
    module: "reading",
    label: "Flow-chart completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["FLOW", "flow_chart_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "diagram_label_completion",
    module: "reading",
    label: "Diagram label completion",
    answerModel: { kind: "text", wordLimit: 3 },
    grading: "text_word_limit",
    importShapes: ["DIAG", "diagram_label_completion"],
    group: true,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "short_answer",
    module: "reading",
    label: "Short answer",
    answerModel: { kind: "text", wordLimit: 4 },
    grading: "text_normalized",
    importShapes: ["SAQ", "short_answer"],
    group: false,
    accessibility: "labelled_text_input",
    review: "answer_evidence_and_stimulus",
    storageType: "short_answer",
  }),
  defineQuestionType({
    id: "classification",
    module: "reading",
    label: "Classification",
    answerModel: { kind: "labels", poolRequired: true },
    grading: "label_letter_equivalent",
    importShapes: ["CLASSIFICATION", "classification"],
    group: true,
    accessibility: "select_from_pool",
    review: "answer_evidence_and_stimulus",
    storageType: "multiple_choice",
  }),
];

export const QUESTION_TYPES: QuestionTypeDescriptor[] = [...LISTENING_TYPES, ...READING_TYPES];

/** Lookup by canonical id, optionally constrained to one module. */
export function questionType(id: string, module?: string): QuestionTypeDescriptor | undefined {
  const normalised = id.trim().toLowerCase();
  return QUESTION_TYPES.find(
    (entry) => entry.id === normalised && (!module || entry.module === module),
  );
}

export function questionTypesFor(module: string): QuestionTypeDescriptor[] {
  return QUESTION_TYPES.filter((entry) => entry.module === module);
}

/**
 * Resolve a source alias (`typeCode` in an imported Reading set, `kind` in a
 * Listening package) to a canonical type. An alias may belong to only one module
 * when a module is given; without a module, an ambiguous alias resolves only when
 * it is unique across all modules.
 */
export function resolveQuestionType(alias: string, module?: string): QuestionTypeDescriptor | undefined {
  const wanted = alias.trim();
  if (!wanted) return undefined;
  const candidates = QUESTION_TYPES.filter((entry) => {
    if (module && entry.module !== module) return false;
    return entry.importShapes.some((shape) => shape.toLowerCase() === wanted.toLowerCase());
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

export type GradingInput = {
  /** What the learner produced (a raw input value or a chosen option). */
  answer: string;
  /** The canonical key. */
  key: string;
  /** Every string the source itself lists as acceptable. */
  accepted?: string[];
  /** Correct answers for a multi-answer question. */
  keys?: string[];
  /** Option list, when the type presents choices. */
  options?: string[];
};

export type GradingResult = {
  correct: boolean;
  /** Which rule decided it — shown in review, never a mystery. */
  rule: GradingStrategy;
  /** Set when an answer was rejected for a reason worth teaching (e.g. word limit). */
  violation?: "word_limit" | "not_all_selected";
};

/* A choice's identity: labels (A–J, i–x) and their text. */
const ROMAN_OR_LETTER = "(?:i{1,3}|iv|v|vi{1,3}|ix|x|[a-j])";
/** "A) text" / "B - text" / "ii. text" — a label, a separator, then the label's own text. */
const LABELLED = new RegExp(`^(${ROMAN_OR_LETTER})\\s*[-–—.):]\\s*(.*)$`, "i");
/** A bare label on its own: "B", "ii". */
const BARE_LABEL = new RegExp(`^${ROMAN_OR_LETTER}$`, "i");

function normaliseChoice(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A choice is a LABEL plus its text, and either half may be the thing the source
 * stored. Roman numerals matter here: "ii. Decline" and "iii. Revival" are
 * different answers, so the label is the roman token, never its first letter.
 */
function choiceShape(value: string): { label: string | null; text: string } {
  const trimmed = value.trim();
  const labelled = LABELLED.exec(trimmed);
  if (labelled) return { label: labelled[1]!.toLowerCase(), text: normaliseChoice(labelled[2]!) };
  if (BARE_LABEL.test(trimmed)) return { label: trimmed.toLowerCase(), text: "" };
  return { label: null, text: normaliseChoice(trimmed) };
}

/** The label of the option whose text is `text`, so "B" can answer "B) the museum". */
function optionLabelFor(options: string[], text: string): string | null {
  for (const option of options) {
    const shape = choiceShape(option);
    if (shape.label && shape.text === text) return shape.label;
  }
  return null;
}

/**
 * Two answers are the same choice when their labels agree, or when their texts
 * agree, or when one names a label and the other names that label's text.
 * Nothing fuzzier: a paragraph name is not a heading, and "museum" is not
 * "the museum".
 */
function choiceMatches(answer: string, key: string, options: string[]): boolean {
  const left = choiceShape(answer);
  const right = choiceShape(key);
  if (!left.label && !left.text) return false;
  if (left.label && right.label) return left.label === right.label;
  if (left.text && right.text) return left.text === right.text;
  if (left.label && right.text) return optionLabelFor(options, right.text) === left.label;
  if (!left.label && left.text && right.label) return optionLabelFor(options, left.text) === right.label;
  return false;
}

/**
 * Grade one question. This is the single place question behaviour is decided, so a
 * renderer and an importer can never disagree about what "correct" means.
 *
 * Text answers reuse the existing Reading matcher (`src/lib/services/reading/grading`)
 * rather than introducing a second normalisation: case, spacing, dashes,
 * underscores and a trailing full stop are insignificant there, and the source's
 * own accepted list is honoured.
 */
export function gradeForType(type: QuestionTypeDescriptor, input: GradingInput): GradingResult {
  const options = input.options ?? [];
  switch (type.grading) {
    case "choice_exact": {
      if (type.answerModel.kind === "ternary") {
        const choices = type.answerModel.choices;
        const normalised = normaliseChoice(input.answer).replace(/_/g, " ").toUpperCase();
        const key = normaliseChoice(input.key).replace(/_/g, " ").toUpperCase();
        const canonical = choices.find((choice) => choice === normalised) ?? null;
        return { correct: Boolean(canonical) && canonical === key, rule: type.grading };
      }
      return { correct: choiceMatches(input.answer, input.key, options), rule: type.grading };
    }
    case "label_letter_equivalent":
      return {
        correct: choiceMatches(input.answer, input.key, options) || gradeAnswer(input.answer, input.key, input.accepted ?? []),
        rule: type.grading,
      };
    case "multi_all": {
      const required = (input.keys ?? [input.key]).map((entry) => normaliseChoice(entry)).filter(Boolean);
      const provided = input.answer.split(/[,;]| and /i).map((entry) => entry.trim()).filter(Boolean);
      const unmatched = [...required];
      for (const entry of provided) {
        const index = unmatched.findIndex((expected) => choiceMatches(entry, expected, options));
        if (index >= 0) unmatched.splice(index, 1);
      }
      const correct = required.length > 0 && unmatched.length === 0 && provided.length >= required.length;
      return { correct, rule: type.grading, ...(correct ? {} : { violation: "not_all_selected" as const }) };
    }
    case "text_word_limit": {
      const limit = type.answerModel.kind === "text" ? type.answerModel.wordLimit : null;
      if (limit !== null && countWords(input.answer) > limit)
        return { correct: false, rule: type.grading, violation: "word_limit" };
      return { correct: gradeAnswer(input.answer, input.key, input.accepted ?? []), rule: type.grading };
    }
    case "text_normalized":
    default:
      return { correct: gradeAnswer(input.answer, input.key, input.accepted ?? []), rule: "text_normalized" };
  }
}

/** Convenience wrapper used by importers and review code. */
export function gradeByTypeId(typeId: string, input: GradingInput, module?: string): GradingResult | null {
  const type = questionType(typeId, module);
  return type ? gradeForType(type, input) : null;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type AnswerShapeIssue = { code: string; message: string };

/**
 * Level-2 validation for ONE question row (§48): does this row's answer shape
 * match the type it claims? Called by importers and by the admin question editor,
 * so a malformed row cannot reach a learner through either door.
 */
export function answerShapeIssues(
  typeId: string,
  row: {
    module?: string;
    text?: string;
    key?: string;
    options?: string[];
    accepted?: string[];
    wordLimit?: number | null;
    sharedOptions?: string[] | null;
  },
): AnswerShapeIssue[] {
  const type = questionType(typeId, row.module);
  if (!type) return [{ code: "unknown_type", message: `Unknown question type "${typeId}".` }];
  const issues: AnswerShapeIssue[] = [];
  const options = row.options ?? [];
  const key = (row.key ?? "").trim();

  switch (type.answerModel.kind) {
    case "ternary":
      if (!type.answerModel.choices.includes(key.trim().toUpperCase()))
        issues.push({
          code: "invalid_key",
          message: `${type.label}: the key must be one of ${type.answerModel.choices.join(", ")}.`,
        });
      if (options.length)
        issues.push({ code: "options_not_allowed", message: `${type.label} draws its choices from the type, not from the row.` });
      break;
    case "choice":
      if (options.length < type.answerModel.min || options.length > type.answerModel.max)
        issues.push({
          code: "option_count",
          message: `${type.label} needs between ${type.answerModel.min} and ${type.answerModel.max} options (found ${options.length}).`,
        });
      if (options.length && key && !options.some((option) => choiceMatches(key, option, options)) && !/^[a-h]$/i.test(key))
        issues.push({ code: "key_not_an_option", message: `${type.label}: the key "${key}" is not one of the options.` });
      break;
    case "choice_multi":
      if (options.length < type.answerModel.count * 2)
        issues.push({
          code: "option_count",
          message: `${type.label} needs more options than answers (found ${options.length}).`,
        });
      break;
    case "labels": {
      const pool = row.sharedOptions ?? options;
      if (type.answerModel.poolRequired && !pool.length)
        issues.push({
          code: "pool_required",
          message: `${type.label} needs a shared option pool on its question group.`,
        });
      if (!key) issues.push({ code: "missing_key", message: `${type.label}: the key is empty.` });
      break;
    }
    case "text": {
      if (!key) issues.push({ code: "missing_key", message: `${type.label}: the key is empty.` });
      const limit = type.answerModel.wordLimit;
      if (limit !== null && row.wordLimit && row.wordLimit > limit)
        issues.push({
          code: "word_limit",
          message: `${type.label} allows at most ${limit} word(s); the row declares ${row.wordLimit}.`,
        });
      if (limit !== null && key && countWords(key) > limit)
        issues.push({ code: "key_over_word_limit", message: `${type.label}: the key "${key}" exceeds ${limit} word(s).` });
      if (row.options?.length)
        issues.push({ code: "options_not_allowed", message: `${type.label} does not present options.` });
      break;
    }
  }
  if (row.accepted?.some((entry) => !entry.trim()))
    issues.push({ code: "empty_accepted", message: "An accepted answer is blank." });
  return issues;
}

/** The storage enum a canonical type is persisted as, for compatibility reads. */
export function storageTypeFor(typeId: string, module?: string): "multiple_choice" | "short_answer" | null {
  return questionType(typeId, module)?.storageType ?? null;
}

/**
 * Reading-only compatibility: the imported library stores four enum values plus a
 * free-form `typeCode`. Recovering the canonical type prefers the source code and
 * falls back to the storage enum, so old rows keep grading exactly as before.
 */
export function readingTypeFromStorage(storageType: string, typeCode: string | null): string {
  if (typeCode) {
    const resolved = resolveQuestionType(typeCode, "reading");
    if (resolved) return resolved.id;
  }
  if (storageType === "true_false_not_given" || storageType === "yes_no_not_given") return storageType;
  if (storageType === "multiple_choice") return "multiple_choice";
  return "short_answer";
}
