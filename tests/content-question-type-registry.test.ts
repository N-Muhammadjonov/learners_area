import test from "node:test";
import assert from "node:assert/strict";
import {
  QUESTION_TYPES,
  answerShapeIssues,
  countWords,
  gradeByTypeId,
  gradeForType,
  questionType,
  questionTypesFor,
  readingTypeFromStorage,
  resolveQuestionType,
  storageTypeFor,
  type QuestionTypeDescriptor,
} from "../src/lib/content/question-types";
import { MODULE_DESCRIPTORS, COMPOSITION_DESCRIPTORS, contentTypeKey, isKnownContentType, parseContentTypeKey, referenceProblems } from "../src/lib/content/taxonomy";

const byId = (id: string, module: string): QuestionTypeDescriptor => {
  const found = questionType(id, module);
  assert.ok(found, `type ${module}:${id} must exist`);
  return found;
};

test("QT1 every declared type carries a complete, unambiguous contract", () => {
  assert.ok(QUESTION_TYPES.length >= 30, "Listening + Reading families are represented");
  const ids = new Set<string>();
  for (const type of QUESTION_TYPES) {
    const key = `${type.module}:${type.id}`;
    assert.equal(ids.has(key), false, `${key} is declared twice`);
    ids.add(key);
    assert.match(type.id, /^[a-z][a-z0-9_]*$/, `${key} must be a stable snake_case id`);
    assert.ok(type.label.length > 3, `${key} needs a human label`);
    assert.ok(type.importShapes.length > 0, `${key} must declare at least one import alias`);
    assert.ok(["multiple_choice", "short_answer"].includes(type.storageType), `${key} maps to a real storage enum`);
  }
  // An alias may not resolve to two different types inside one module.
  for (const moduleName of ["listening", "reading"]) {
    for (const type of questionTypesFor(moduleName))
      for (const shape of type.importShapes) {
        const resolved = resolveQuestionType(shape, moduleName);
        assert.equal(resolved?.id, type.id, `alias "${shape}" in ${moduleName} must resolve to ${type.id}`);
      }
  }
  // Without a module, an alias must still resolve uniquely (or not at all).
  assert.equal(resolveQuestionType("TFNG")?.id, "true_false_not_given");
  assert.equal(resolveQuestionType("nonsense_alias"), undefined);
});

test("QT2 ternary questions accept only their own choice set, and are rendered as radio groups", () => {
  const tfng = byId("true_false_not_given", "reading");
  const ynng = byId("yes_no_not_given", "reading");
  assert.equal(tfng.accessibility, "radio_group");
  assert.equal(ynng.accessibility, "radio_group");
  assert.deepEqual(gradeForType(tfng, { answer: "TRUE", key: "TRUE" }), { correct: true, rule: "choice_exact" });
  assert.equal(gradeForType(tfng, { answer: "true ", key: "TRUE" }).correct, true, "case and padding are irrelevant");
  assert.equal(gradeForType(tfng, { answer: "NOT GIVEN", key: "NOT_GIVEN" }).correct, true, "the source's underscore form is the same answer");
  assert.equal(gradeForType(tfng, { answer: "YES", key: "TRUE" }).correct, false, "YES is not a TFNG answer");
  assert.equal(gradeForType(tfng, { answer: "MAYBE", key: "TRUE" }).correct, false);
  // A TFNG key outside its own choice set is refused at validation time.
  assert.equal(answerShapeIssues("true_false_not_given", { module: "reading", key: "YES", options: [] })[0]?.code, "invalid_key");
  assert.equal(answerShapeIssues("true_false_not_given", { module: "reading", key: "NOT GIVEN", options: ["A", "B"] })[0]?.code, "options_not_allowed");
  assert.deepEqual(answerShapeIssues("true_false_not_given", { module: "reading", key: "NOT GIVEN" }), []);
});

test("QT3 choice answers tolerate the two ways the same option is written, and reject letters that point nowhere", () => {
  const mcq = byId("mcq_single", "listening");
  const options = ["A) the library", "B) the museum", "C) the station"];
  assert.equal(gradeForType(mcq, { answer: "B", key: "the museum", options }).correct, true);
  assert.equal(gradeForType(mcq, { answer: "B) the museum", key: "the museum", options }).correct, true);
  assert.equal(gradeForType(mcq, { answer: "museum", key: "the museum", options }).correct, false, "a different phrase is a different choice, however close");
  const bareKey = ["A) the library", "B) the museum", "C) the station"];
  assert.equal(gradeForType(mcq, { answer: "B", key: "the museum", options: bareKey }).correct, true);
  assert.equal(gradeForType(mcq, { answer: "D", key: "the museum", options }).correct, false);
  assert.equal(gradeForType(mcq, { answer: "", key: "the museum", options }).correct, false);
  // A key that is not among the options is a data error, not a learner error.
  assert.equal(
    answerShapeIssues("mcq_single", { module: "listening", key: "the pier", options: ["A) the library", "B) the museum"] })[0]?.code,
    "key_not_an_option",
  );
  assert.equal(answerShapeIssues("mcq_single", { module: "listening", key: "the museum", options: ["A) the museum"] })[0]?.code, "option_count");
});

test("QT4 choose-two questions need every answer, and say so when one is missing", () => {
  const multi = byId("mcq_multi", "listening");
  const input = { key: "B", keys: ["B", "D"], options: ["A", "B", "C", "D"], answer: "" };
  assert.equal(gradeForType(multi, { ...input, answer: "B, D" }).correct, true);
  assert.equal(gradeForType(multi, { ...input, answer: "D and B" }).correct, true, "order does not matter");
  const partial = gradeForType(multi, { ...input, answer: "B" });
  assert.equal(partial.correct, false);
  assert.equal(partial.violation, "not_all_selected", "the learner is told they missed one, not just marked wrong");
  assert.equal(gradeForType(multi, { ...input, answer: "B, C" }).correct, false, "a wrong pick is not compensated by a right one");
});

test("QT5 completion answers honour the word limit before the answer text", () => {
  const note = byId("note_completion", "listening");
  assert.equal(gradeForType(note, { answer: "cycling", key: "cycling" }).correct, true);
  assert.equal(gradeForType(note, { answer: "the cycling club", key: "cycling" }).correct, false);
  assert.equal(gradeForType(note, { answer: "electric car", key: "electric cars" }).correct, false, "no stemming or synonym guessing");
  assert.equal(gradeForType(note, { answer: "electric cars", key: "electric car", accepted: ["electric cars"] }).correct, true, "the source's own accepted list is honoured");
  const overLimit = gradeForType(note, { answer: "one two three four", key: "four" });
  assert.equal(overLimit.violation, "word_limit", "too many words is reported as a limit violation");
  assert.equal(overLimit.correct, false);
  assert.equal(countWords("one  two\tthree"), 3);
  // A key that itself breaks the limit is refused when the row is validated.
  assert.equal(
    answerShapeIssues("note_completion", { module: "listening", key: "one two three four" }).some((issue) => issue.code === "key_over_word_limit"),
    true,
  );
  assert.equal(answerShapeIssues("note_completion", { module: "listening", key: "" })[0]?.code, "missing_key");
});

test("QT6 matching and labelling families require a shared pool and grade letter-for-label", () => {
  const headings = byId("matching_headings", "reading");
  assert.equal(headings.group, true);
  assert.equal(headings.accessibility, "select_from_pool");
  const pool = ["i. Origins", "ii. Decline", "iii. Revival"];
  assert.equal(gradeForType(headings, { answer: "ii", key: "ii. Decline", options: pool }).correct, true);
  assert.equal(gradeForType(headings, { answer: "ii. Decline", key: "ii", options: pool }).correct, true);
  assert.equal(gradeForType(headings, { answer: "Decline", key: "ii", options: pool }).correct, true, "the heading text answers the heading label");
  assert.equal(gradeForType(headings, { answer: "iii", key: "ii. Decline", options: pool }).correct, false, "iii is not ii");
  assert.equal(gradeForType(headings, { answer: "iii", key: "ii. Decline", options: pool.slice(0, 2) }).correct, false);
  // Roman-numeral headings must never collapse onto the letter "i".
  assert.equal(gradeForType(headings, { answer: "i", key: "iii. Revival", options: pool }).correct, false);
  assert.equal(
    answerShapeIssues("matching_headings", { module: "reading", key: "ii", sharedOptions: null })[0]?.code,
    "pool_required",
    "a matching group without its pool is refused",
  );
  assert.deepEqual(answerShapeIssues("matching_headings", { module: "reading", key: "ii", sharedOptions: pool }), []);
  // Labelling families exist for map, plan and diagram, in both modules that use them.
  for (const id of ["map_labeling", "plan_labeling", "diagram_labeling"]) assert.ok(questionType(id, "listening"));
  assert.ok(questionType("diagram_label_completion", "reading"));
});

test("QT7 every IELTS family named by the spec resolves from either its source alias or its canonical id", () => {
  const listeningFamilies = ["mcq_single", "mcq_multi", "matching", "classification", "form_completion", "note_completion", "table_completion", "flow_chart_completion", "summary_completion", "sentence_completion", "short_answer", "plan_labeling", "map_labeling", "diagram_labeling"];
  const readingFamilies = ["multiple_choice", "multiple_choice_multi", "true_false_not_given", "yes_no_not_given", "matching_headings", "matching_information", "matching_features", "matching_sentence_endings", "sentence_completion", "summary_completion", "note_completion", "table_completion", "flow_chart_completion", "diagram_label_completion", "short_answer", "classification"];
  for (const id of listeningFamilies) assert.ok(questionType(id, "listening"), `missing listening family ${id}`);
  for (const id of readingFamilies) assert.ok(questionType(id, "reading"), `missing reading family ${id}`);
  // The aliases the shipped Reading import script already uses must keep working.
  for (const [code, expected] of [
    ["TFNG", "true_false_not_given"],
    ["YNNG", "yes_no_not_given"],
    ["MCQ", "multiple_choice"],
    ["MCQ_MULTI", "multiple_choice_multi"],
    ["MH", "matching_headings"],
    ["MI", "matching_information"],
    ["MF", "matching_features"],
    ["MSE", "matching_sentence_endings"],
    ["DIAG", "diagram_label_completion"],
    ["SC", "sentence_completion"],
    ["NOTE", "note_completion"],
    ["FLOW", "flow_chart_completion"],
  ] as const)
    assert.equal(resolveQuestionType(code, "reading")?.id, expected, `alias ${code}`);
});

test("QT8 the four-value reading storage enum plus typeCode recovers the real question type", () => {
  assert.equal(readingTypeFromStorage("multiple_choice", "MH"), "matching_headings");
  assert.equal(readingTypeFromStorage("short_answer", "NOTE"), "note_completion");
  assert.equal(readingTypeFromStorage("true_false_not_given", null), "true_false_not_given");
  // A legacy row with no typeCode falls back to what the enum can honestly say.
  assert.equal(readingTypeFromStorage("multiple_choice", null), "multiple_choice");
  assert.equal(readingTypeFromStorage("short_answer", null), "short_answer");
  assert.equal(storageTypeFor("matching_headings", "reading"), "multiple_choice");
  assert.equal(storageTypeFor("note_completion", "reading"), "short_answer");
  assert.equal(storageTypeFor("not_a_type"), null);
  assert.equal(gradeByTypeId("matching_headings", { answer: "i", key: "i. Origins", options: ["i. Origins"] })?.correct, true);
  assert.equal(gradeByTypeId("not_a_type", { answer: "x", key: "x" }), null);
});

test("QT9 the taxonomy knows every module, its class, its content types and its focus contract", () => {
  assert.ok(MODULE_DESCRIPTORS.length >= 7);
  const modules = MODULE_DESCRIPTORS.map((entry) => entry.module);
  assert.deepEqual([...new Set(modules)].length, modules.length, "modules are unique");
  for (const descriptor of MODULE_DESCRIPTORS) {
    assert.ok(descriptor.contentTypes.length > 0, `${descriptor.module} must declare content types`);
    for (const contentType of descriptor.contentTypes)
      assert.equal(isKnownContentType(descriptor.module, contentType), true, `${descriptor.module}:${contentType}`);
  }
  assert.equal(isKnownContentType("listening", "full_test"), true);
  assert.equal(isKnownContentType("listening", "invented_type"), false);
  assert.equal(isKnownContentType("sat", "module"), false);
  assert.equal(contentTypeKey("reading", "general_set"), "reading:general_set");
  assert.deepEqual(parseContentTypeKey("writing:task1"), { module: "writing", contentType: "task1" });
  assert.equal(parseContentTypeKey("writing:task1:extra"), null);
  assert.equal(parseContentTypeKey("nope:task1"), null);
  // Focus is a policy of the module, not something a route name implies.
  assert.equal(MODULE_DESCRIPTORS.find((entry) => entry.module === "listening")?.focus, "always");
  assert.equal(MODULE_DESCRIPTORS.find((entry) => entry.module === "speaking")?.focus, "never");
});

test("QT10 composition kinds never own content and declare how they bind versions", () => {
  assert.deepEqual(Object.keys(COMPOSITION_DESCRIPTORS).sort(), ["assignment", "lesson", "mock", "practice_set", "sectional_mock"]);
  for (const descriptor of Object.values(COMPOSITION_DESCRIPTORS)) {
    assert.equal(descriptor.ownsContent, false, `${descriptor.kind} must reference canonical content, never copy it`);
    assert.ok(descriptor.label.length > 3);
  }
  assert.equal(COMPOSITION_DESCRIPTORS.mock.versionBinding, "pinned");
  assert.equal(COMPOSITION_DESCRIPTORS.mock.compatibilityChecked, true);
  assert.equal(COMPOSITION_DESCRIPTORS.practice_set.versionBinding, "latest");
  assert.equal(COMPOSITION_DESCRIPTORS.sectional_mock.compatibilityChecked, true);
});

test("QT11 cross-reference validation refuses unknown targets, mixed tracks, drafts and unpinned formal references", () => {
  assert.deepEqual(
    referenceProblems({ module: "reading", contentType: "general_set", sourceRef: "reading-set-105", track: "academic", publicationState: "published", versionId: "v1" }, { track: "academic", requireVersion: true, requirePublished: true }),
    [],
  );
  assert.equal(
    referenceProblems({ module: "nope", contentType: "x", sourceRef: "x" })[0]?.code,
    "unknown_module",
  );
  assert.equal(
    referenceProblems({ module: "reading", contentType: "invented", sourceRef: "x" })[0]?.code,
    "unknown_content_type",
  );
  assert.equal(
    referenceProblems({ module: "reading", contentType: "general_set", sourceRef: "x", track: "general_training" }, { track: "academic" })[0]?.code,
    "track_mismatch",
    "an Academic mock may not include General Training reading",
  );
  assert.equal(
    referenceProblems({ module: "listening", contentType: "full_test", sourceRef: "x", publicationState: "draft" }, { requirePublished: true })[0]?.code,
    "not_published",
  );
  assert.equal(
    referenceProblems({ module: "listening", contentType: "full_test", sourceRef: "x" }, { requireVersion: true })[0]?.code,
    "version_required",
  );
  // `unspecified` never conflicts with a declared track.
  assert.deepEqual(
    referenceProblems({ module: "vocabulary", contentType: "topic_pack", sourceRef: "x", track: "unspecified" }, { track: "academic" }),
    [],
  );
});
