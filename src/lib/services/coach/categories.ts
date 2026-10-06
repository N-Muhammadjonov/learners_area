import type { EvaluationType, WeaknessCategory } from "./schema";

/**
 * The one weakness vocabulary shared by RIWI and every external evaluator.
 *
 * A learner's history must not fork per provider: "you repeat the same article
 * mistake" has to mean the same row whether RIWI or a third-party model noticed
 * it. `href` points at the part of the app that can actually fix the category,
 * which is what turns the Coach from a report into a next step.
 */
export type WeaknessArea = "grammar" | "writing" | "speaking" | "vocabulary";

export type WeaknessCategoryMeta = {
  area: WeaknessArea;
  label: string;
  href: string;
  /** What the learner should do about it — used by the Coach dashboard. */
  action: string;
};

export const WEAKNESS_CATEGORY_META: Record<WeaknessCategory, WeaknessCategoryMeta> = {
  GRAMMAR_ARTICLE: {
    area: "grammar",
    label: "Articles (a / an / the)",
    href: "/app/grammar",
    action: "Practise one article exercise set, then re-read your last essay looking only for articles.",
  },
  GRAMMAR_SVA: {
    area: "grammar",
    label: "Subject–verb agreement",
    href: "/app/grammar",
    action: "Check every sentence where the verb comes right after a long subject.",
  },
  GRAMMAR_TENSE: {
    area: "grammar",
    label: "Verb tense and form",
    href: "/app/grammar",
    action: "Do a tense exercise set, then rewrite one paragraph of your last draft in the past tense.",
  },
  GRAMMAR_PREPOSITION: {
    area: "grammar",
    label: "Preposition patterns",
    href: "/app/grammar",
    action: "Learn the pattern, not the word: depend ON, interested IN, discuss (no preposition).",
  },
  GRAMMAR_FRAGMENT: {
    area: "grammar",
    label: "Sentence fragments",
    href: "/app/grammar",
    action: "Read your draft backwards, sentence by sentence, and check each one has a finite verb.",
  },
  GRAMMAR_PUNCTUATION: {
    area: "grammar",
    label: "Punctuation",
    href: "/app/grammar",
    action: "Do a punctuation pass before submitting: every sentence ends with one terminal mark.",
  },
  WRITING_TASK_RESPONSE: {
    area: "writing",
    label: "Task response",
    href: "/app/writing",
    action: "Answer the task fully: state a position and support it with reasons and examples.",
  },
  WRITING_COHESION: {
    area: "writing",
    label: "Coherence and cohesion",
    href: "/app/writing",
    action: "Plan four paragraphs and make each paragraph's first sentence carry its main point.",
  },
  WRITING_LEXICAL_REPETITION: {
    area: "writing",
    label: "Repeated vocabulary",
    href: "/app/vocabulary",
    action: "Save the repeated word and two alternatives to your vocabulary list, then use them next time.",
  },
  WRITING_LENGTH: {
    area: "writing",
    label: "Word-count target",
    href: "/app/writing",
    action: "Plan the answer before writing: an under-length answer is capped regardless of quality.",
  },
  SPEAKING_FILLERS: {
    area: "speaking",
    label: "Filler sounds",
    href: "/app/speaking/practice",
    action: "Record the same prompt twice, replacing every filler with a one-second pause.",
  },
  SPEAKING_FLUENCY: {
    area: "speaking",
    label: "Fluency and delivery",
    href: "/app/speaking/practice",
    action: "Practise timed answers until you speak steadily for the full part length.",
  },
  SPEAKING_SHORT_RESPONSE: {
    area: "speaking",
    label: "Short answers",
    href: "/app/speaking/practice",
    action: "Use point → reason → example before you stop speaking.",
  },
  SPEAKING_REPETITION: {
    area: "speaking",
    label: "Repeated words when speaking",
    href: "/app/speaking/practice",
    action: "Prepare two synonyms for the word you keep repeating and use them in the next take.",
  },
  VOCAB_COLLOCATION: {
    area: "vocabulary",
    label: "Collocation",
    href: "/app/vocabulary",
    action: "Learn words in phrases: note the preposition or the verb that goes with them.",
  },
  VOCAB_WRONG_FORM: {
    area: "vocabulary",
    label: "Word form",
    href: "/app/vocabulary",
    action: "Practise the family of the word: noun, verb, adjective, adverb.",
  },
  VOCAB_NOT_USED: {
    area: "vocabulary",
    label: "Words not yet in active use",
    href: "/app/vocabulary/review",
    action: "Review the due words, then write one original sentence for each.",
  },
};

/**
 * Which categories an evaluation of a given type actually *looked at*.
 *
 * This is what lets the Coach say "improved": a category that is checked but
 * produces no issue in a later evaluation moves from open → improving.
 * Only categories a service genuinely inspects may appear here — otherwise a
 * learner would be told a problem was fixed because nothing looked for it.
 */
export function categoriesCheckedBy(evaluationType: EvaluationType): WeaknessCategory[] {
  switch (evaluationType) {
    case "writing":
      return [
        "GRAMMAR_ARTICLE",
        "GRAMMAR_SVA",
        "GRAMMAR_TENSE",
        "GRAMMAR_PREPOSITION",
        "GRAMMAR_FRAGMENT",
        "GRAMMAR_PUNCTUATION",
        "WRITING_TASK_RESPONSE",
        "WRITING_COHESION",
        "WRITING_LEXICAL_REPETITION",
        "WRITING_LENGTH",
      ];
    case "speaking":
      return [
        "GRAMMAR_ARTICLE",
        "GRAMMAR_SVA",
        "GRAMMAR_TENSE",
        "GRAMMAR_PREPOSITION",
        "SPEAKING_FILLERS",
        "SPEAKING_FLUENCY",
        "SPEAKING_SHORT_RESPONSE",
        "SPEAKING_REPETITION",
      ];
    case "grammar":
      return [
        "GRAMMAR_ARTICLE",
        "GRAMMAR_SVA",
        "GRAMMAR_TENSE",
        "GRAMMAR_PREPOSITION",
        "GRAMMAR_FRAGMENT",
        "GRAMMAR_PUNCTUATION",
      ];
    case "vocabulary":
      return ["VOCAB_COLLOCATION", "VOCAB_WRONG_FORM", "VOCAB_NOT_USED"];
    case "assignment":
      return ["WRITING_LENGTH", "WRITING_COHESION", "WRITING_LEXICAL_REPETITION"];
  }
}

export function isWeaknessCategory(value: string): value is WeaknessCategory {
  return Object.prototype.hasOwnProperty.call(WEAKNESS_CATEGORY_META, value);
}
