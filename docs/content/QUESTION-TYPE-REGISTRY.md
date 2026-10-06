# Question Type Registry

Status: **implemented**. Executable source of truth:
[`src/lib/content/question-types.ts`](../../src/lib/content/question-types.ts)
(registry, grading, answer-shape validation) and
[`src/lib/content/taxonomy.ts`](../../src/lib/content/taxonomy.ts) (modules and
content types). This document explains what the registry is for and the rules a
new entry must satisfy; the code remains authoritative where they differ.

---

## 1. What the registry is

One entry per *question type a learner can be given*, carrying everything the
system needs to render, validate, grade and report it — and nothing about how it
looks on screen.

```ts
type QuestionTypeDescriptor = {
  id: string;                       // stable id, e.g. "mcq_multi"
  module: ContentModule;            // listening | reading (assessment types)
  label: string;                    // staff-facing name
  answerModel: AnswerModel;         // what a correct answer IS
  grading: GradingStrategy;         // how it is judged
  importShapes: string[];           // source-file aliases ("typeCode" values)
  group: boolean;                   // shares a stimulus / option pool with its group
  accessibility: "radio_group" | "checkbox_group" | "labelled_text_input" | "select_from_pool";
  review: "answer" | "answer_and_evidence" | "answer_evidence_and_stimulus";
  storageType: "multiple_choice" | "short_answer";  // compatibility storage enum
};
```

Deliberate omissions: **no CSS, no class names, no React, no pixel values, no
database column names**. A type says "this is a labelling task whose answers are
letters from a shared pool"; the renderer decides how that looks, and the same
descriptor serves the IELTS-native renderer, the review screen, the staff preview
and the print/exam paper.

## 2. Answer models

| kind | meaning | example types |
| --- | --- | --- |
| `ternary` | one of a fixed choice set | true_false_not_given, yes_no_not_given |
| `choice` | one or several of A–D bounded by min/max | mcq_single, multiple_choice |
| `choice_multi` | exactly N choices, all required | mcq_multi, multiple_choice_multi |
| `text` | free text with an optional word limit | form/note/table/summary/sentence completion, short_answer |
| `labels` | a label or letter from a shared pool | matching, matching_headings, matching_information, plan_labeling, map_labeling, diagram_labeling |

## 3. Grading strategies

| strategy | rule |
| --- | --- |
| `choice_exact` | answer equals the key after normalization; no partial credit |
| `text_normalized` | case, surrounding space, punctuation-insensitive compare against every accepted variant |
| `text_word_limit` | as above, then **rejected** (not silently accepted) when the answer exceeds the stated limit |
| `multi_all` | every required choice present, no extras |
| `label_letter_equivalent` | a pooled label and its letter are the same answer (`"A"` ≡ the label it names) |

Grading is a pure function over `(descriptor, answer, key)`. It is **not** allowed
to read the database, so the same rules run in the attempt route, in tests and in
teacher review.

## 4. Registered types

**Listening (14):** `mcq_single`, `mcq_multi`, `matching`, `classification`,
`form_completion`, `note_completion`, `table_completion`,
`flow_chart_completion`, `summary_completion`, `sentence_completion`,
`short_answer`, `plan_labeling`, `map_labeling`, `diagram_labeling`.

**Reading (16):** `multiple_choice`, `multiple_choice_multi`,
`matching_headings`, `matching_information`, `matching_features`,
`matching_sentence_endings`, `true_false_not_given`, `yes_no_not_given`,
`sentence_completion`, `summary_completion`, `note_completion`,
`table_completion`, `flow_chart_completion`, `diagram_label_completion`,
`short_answer`, `classification`.

`resolveQuestionType(alias)` also accepts the raw `typeCode` strings real source
files carry, so an import declares the type the file says and the registry maps it
to the canonical id; `readingTypeFromStorage` / `storageTypeFor` bridge the legacy
attempt columns for content that predates the registry (§93 COMPATIBILITY ONLY).

## 5. What the registry is validated against

1. **Answer-shape validation** (`answerShapeIssues`): a question's stored answer
   must be expressible in its type's answer model — a `ternary` with three options
   exactly, a `text` answer array, a `labels` answer that exists in the pool. The
   importer, the authoring payload schema and the AI-output validator all call it,
   so an impossible question is refused at every door.
2. **Grading equivalence** (`tests/content-question-types.test.ts`): for each type,
   the accepted variants of a key and its trivially-different forms (case, spacing,
   punctuation) grade the same, and a wrong answer never passes.
3. **Coverage** (`docs/content/IELTS-COVERAGE-MATRIX.md`): every registered type is
   reachable from a canonical content type, so nothing is registered but unusable.

## 6. Adding a type

1. Add the descriptor: id, module, label, answer model, grading strategy, import
   aliases, accessibility role, group-sharing, review shape.
2. Add answer-shape rules where the model alone is not enough (a shared pool, a
   word limit, a minimum count).
3. Add registry tests: grading truth table, alias resolution, and refusal of a
   malformed answer.
4. Update this document's list and the coverage matrix.

A type may **not** be added to make one renderer's life easier: if two types differ
only in presentation, they are one type with one answer model.
