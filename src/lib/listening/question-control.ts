import { questionType, resolveQuestionType } from "@/lib/content/question-types";

/**
 * WHICH CONTROL a Listening question needs — decided by the canonical registry, not by the
 * presence of an option array.
 *
 * The defect this exists to prevent: the exam used to choose its control with
 * `options.length ? <select> : <input>`, which equates "has options" with "multiple choice". A
 * completion question that carries a hint list (or a row whose options were filled in by an
 * importer) therefore rendered as a menu, and a learner who was supposed to TYPE the answer was
 * asked to pick one. The registry already states the answer model for every canonical type
 * (`accessibility`, `answerModel`, `grading`), so this function reads it instead of guessing.
 *
 * The mapping is deliberately small and explicit:
 *   • `labelled_text_input` (completion kinds) → a text input, whatever `options` holds;
 *   • `radio_group` / `select_from_pool` (single choice, matching, map) → a menu;
 *   • `checkbox_group` (choose-two/three) → checkbox group;
 *   • an unrecognised or ABSENT type code falls back to the legacy rule (options → menu), which
 *     is how rows written before canonical type codes existed keep behaving exactly as before.
 *
 * A type that needs a menu but has NO options cannot be answered in a menu at all, so it degrades
 * to a text input rather than rendering an empty menu the learner can never satisfy.
 */
export type ListeningInputMode = "select" | "multi" | "text";

export function listeningInputModeFor(question: { typeCode?: string | null; options?: readonly string[] | null }): ListeningInputMode {
  const options = (question.options ?? []).filter((option) => option.trim().length > 0);
  /*
   * A row's `type_code` may hold either the canonical id (what authoring writes) or one of the
   * source-file aliases (what an import or a hand-edited row can carry). Both resolve through the
   * same registry, so both get their real answer model — a completion row is typed whichever
   * spelling it arrived in.
   */
  const descriptor = question.typeCode
    ? questionType(question.typeCode, "listening") ?? resolveQuestionType(question.typeCode, "listening")
    : undefined;
  if (!descriptor) return options.length ? "select" : "text";
  switch (descriptor.accessibility) {
    case "labelled_text_input":
      return "text";
    case "checkbox_group":
      return options.length ? "multi" : "text";
    case "radio_group":
    case "select_from_pool":
      return options.length ? "select" : "text";
    default:
      return options.length ? "select" : "text";
  }
}
