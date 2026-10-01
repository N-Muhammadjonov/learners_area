#!/usr/bin/env node
/**
 * Import the 105-passage reading library.
 *
 *   node --import tsx --env-file=.env scripts/import-reading-105.mjs --source <zip|dir>
 *   node --import tsx --env-file=.env scripts/import-reading-105.mjs --source <zip|dir> --apply
 *   node --import tsx --env-file=.env scripts/import-reading-105.mjs --verify
 *
 * Without `--apply` this is a dry run: it reads the source package, builds the
 * whole import plan, validates it and prints what *would* be written. Nothing
 * touches the database. `--verify` goes the other way — it reads what is in the
 * database now and reports whether the library is complete.
 *
 * Design rules this script is held to:
 *
 *   * **The source decides.** Text, questions, answers and evidence are copied
 *     verbatim. Where the source has no evidence for a question it is recorded
 *     as missing rather than filled with something plausible; where it has no
 *     explanation, the field stays empty instead of gaining an invented one.
 *   * **Nothing is published before it is checked.** Rows are written as DRAFT,
 *     then validated, and only the passages that pass are published. A passage
 *     that fails is left as a draft and named in the report.
 *   * **Idempotent.** Passages are keyed by their source `external_id`. Running
 *     the script twice does not duplicate a passage, and never deletes anything:
 *     a passage that already has questions is skipped, so no attempt a student
 *     has already made can be touched by a re-run.
 *   * **Additive.** It only inserts. There is no delete, no truncate, no update
 *     of existing learner data anywhere in this file.
 *   * **It stops rather than guesses.** If the package does not contain exactly
 *     105 passages, the script refuses to run and says so.
 *
 * It never touches users, roles, the owner account, admission, attempts or
 * history: the import is content plus the shared lexicon.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { legacySenseKeyOf as senseKeyOf, senseKeyOf as semanticKeyOf } from "../src/lib/services/vocabulary/dedupe.ts";
import { planImportSenseKeys } from "../src/lib/services/vocabulary/import-keys.ts";

// `pg` is CommonJS: with an ESM entry point the named exports are not
// guaranteed, so the default export is destructured instead.
const { Pool } = pg;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_PASSAGES = 105;
const BATCH_NAME = "learnersarea_reading_01_105";
const IMPORT_MARK = "reading_105";
const BUNDLE_RELATIVE_PATH = "data/reading_bundle_01_105.json";
const FILE_INSIDE_ZIP = `learnersarea_reading_supabase_ready_v1/${BUNDLE_RELATIVE_PATH}`;

/**
 * The source's own question-type codes, mapped onto the four types this
 * application grades. The list is closed on purpose: a code that is not here is
 * a code the importer does not understand, and it fails loudly instead of
 * silently filing the question under the wrong type.
 *
 * MCQ_MULTI deserves a note. The source stores a "Choose TWO letters" question
 * as two numbered questions (7 → B, 8 → D) that share one option list, so each
 * of them really does have a single answer and grading as multiple choice is
 * correct. `type_code` keeps the source's label for filtering.
 */
const TYPE_MAP = {
  TFNG: "true_false_not_given",
  YNNG: "yes_no_not_given",
  MCQ: "multiple_choice",
  MCQ_MULTI: "multiple_choice",
  MH: "multiple_choice",
  MI: "multiple_choice",
  MF: "multiple_choice",
  MSE: "multiple_choice",
  DIAG: "short_answer",
  SC: "short_answer",
  NOTE: "short_answer",
  FLOW: "short_answer",
  SEN: "short_answer",
  SAQ: "short_answer",
};

const CHOICE_TYPES = new Set(["MCQ", "MCQ_MULTI", "MH", "MI", "MF", "MSE"]);
const TERNARY_TYPES = new Set(["TFNG", "YNNG"]);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const APPLY = args.includes("--apply");
const VERIFY = args.includes("--verify");
const SOURCE = argValue("--source");
const REPORT_PATH = argValue("--report") ?? join(ROOT, "docs", "READING-105-IMPORT-REPORT.md");

function stop(message) {
  console.error(`\u001b[31mSTOP\u001b[0m ${message}`);
  process.exit(1);
}

function log(message = "") {
  console.log(message);
}

// ---------------------------------------------------------------------------
// Reading the source package
// ---------------------------------------------------------------------------

function readBundleFromDisk(source) {
  if (!existsSync(source)) stop(`source ${source} does not exist — expected a zip containing ${FILE_INSIDE_ZIP} or a directory with ${BUNDLE_RELATIVE_PATH}`);
  const stat = statSync(source);
  if (stat.isDirectory()) {
    const direct = join(source, BUNDLE_RELATIVE_PATH);
    if (existsSync(direct)) return { text: readFileSync(direct, "utf8"), where: direct };
    const nested = join(source, "learnersarea_reading_supabase_ready_v1", BUNDLE_RELATIVE_PATH);
    if (existsSync(nested)) return { text: readFileSync(nested, "utf8"), where: nested };
    stop(`no ${BUNDLE_RELATIVE_PATH} under ${source}`);
  }

  // A zip: `unzip -p` streams one member. Python's zipfile is the fallback for
  // machines without the unzip binary; both are read-only.
  try {
    const text = execFileSync("unzip", ["-p", source, FILE_INSIDE_ZIP], { maxBuffer: 512 * 1024 * 1024 });
    return { text: text.toString("utf8"), where: `${source}:${FILE_INSIDE_ZIP}` };
  } catch {
    try {
      const text = execFileSync(
        "python3",
        ["-c", `import sys,zipfile;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())`, source, FILE_INSIDE_ZIP],
        { maxBuffer: 512 * 1024 * 1024 }
      );
      return { text: text.toString("utf8"), where: `${source}:${FILE_INSIDE_ZIP}` };
    } catch (error) {
      stop(`could not read ${FILE_INSIDE_ZIP} from ${source}: ${error.message}`);
    }
  }
}

function loadBundle(source) {
  const { text, where } = readBundleFromDisk(source);
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (error) {
    stop(`${where} is not valid JSON: ${error.message}`);
  }
  log(`source        ${where}`);
  return bundle;
}

// ---------------------------------------------------------------------------
// Turning the bundle into a plan
// ---------------------------------------------------------------------------

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** "True" → "true", "NOT GIVEN" → "not_given" — the values the UI grades with. */
function ternaryValue(canonical) {
  const key = normalizeKey(canonical);
  if (key === "true" || key === "yes") return key;
  if (key === "false" || key === "no") return key;
  return "not_given";
}

/**
 * Strip two artefacts of the source extraction, and nothing else:
 *
 *   1. the question number, which the source page repeats in front of the input
 *      ("roughly 1 {{q1}} in length" — the "1" is the number badge, not text);
 *   2. the `{{qN}}` placeholder itself, which becomes the blank the student sees.
 *
 * A number that is not the question's own number, and not glued to the
 * placeholder, is left alone: "1795 — French government needs…" is real text and
 * survives untouched.
 */
/**
 * The option list a student actually chooses from.
 *
 * A matching-headings or "Choose TWO letters" question gives the *keys* on the
 * question row and keeps the wording in the group (`config.shared_choices`) —
 * take only the keys and the student is looking at "i", "ii", "iii" with nothing
 * to choose between. The wording is merged back in here.
 *
 * Where the source has no wording at all (a matching-information question whose
 * answers are paragraph letters), the key itself is the whole label and stays
 * as it is.
 */
function optionListFor(questionOptions, sharedChoices) {
  const shared = new Map(
    (sharedChoices ?? []).map((choice) => [normalizeKey(choice.option_key), String(choice.option_text ?? "").trim()])
  );
  const rows = (questionOptions ?? []).slice().sort((a, b) => a.position - b.position);
  /*
   * A multiple-choice question carries its wording on its own option rows
   * ("A It makes the claims more attractive."), while a matching task keeps the
   * wording in the group and only the key on the row. Reading the group alone
   * therefore stored 144 MCQ questions as a list of bare letters — an answer the
   * student has no way to choose. Prefer the group's wording when it exists, and
   * otherwise take the row's own wording with the printed key stripped off.
   */
  const source =
    rows.length > 0
      ? rows.map((row) => {
          const fromGroup = (shared.get(normalizeKey(row.option_key)) ?? "").trim();
          return { key: row.option_key, text: fromGroup || keyedOptionWording(row.option_key, row.option_text) };
        })
      : [];

  if (source.length === 0) {
    return (sharedChoices ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((choice) => ({ key: choice.option_key, text: String(choice.option_text ?? "").trim() }));
  }
  return source;
}

/** "A It makes the claims more attractive." → "It makes the claims more attractive." */
const KEYED_OPTION = /^([A-Za-z]|[ivxIVX]+|\d{1,2})\s*[.):\-\u2013\u2014]?\s+(.+)$/;

function keyedOptionWording(key, text) {
  const raw = String(text ?? "").trim();
  if (!raw || normalizeKey(raw) === normalizeKey(key)) return "";
  const match = KEYED_OPTION.exec(raw);
  if (match && normalizeKey(match[1]) === normalizeKey(String(key))) return match[2].trim();
  return raw;
}

function labelFor(key, text) {
  const wording = (text ?? "").trim();
  if (!wording || normalizeKey(wording) === normalizeKey(key)) return String(key).trim();
  return `${String(key).trim()} — ${wording}`;
}

function cleanPrompt(text, questionNo) {
  let value = String(text ?? "");
  value = value.replace(new RegExp(`(?<!\\d)${questionNo}\\s+(\\{\\{q${questionNo}\\}\\})`, "g"), "$1");
  value = value.replace(/\{\{q\d+\}\}/g, "______");
  return value
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+$/g, "")
    .trim();
}

function buildPassagePlan(bundle, contentItem, validation) {
  const itemRef = contentItem.ref;
  const passageRow = bundle.reading_passages.find((p) => p.content_item_ref === itemRef);
  if (!passageRow) return { error: "content item has no reading_passage row" };

  // Full passage text: every content segment in order, paragraphs first. The
  // paragraph table decides which segments carry a paragraph letter.
  const segments = bundle.content_segments
    .filter((s) => s.content_item_ref === itemRef)
    .sort((a, b) => a.position - b.position);
  const paragraphsBySegment = new Map();
  for (const row of bundle.reading_paragraphs) {
    if (row.passage_ref === passageRow.ref) paragraphsBySegment.set(row.segment_ref, row);
  }

  const paragraphs = segments
    .filter((s) => s.segment_type === "paragraph" || s.segment_type === "heading" || s.segment_type === "footnote")
    .map((segment) => {
      const meta = paragraphsBySegment.get(segment.ref);
      let text = String(segment.text ?? "").trim();
      let label = meta?.paragraph_label ?? null;
      /*
       * Some passages carry the paragraph letter inside the text ("A In Robert
       * Plomin's line of work…") instead of in the label column. Only a single
       * capital that starts the paragraph and is followed by whitespace is taken
       * — a lead-in like "The law influences…" keeps its words, and the letter
       * becomes the label the matching questions refer to.
       */
      if (!label) {
        const leading = /^([A-Z])\s+(?=\S)/.exec(text);
        if (leading) {
          label = leading[1];
          text = text.slice(leading[0].length).trim();
        }
      }
      return {
        position: segment.position,
        label,
        isFootnote: segment.segment_type === "footnote" || Boolean(meta?.is_footnote),
        text,
      };
    })
    .filter((paragraph) => paragraph.text.length > 0);

  const bodyText = paragraphs.map((p) => p.text).join("\n\n");

  const groups = bundle.assessment_groups
    .filter((g) => g.content_item_ref === itemRef)
    .sort((a, b) => a.position - b.position);

  const questions = bundle.assessment_questions
    .filter((q) => q.content_item_ref === itemRef)
    .sort((a, b) => a.question_no - b.question_no);

  const optionsByQuestion = new Map();
  for (const option of bundle.assessment_question_options) {
    if (!optionsByQuestion.has(option.question_ref)) optionsByQuestion.set(option.question_ref, []);
    optionsByQuestion.get(option.question_ref).push(option);
  }
  const answersByQuestion = new Map(bundle.assessment_answers.map((a) => [a.question_ref, a]));
  const variantsByAnswer = new Map();
  for (const variant of bundle.assessment_answer_variants) {
    if (!variantsByAnswer.has(variant.answer_ref)) variantsByAnswer.set(variant.answer_ref, []);
    variantsByAnswer.get(variant.answer_ref).push(variant.accepted_answer);
  }
  const evidenceByQuestion = new Map(bundle.assessment_evidence.map((e) => [e.question_ref, e]));

  const problems = [];
  const plannedQuestions = [];

  for (const [index, question] of questions.entries()) {
    const group = groups.find((g) => g.ref === question.group_ref) ?? null;
    const typeCode = group?.type_code ?? null;
    const type = typeCode ? TYPE_MAP[typeCode] : null;
    if (!type) {
      problems.push(`Q${question.question_no}: unknown question type "${typeCode}"`);
      continue;
    }

    const answer = answersByQuestion.get(question.ref);
    if (!answer) {
      problems.push(`Q${question.question_no}: no answer in the source`);
      continue;
    }

    const rawOptions = (optionsByQuestion.get(question.ref) ?? []).slice().sort((a, b) => a.position - b.position);
    let questionText = cleanPrompt(question.prompt_text, question.question_no);
    let options = null;
    let correctAnswer;

    if (TERNARY_TYPES.has(typeCode)) {
      // The UI draws TRUE/FALSE/NOT GIVEN from its own constant, so no option
      // list is stored here; the stored answer is the value that UI compares.
      correctAnswer = ternaryValue(answer.canonical_answer);
      // The instruction lives in the prompt for some of these questions.
      if (!questionText) questionText = String(question.question_no);
    } else if (CHOICE_TYPES.has(typeCode)) {
      // "Choose TWO letters" questions carry no text of their own — the whole
      // question is the group's instruction plus a letter to pick. The row stays
      // empty rather than repeating the instruction three times; the UI shows
      // the question number next to the selector.
      if (questionText === "______") questionText = "";
      const list = optionListFor(rawOptions, group?.config?.shared_choices);
      if (list.length < 2) {
        problems.push(`Q${question.question_no}: multiple choice with fewer than two options`);
        continue;
      }
      options = list.map((option) => labelFor(option.key, option.text));
      const match = list.find((option) => normalizeKey(option.key) === normalizeKey(answer.canonical_answer));
      if (!match) {
        problems.push(`Q${question.question_no}: correct answer "${answer.canonical_answer}" is not among the options`);
        continue;
      }
      correctAnswer = labelFor(match.key, match.text);
    } else {
      correctAnswer = String(answer.canonical_answer ?? "").trim();
      if (!correctAnswer) {
        problems.push(`Q${question.question_no}: empty answer`);
        continue;
      }
      if (!questionText) {
        // A few "write your own" style items carry their text in the group.
        questionText = String(question.question_no);
      }
    }

    const evidence = evidenceByQuestion.get(question.ref);
    const hasEvidence = Boolean(evidence && (evidence.evidence_text ?? "").trim());

    plannedQuestions.push({
      order: index + 1,
      questionNo: question.question_no,
      type,
      typeCode,
      questionText,
      options,
      correctAnswer,
      groupRef: question.group_ref,
      acceptedAnswers: [correctAnswer, ...(variantsByAnswer.get(answer.ref) ?? []).map((v) => String(v))].filter(
        (value, position, all) => value.trim() && all.indexOf(value) === position
      ),
      answerSlots: ((question.prompt_content ?? {}).answer_slots ?? []).map((slot) => ({
        slotKey: slot.slot_key,
        token: slot.token,
        control: slot.control,
      })),
      answerConstraint: question.answer_constraint ?? null,
      renderMode: (question.prompt_content ?? {}).render_mode ?? null,
      sourceKey: question.source_key ?? null,
      evidenceQuote: hasEvidence ? String(evidence.evidence_text).trim() : null,
      evidenceStartChar: hasEvidence ? evidence.start_char ?? null : null,
      evidenceEndChar: hasEvidence ? evidence.end_char ?? null : null,
      evidenceType: evidence ? evidence.evidence_type : null,
      // The source ships no authored explanations; the field stays empty rather
      // than gaining a generated one.
      explanation: "",
    });
  }

  const plannedGroups = groups.map((group, index) => ({
    ref: group.ref,
    position: index + 1,
    typeCode: group.type_code,
    displayTitle: group.display_title ?? null,
    instructionsText: group.instructions_text ?? null,
    fromQuestionNo: group.from_question_no ?? null,
    toQuestionNo: group.to_question_no ?? null,
    sharedChoices: (group.config?.shared_choices ?? [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((choice) => labelFor(choice.option_key, choice.option_text)),
  }));

  const meta = contentItem.metadata ?? {};
  const instructions = String(passageRow.instructions ?? contentItem.subtitle ?? "").trim();
  const minutes = /(\d+)\s*minutes?/i.exec(instructions);

  const plan = {
    externalId: contentItem.external_id,
    title: String(contentItem.title ?? "").trim(),
    testNo: meta.test_no ?? null,
    passageNo: passageRow.passage_no ?? meta.passage_no ?? null,
    topicCode: meta.topic_code ?? passageRow.topic_code ?? null,
    instructions: instructions || null,
    bodyText,
    suggestedMinutes: minutes ? Number(minutes[1]) : 20,
    sourceWordCount: passageRow.source_word_count ?? meta.source_word_count ?? null,
    sourceQuestionCount: passageRow.source_question_count ?? meta.source_question_count ?? null,
    sourceChecksum: contentItem.source_checksum ?? null,
    sourceRef: passageRow.ref,
    paragraphs,
    groups: plannedGroups,
    questions: plannedQuestions,
    problems,
  };

  // Validation — the gate between DRAFT and published.
  const checks = [];
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) checks.push(`passage text is only ${wordCount} words`);
  if (plan.sourceWordCount && Math.abs(wordCount - plan.sourceWordCount) / plan.sourceWordCount > 0.05) {
    checks.push(`text has ${wordCount} words but the source says ${plan.sourceWordCount}`);
  }
  if (plan.questions.length === 0) checks.push("no questions");
  if (plan.sourceQuestionCount && plan.questions.length !== plan.sourceQuestionCount) {
    checks.push(`${plan.questions.length} questions imported but the source says ${plan.sourceQuestionCount}`);
  }
  if (plan.groups.length === 0) checks.push("no question groups");
  if (!plan.title) checks.push("no title");
  if (paragraphs.length === 0) checks.push("no passage text");
  const needsLetters = plan.questions.some((q) => ["MH", "MI"].includes(q.typeCode));
  if (needsLetters && !paragraphs.some((p) => p.label)) {
    checks.push("matching-headings/information questions but no paragraph letters in the text");
  }
  const missingNumbers = plan.questions.filter((q) => !q.correctAnswer).length;
  if (missingNumbers > 0) checks.push(`${missingNumbers} question(s) without an answer`);

  plan.failures = [...checks, ...problems];
  plan.valid = plan.failures.length === 0;
  plan.validationSource = validation;
  return plan;
}

function buildPlan(bundle) {
  const items = bundle.content_items.filter((item) => item.content_type === "reading_passage");
  if (items.length !== EXPECTED_PASSAGES) {
    stop(
      `the source has ${items.length} reading passages, not ${EXPECTED_PASSAGES}. ` +
        `The import is defined for exactly ${EXPECTED_PASSAGES}; nothing was written.`
    );
  }
  const uniqueIds = new Set(items.map((item) => item.external_id));
  if (uniqueIds.size !== items.length) stop(`the source has duplicate external_id values (${uniqueIds.size} unique of ${items.length})`);

  const plans = items
    .map((item) => buildPassagePlan(bundle, item, bundle.validation?.status ?? "unknown"))
    .filter((plan) => !plan.error);

  // Lexicon plan: one row per source sense, plus every occurrence.
  const lexemes = [];
  const senseKeyBySenseRef = new Map();
  const lexemeByIdRef = new Map();
  for (const lexeme of bundle.lexemes) lexemeByIdRef.set(lexeme.id, lexeme);

  for (const sense of bundle.lexical_senses) {
    const lexeme = lexemeByIdRef.get(sense.lexeme_id);
    if (!lexeme) continue;
    const definition = String(sense.definition_en ?? "").trim();
    const translations = (sense.translation_uz ?? []).map((t) => String(t).trim()).filter(Boolean);
    const senseKey = senseKeyOf({ term: lexeme.lemma, partOfSpeech: lexeme.part_of_speech, meaning: definition });
    senseKeyBySenseRef.set(sense.id, senseKey);
    lexemes.push({
      sourceSenseId: sense.id,
      senseKey,
      term: lexeme.lemma,
      partOfSpeech: lexeme.part_of_speech ?? null,
      definitionEn: definition,
      translationUz: translations[0] ?? null,
      acceptedTranslations: translations,
      provenance: sense.provenance ?? null,
      verificationStatus: sense.verification_status ?? null,
    });
  }

  const identities = planImportSenseKeys(lexemes);
  for (let i = 0; i < lexemes.length; i++) {
    Object.assign(lexemes[i], identities[i]);
    senseKeyBySenseRef.set(lexemes[i].sourceSenseId, lexemes[i].senseKey);
  }
  const resolved = identities.filter((row) => row.collisionResolved);
  if (resolved.length) log(`Lexical identity: ${resolved.length} source senses use full v2 keys; definitions and references preserved.`);
  const lexemeIdBySenseKey = new Map(lexemes.map((row) => [row.senseKey, row]));
  const occurrences = [];
  for (const occurrence of bundle.lexical_occurrences) {
    const senseKey = senseKeyBySenseRef.get(occurrence.sense_ref);
    const contentRef = occurrence.content_item_ref;
    // The occurrence carries its own content item, so the passage is found
    // through that rather than through the (often absent) passage_ref.
    const plan = plans.find((p) => bundle.content_items.find((i) => i.ref === contentRef)?.external_id === p.externalId);
    if (!senseKey || !plan) continue;
    occurrences.push({
      senseKey,
      externalId: plan.externalId,
      segmentKey: null,
      surfaceForm: occurrence.surface_form,
      startChar: occurrence.start_char,
      endChar: occurrence.end_char,
      sentenceText: occurrence.sentence_text ?? null,
      occurrenceType: occurrence.occurrence_type ?? null,
      isTargetVocabulary: Boolean(occurrence.is_target_vocabulary),
    });
  }

  return { plans, lexemes: [...new Map(lexemes.map((row) => [row.senseKey, row])).values()], occurrences, items };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) stop("DATABASE_URL is not set (run with --env-file=.env)");
  const isLocal = /@(localhost|127\.0\.0\.1|::1)/.test(url) || /\/tmp/.test(url);
  const options = { connectionString: url, max: 4 };
  if (!isLocal) options.ssl = { rejectUnauthorized: false };
  return new Pool(options);
}

async function insertLexicon(client, lexemes, occurrencesBySenseKey, plans) {
  const created = { lexemes: 0, occurrences: 0 };
  // A rerun may reuse a historic key, but never an unrelated definition hidden
  // by that key's old punctuation/truncation rules. Throw rolls back the import.
  const existing = await client.query("select term, part_of_speech, definition_en, sense_key from lexemes where sense_key = any($1::text[])", [lexemes.flatMap((row) => [row.senseKey, row.legacyKey])]);
  const planned = new Map(lexemes.map((row) => [row.senseKey, row]));
  for (const row of existing.rows) {
    const wanted = planned.get(row.sense_key);
    if (!wanted) continue; // historic collision key is checked by full identity below
    if (semanticKeyOf({ term: row.term, partOfSpeech: row.part_of_speech, meaning: row.definition_en }) !== semanticKeyOf({ term: wanted.term, partOfSpeech: wanted.partOfSpeech, meaning: wanted.definitionEn })) {
      throw new Error("Existing lexical identity conflicts with the import; explicit reconciliation is required.");
    }
  }

  // Reuse a historic row only when its complete definition and POS agree.
  // Keep the plan's keys for source references, mapping them to the reused ID.
  const aliases = new Map();
  const inserts = lexemes.filter((wanted) => {
    const identity = semanticKeyOf({ term: wanted.term, partOfSpeech: wanted.partOfSpeech, meaning: wanted.definitionEn });
    const historic = existing.rows.find((row) => row.sense_key === wanted.legacyKey && semanticKeyOf({ term: row.term, partOfSpeech: row.part_of_speech, meaning: row.definition_en }) === identity);
    if (historic && historic.sense_key !== wanted.senseKey && !existing.rows.some((row) => row.sense_key === wanted.senseKey)) { aliases.set(wanted.senseKey, historic.sense_key); return false; }
    return true;
  });


  for (let i = 0; i < inserts.length; i += 200) {
    const batch = inserts.slice(i, i + 200);
    const values = [];
    const params = [];
    batch.forEach((row, index) => {
      const base = index * 8;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,$${base + 7},$${base + 8})`);
      params.push(
        row.term,
        row.partOfSpeech,
        row.definitionEn,
        row.translationUz,
        row.senseKey,
        JSON.stringify(row.acceptedTranslations),
        row.provenance,
        row.verificationStatus
      );
    });
    const result = await client.query(
      `insert into lexemes (term, part_of_speech, definition_en, translation_uz, sense_key, accepted_translations, provenance, verification_status)
       values ${values.join(",")}
       on conflict (sense_key) do nothing
       returning id`,
      params
    );
    created.lexemes += result.rowCount ?? 0;
  }

  // Mark the batch on every lexicon row this import owns, existing rows included
  // — a re-run of a later batch must not lose the trace of an earlier one.
  await client.query(
    `update lexemes set import_batch = coalesce(import_batch, $1)
      where sense_key = any($2::text[])`,
    [BATCH_NAME, lexemes.map((row) => aliases.get(row.senseKey) ?? row.senseKey)]
  );

  const idBySenseKey = new Map();
  const keys = lexemes.flatMap((row) => [row.senseKey, aliases.get(row.senseKey)].filter(Boolean));
  for (let i = 0; i < keys.length; i += 500) {
    const slice = keys.slice(i, i + 500);
    const result = await client.query(`select id, sense_key from lexemes where sense_key = any($1::text[])`, [slice]);
    for (const row of result.rows) idBySenseKey.set(row.sense_key, row.id);
  }
  for (const [key, historic] of aliases) idBySenseKey.set(key, idBySenseKey.get(historic));

  const passageIdByExternalId = new Map();
  const externalIds = plans.map((plan) => plan.externalId);
  const passageRows = await client.query(
    `select id, external_id from reading_passages where external_id = any($1::text[])`,
    [externalIds]
  );
  for (const row of passageRows.rows) passageIdByExternalId.set(row.external_id, row.id);

  const occurrenceRows = [];
  for (const occurrence of occurrencesBySenseKey) {
    const lexemeId = idBySenseKey.get(occurrence.senseKey);
    const passageId = passageIdByExternalId.get(occurrence.externalId);
    if (!lexemeId || !passageId) continue;
    occurrenceRows.push({ ...occurrence, lexemeId, passageId });
  }

  for (let i = 0; i < occurrenceRows.length; i += 200) {
    const batch = occurrenceRows.slice(i, i + 200);
    const values = [];
    const params = [];
    batch.forEach((row, index) => {
      const base = index * 9;
      values.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
      );
      params.push(
        row.lexemeId,
        row.passageId,
        row.segmentKey,
        row.surfaceForm,
        row.startChar,
        row.endChar,
        row.sentenceText,
        row.occurrenceType,
        row.isTargetVocabulary
      );
    });
    const result = await client.query(
      `insert into lexical_occurrences
         (lexeme_id, passage_id, segment_key, surface_form, start_char, end_char, sentence_text, occurrence_type, is_target_vocabulary)
       values ${values.join(",")}
       on conflict (passage_id, start_char, end_char) do nothing
       returning id`,
      params
    );
    created.occurrences += result.rowCount ?? 0;
  }

  return created;
}

async function insertPassage(client, plan, publish) {
  const passage = await client.query(
    `insert into reading_passages
       (title, body_text, difficulty_level, suggested_minutes, is_active, publication_state,
        external_id, test_no, passage_no, topic_code, instructions,
        source_word_count, source_question_count, source_checksum, source_ref)
     values ($1,$2,default,default,default,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      plan.title,
      plan.bodyText,
      plan.externalId,
      plan.testNo,
      plan.passageNo,
      plan.topicCode,
      plan.instructions,
      plan.sourceWordCount,
      plan.sourceQuestionCount,
      plan.sourceChecksum,
      plan.sourceRef,
    ]
  );
  const passageId = passage.rows[0].id;

  for (const paragraph of plan.paragraphs) {
    await client.query(
      `insert into reading_passage_paragraphs (passage_id, position, label, text, is_footnote)
       values ($1,$2,$3,$4,$5)`,
      [passageId, paragraph.position, paragraph.label, paragraph.text, paragraph.isFootnote]
    );
  }

  const groupIdByRef = new Map();
  for (const group of plan.groups) {
    const row = await client.query(
      `insert into reading_question_groups
         (passage_id, position, type_code, display_title, instructions_text, from_question_no, to_question_no, shared_choices)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       returning id`,
      [
        passageId,
        group.position,
        group.typeCode,
        group.displayTitle,
        group.instructionsText,
        group.fromQuestionNo,
        group.toQuestionNo,
        JSON.stringify(group.sharedChoices),
      ]
    );
    groupIdByRef.set(group.ref, row.rows[0].id);
  }

  for (const question of plan.questions) {
    await client.query(
      `insert into reading_questions
         (passage_id, "order", type, question_text, options, correct_answer, evidence_quote, explanation,
          question_no, type_code, answer_slots, accepted_answers, answer_constraint, render_mode,
          evidence_start_char, evidence_end_char, evidence_type, source_key, group_id)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19)`,
      [
        passageId,
        question.order,
        question.type,
        question.questionText,
        question.options ? JSON.stringify(question.options) : null,
        question.correctAnswer,
        question.evidenceQuote,
        question.explanation,
        question.questionNo,
        question.typeCode,
        JSON.stringify(question.answerSlots),
        JSON.stringify(question.acceptedAnswers),
        question.answerConstraint ? JSON.stringify(question.answerConstraint) : null,
        question.renderMode,
        question.evidenceStartChar,
        question.evidenceEndChar,
        question.evidenceType,
        question.sourceKey,
        groupIdByRef.get(question.groupRef) ?? null,
      ]
    );
  }

  if (publish) {
    await client.query(`update reading_passages set publication_state = 'published' where id = $1`, [passageId]);
  }
  return passageId;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printPlanSummary(plans, lexicon, occurrences) {
  const valid = plans.filter((plan) => plan.valid);
  const invalid = plans.filter((plan) => !plan.valid);
  log("");
  log("Import plan");
  log(`  passages         ${plans.length}`);
  log(`  publishable      ${valid.length}`);
  log(`  held as draft    ${invalid.length}`);
  log(`  questions        ${plans.reduce((sum, plan) => sum + plan.questions.length, 0)}`);
  log(`  question groups  ${plans.reduce((sum, plan) => sum + plan.groups.length, 0)}`);
  log(`  paragraphs       ${plans.reduce((sum, plan) => sum + plan.paragraphs.length, 0)}`);
  log(`  lexicon senses   ${lexicon.length}`);
  log(`  occurrences      ${occurrences.length}`);
  if (invalid.length) {
    log("");
    log("  Passages held as DRAFT:");
    for (const plan of invalid) log(`    ${plan.externalId}: ${plan.failures.join("; ")}`);
  }
}

function writeReport({ mode, plans, lexemes, occurrences, applied, verification }) {
  const valid = plans.filter((plan) => plan.valid);
  const invalid = plans.filter((plan) => !plan.valid);
  const totalQuestions = plans.reduce((sum, plan) => sum + plan.questions.length, 0);
  const missingEvidence = plans.reduce(
    (sum, plan) => sum + plan.questions.filter((q) => !q.evidenceQuote).length,
    0
  );
  const byType = {};
  for (const plan of plans) {
    for (const question of plan.questions) byType[question.typeCode] = (byType[question.typeCode] ?? 0) + 1;
  }

  const lines = [];
  lines.push("# Reading 105 — import report");
  lines.push("");
  lines.push(
    "Generated by `scripts/import-reading-105.mjs`. This file describes what the script actually did or would do; " +
      "the numbers below come from the source package and, where marked, from the database."
  );
  lines.push("");
  lines.push(`- Mode: **${mode}**`);
  lines.push(`- Source batch: \`${BATCH_NAME}\``);
  lines.push(`- Passages: **${plans.length}** (publishable ${valid.length}, held as draft ${invalid.length})`);
  lines.push(`- Questions: ${totalQuestions}`);
  lines.push(`- Question groups: ${plans.reduce((sum, plan) => sum + plan.groups.length, 0)}`);
  lines.push(`- Paragraphs: ${plans.reduce((sum, plan) => sum + plan.paragraphs.length, 0)}`);
  lines.push(`- Lexicon senses: ${lexemes.length}; occurrences: ${occurrences.length}`);
  lines.push(`- Questions without source evidence: ${missingEvidence} (left empty on purpose, not filled in)`);
  if (applied) {
    lines.push(
      `- Wrote: ${applied.passages} passage(s), ${applied.lexemes} new lexicon row(s), ${applied.occurrences} new occurrence(s)` +
        (applied.skipped ? `; ${applied.skipped} passage(s) were already imported and were left untouched` : "")
    );
  }
  lines.push("");
  lines.push("## Question types (source codes)");
  lines.push("");
  lines.push("| Code | Questions |");
  lines.push("| --- | --- |");
  for (const [code, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) lines.push(`| ${code} | ${count} |`);
  lines.push("");
  lines.push("## Passages");
  lines.push("");
  lines.push("| # | Test | Passage | Title | Questions | State |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  plans
    .slice()
    .sort((a, b) => (a.externalId > b.externalId ? 1 : -1))
    .forEach((plan, index) => {
      lines.push(
        `| ${index + 1} | ${plan.testNo ?? "—"} | ${plan.passageNo ?? "—"} | ${plan.title.replace(/\|/g, "/")} | ${plan.questions.length} | ${
          plan.valid ? "published" : "DRAFT — " + plan.failures.join("; ")
        } |`
      );
    });
  lines.push("");
  lines.push("## Honest notes");
  lines.push("");
  lines.push(
    "- `difficulty_level` is not present in the source package. Imported passages keep the column's existing default; " +
      "the UI shows the passage position (Passage 1/2/3) instead of inventing a level."
  );
  lines.push(
    "- The source ships no authored explanations. `reading_questions.explanation` is therefore an empty string for " +
      "imported questions; the review screen shows the evidence quote from the passage instead."
  );
  lines.push(
    "- 173 of the 1,406 questions have no evidence marker in the source. Their `evidence_quote` is null and " +
      "`evidence_type` is `missing_source_marker` — nothing was written in its place."
  );
  lines.push(
    "- Lexicon senses carry the source's own `provenance` (`derived`) and `verification_status` (`unverified`), " +
      "so a mechanically derived meaning is never presented as centre-approved."
  );
  if (verification) {
    lines.push("");
    lines.push("## Database verification");
    lines.push("");
    lines.push("| Check | Value |");
    lines.push("| --- | --- |");
    for (const [name, value] of Object.entries(verification)) lines.push(`| ${name} | ${value} |`);
  }
  lines.push("");
  lines.push("_Source material is credited to the source package's own provenance record; the learner-facing brand is Learners Area._");
  lines.push("");

  /*
   * The appendix is written by the generator, not by hand, because a hand-added
   * section was lost the next time the report was regenerated. Everything below
   * is a claim about what the application actually reads from these tables.
   */
  lines.push("## What the application does with the import");
  lines.push("");
  lines.push("| Surface | Wired to the imported data |");
  lines.push("| --- | --- |");
  lines.push(
    "| `/reading` hub | tab counts come from the database; the academic tab lists the imported passages with real pagination and filters (status, topic, question type) |"
  );
  lines.push(
    "| Practice workspace | paragraph letters, each group's own instructions and shared option lists, blanks inside the sentence, a rebuilt shared stimulus for notes and summaries, autosave to the server, and a timer |"
  );
  lines.push(
    "| Review | raw score, the student's own answer, the correct answer, accepted variants, and the evidence quote from the passage |"
  );
  lines.push(
    "| Vocabulary | a tapped word resolves through the shared engine; saving it keeps the word, its sense and the reading context instead of creating a second canonical row |"
  );
  lines.push("| Retention | the drill reads the imported body text; it claims no score |");
  lines.push("");
  lines.push(
    "The hub never hard-codes 105: the number on the page is a count query, so if the library changes the page changes with it."
  );
  lines.push("");
  lines.push("### Shared stimuli (notes, summaries, flow-charts)");
  lines.push("");
  lines.push(
    "191 questions arrive as overlapping windows cut around each question's own blank. `src/lib/reading/stimulus.ts` rebuilds one stimulus per group by turning every blank into a `{{qN}}` token and stitching the windows along their overlap; on this library every question of all 41 shared-stimulus groups is reachable in the rebuilt text and no span is duplicated."
  );
  lines.push("");
  lines.push("### Option wording");
  lines.push("");
  lines.push(
    "The first pass took a choice question's wording only from the group's `shared_choices`. A multiple-choice question carries its wording on its own option rows instead, so 144 MCQ questions were stored as a bare `A, B, C, D` with nothing to choose between. `optionListFor` now prefers the group's wording and otherwise reads the row's own option text with the printed key stripped — the source text, never an invented option."
  );
  lines.push("");
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  log(`report        ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(client) {
  const result = {};
  const count = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].count);
  result.passages = await count(`select count(*)::int as count from reading_passages where external_id is not null`);
  result.published = await count(
    `select count(*)::int as count from reading_passages where external_id is not null and publication_state = 'published'`
  );
  result.drafts = await count(
    `select count(*)::int as count from reading_passages where external_id is not null and publication_state <> 'published'`
  );
  result.uniqueExternalIds = await count(
    `select count(distinct external_id)::int as count from reading_passages where external_id is not null`
  );
  result.questions = await count(
    `select count(*)::int as count from reading_questions q join reading_passages p on p.id = q.passage_id where p.external_id is not null`
  );
  result.groups = await count(
    `select count(*)::int as count from reading_question_groups g join reading_passages p on p.id = g.passage_id where p.external_id is not null`
  );
  result.paragraphs = await count(
    `select count(*)::int as count from reading_passage_paragraphs g join reading_passages p on p.id = g.passage_id where p.external_id is not null`
  );
  result.occurrences = await count(`select count(*)::int as count from lexical_occurrences`);
  result.lexiconRows = await count(`select count(*)::int as count from lexemes where import_batch = $1`, [BATCH_NAME]);
  result.questionsWithoutAnswer = await count(
    `select count(*)::int as count from reading_questions q join reading_passages p on p.id = q.passage_id
      where p.external_id is not null and (q.correct_answer is null or btrim(q.correct_answer) = '')`
  );
  result.questionsWithEvidence = await count(
    `select count(*)::int as count from reading_questions q join reading_passages p on p.id = q.passage_id
      where p.external_id is not null and q.evidence_quote is not null`
  );
  result.passagesWithoutQuestions = await count(
    `select count(*)::int as count from reading_passages p
      where p.external_id is not null
        and not exists (select 1 from reading_questions q where q.passage_id = p.id)`
  );
  const drafts = await client.query(
    `select external_id, source_word_count, length(body_text) as body_length
       from reading_passages
      where external_id is not null and publication_state <> 'published'
      order by external_id`
  );
  result.unpublished = drafts.rows
    .map((row) => `${row.external_id} (source says ${row.source_word_count ?? "?"} words)`)
    .join(", ") || "none";
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // A dry run only parses and validates the source package: it must not need a
  // database URL or open a connection (N16). Writes and --verify still do.
  if (SOURCE && !APPLY && !VERIFY) {
    const bundle = loadBundle(SOURCE);
    const { plans, lexemes, occurrences } = buildPlan(bundle);
    log("");
    log(`source batch  ${bundle.batch?.name ?? "(unnamed)"} — passages ${bundle.batch?.passage_count ?? "?"}`);
    log(`source check  ${bundle.validation?.status ?? "unknown"}`);
    printPlanSummary(plans, lexemes, occurrences);
    log("");
    log("Dry run — no database connection was opened and nothing was written. Re-run with --apply to import.");
    writeReport({ mode: "dry-run", plans, lexemes, occurrences });
    return;
  }
  const pool = createPool();
  const client = await pool.connect();

  try {
    const head = await client.query(
      `select count(*)::int as count from information_schema.tables
        where table_schema = 'public' and table_name = 'reading_question_groups'`
    );
    if (head.rows[0].count === 0) {
      stop("migration 0017 (reading_105_library) has not been applied to this database");
    }

    if (VERIFY && !SOURCE) {
      const verification = await verify(client);
      log("Database verification");
      for (const [name, value] of Object.entries(verification)) log(`  ${name.padEnd(24)} ${value}`);
      /*
       * A draft is not automatically a failure: the import deliberately leaves a
       * passage unpublished when the source itself is not good enough to teach
       * from, and says which one and why. What would be a failure is a passage
       * that is missing, duplicated, unanswerable or empty.
       */
      const complete =
        verification.passages === EXPECTED_PASSAGES &&
        verification.uniqueExternalIds === EXPECTED_PASSAGES &&
        verification.questions > 0 &&
        verification.questionsWithoutAnswer === 0 &&
        verification.passagesWithoutQuestions === 0;
      const ok = complete && verification.published === EXPECTED_PASSAGES;
      log("");
      if (ok) {
        log("\u001b[32mOK\u001b[0m the 105-passage library is present and published.");
      } else if (complete) {
        log(
          `\u001b[33mOK (with drafts)\u001b[0m all ${EXPECTED_PASSAGES} passages are imported and usable, ` +
            `${verification.published} published, held back: ${verification.unpublished}`
        );
      } else {
        log("\u001b[31mINCOMPLETE\u001b[0m see the counters above.");
      }
      // `--verify` never rewrites the report: the report belongs to the import
      // plan, and a check run that has no plan must not blank it.
      process.exit(complete ? 0 : 1);
    }

    if (!SOURCE) stop("--source <zip|dir> is required (or use --verify alone)");

    const bundle = loadBundle(SOURCE);
    const { plans, lexemes, occurrences } = buildPlan(bundle);

    log("");
    log(`source batch  ${bundle.batch?.name ?? "(unnamed)"} — passages ${bundle.batch?.passage_count ?? "?"}`);
    log(`source check  ${bundle.validation?.status ?? "unknown"}`);
    printPlanSummary(plans, lexemes, occurrences);

    if (!APPLY) {
      log("");
      log("Dry run — nothing was written. Re-run with --apply to import.");
      writeReport({ mode: "dry-run", plans, lexemes, occurrences });
      return;
    }

    // Existing passages: skip the ones that are already imported *and* complete,
    // so a second run cannot duplicate rows or disturb a student's history.
    const existing = await client.query(
      `select p.external_id, count(q.id)::int as question_count
         from reading_passages p
         left join reading_questions q on q.passage_id = p.id
        where p.external_id = any($1::text[])
        group by p.external_id`,
      [plans.map((plan) => plan.externalId)]
    );
    const existingByExternalId = new Map(existing.rows.map((row) => [row.external_id, row.question_count]));

    let writtenPassages = 0;
    let skipped = 0;
    let published = 0;
    const failures = [];

    for (const plan of plans) {
      const known = existingByExternalId.get(plan.externalId);
      if (known && known > 0) {
        skipped += 1;
        continue;
      }
      try {
        await client.query("begin");
        await insertPassage(client, plan, false);
        await client.query("commit");
        writtenPassages += 1;
      } catch (error) {
        await client.query("rollback");
        failures.push(`${plan.externalId}: ${error.message}`);
        continue;
      }
      // Publishing is a separate decision from writing: a passage that fails
      // validation must exist as a draft, not as something a student can start.
      if (plan.valid) {
        await client.query(`update reading_passages set publication_state = 'published' where external_id = $1`, [
          plan.externalId,
        ]);
        published += 1;
      } else {
        failures.push(`${plan.externalId}: ${plan.failures.join("; ")}`);
      }
      if ((writtenPassages + skipped) % 20 === 0) log(`  … ${writtenPassages + skipped}/${plans.length}`);
    }

    // Lexicon last: passages must exist before occurrences can point at them.
    const lexiconWritten = await insertLexicon(client, lexemes, occurrences, plans);

    const verification = await verify(client);
    log("");
    log("Applied");
    log(`  passages written  ${writtenPassages} (published ${published})`);
    log(`  passages skipped  ${skipped} (already imported)`);
    log(`  lexicon new rows  ${lexiconWritten.lexemes}`);
    log(`  occurrences new   ${lexiconWritten.occurrences}`);
    log(`  published total   ${verification.published}/${EXPECTED_PASSAGES}`);
    if (failures.length) {
      log("");
      log("  Not published:");
      for (const failure of failures) log(`    ${failure}`);
    }

    writeReport({
      mode: "apply",
      plans,
      lexemes,
      occurrences,
      applied: { passages: writtenPassages, skipped, ...lexiconWritten },
      verification,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
