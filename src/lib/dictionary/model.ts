import { dictionaryPos } from "./labels";
import { createHash } from "node:crypto";
import { CASE_FOLD } from "./casefold";
import { z } from "zod";
export const BASE_RELEASE = "rel-v1-606b65c5282a75647c9928c3";
export const BASE_COMMIT = "594c00904e07702c27329f1c0ce9ec6dadee1adb";
export const NORMALIZATION_VERSION =
  "unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1";
/** Dictionary normalization is versioned independently of legacy learner grading. */
export function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u02bb\u02bc\u2018\u2019`\u00b4]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/./gu, (c) => CASE_FOLD[c] ?? c.toLowerCase())
    .replace(/\s+/gu, " ")
    .trim();
}
const id = z.string().uuid();
const text = z.string().trim().min(1).max(6000);
const uz = text.refine(
  (v) => !/[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]/u.test(v),
  "Uzbek Latin required",
);
export const senseSchema = z
  .object({
    sense_id: id,
    definition_en: text,
    definition_uz: uz,
    translations: z
      .array(
        z
          .object({
            translation_id: id,
            text: uz,
            order: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    examples: z
      .array(z.object({ example_id: id, text_en: text, text_uz: uz }).strict())
      .max(100),
    editorial: z.object({
      status:z.enum(['owner_supplied','source_checked','human_reviewed','ai_draft']),
      translation_status:z.enum(['owner_supplied','human_reviewed','ai_draft']),
      reference_urls:z.array(z.string().url().max(1000)).max(10),
      provenance:z.string().min(1).max(120),
    }).strict().optional(),
    sense_order: z.number().int().nonnegative().optional(),
    register: z.string().max(120).optional(),
    usage_label: z.string().max(120).optional(),
    domain_tags: z.array(z.string().max(120)).max(30).optional(),
    cefr: z.string().max(12).optional(),
  })
  .strict();
export const entrySchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    release_id: z.string().regex(/^rel-v1-[a-f0-9]{24}$/),
    lexeme_id: id,
    display_lemma: z.string().trim().min(1).max(120),
    normalized_search_form: z.string().min(1).max(160),
    lexical_type: z.string().min(1).max(24),
    part_of_speech: z.string().min(1).max(30),
    homograph_group: z.string().nullable(),
    is_satellite: z.boolean(),
    pronunciations: z.array(
      z
        .object({
          ipa: z.string().max(120),
          variety: z.string().max(120).optional(),
        })
        .strict(),
    ),
    forms: z.array(
      z
        .object({
          surface_form: z.string().max(160),
          form_type: z.string().max(60).optional(),
        })
        .strict(),
    ),
    senses: z.array(senseSchema).min(1).max(300),
    relations: z.array(
      z
        .object({
          relation_type: z.string(),
          source_sense_id: id.optional(),
          target_lexeme_id: id,
          target_sense_id: id.nullable().optional(),
          display_lemma: z.string(),
          part_of_speech: z.string(),
          lexical_type: z.string(),
        })
        .strict(),
    ),
    collocations: z.array(
      z
        .object({
          text: z.string(),
          sense_id: id.nullable().optional(),
          pattern_type: z.string().optional(),
          direction: z.string().optional(),
        })
        .strict(),
    ),
    attribution: z
      .array(
        z
          .object({
            source_name: z.string(),
            snapshot_id: z.string(),
            creator: z.string(),
            source_url: z.string(),
            license_reference: z.string(),
            license_url: z.string(),
            attribution_text: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type Entry = z.infer<typeof entrySchema>;
export type Sense = z.infer<typeof senseSchema>;
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export const sha = (v: string) => createHash("sha256").update(v).digest("hex");
/** Explicit stable project namespace. IDs depend on identity, never learner text edits. */
export function projectId(kind: string, key: string) {
  const b = createHash("sha256")
    .update(`learners-area-dictionary-v1:${kind}:${key}`)
    .digest()
    .subarray(0, 16);
  b[6] = (b[6]! & 15) | 80;
  b[8] = (b[8]! & 63) | 128;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function entryTerms(entry: Entry) {
  const terms = new Map<
    string,
    { direction: "EN" | "UZ"; term: string; rank: number }
  >();
  const add = (direction: "EN" | "UZ", v: string, rank: number) => {
    const term = normalizeSearch(v);
    if (!term || term.length > 6000) return;
    const key = direction + ":" + term;
    const old = terms.get(key);
    if (!old || rank < old.rank) terms.set(key, { direction, term, rank });
  };
  add("EN", entry.display_lemma, 0);
  add("EN", entry.normalized_search_form, 1);
  for (const form of entry.forms) add("EN", form.surface_form, 2);
  for (const sense of entry.senses) {
    for (const t of sense.translations) {
      add("UZ", t.text, 0);
      for (const word of normalizeSearch(t.text).split(" ")) add("UZ", word, 1);
    }
    add("UZ", sense.definition_uz, 2);
    for (const word of normalizeSearch(sense.definition_uz).split(" "))
      add("UZ", word, 2);
  }
  return [...terms.values()];
}
export const draftSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("edit_sense"),
      lexemeId: id,
      senseId: id,
      translationUz: uz.optional(),
      definitionUz: uz.optional(),
      examples: z
        .array(z.object({ exampleId: id, textUz: uz }).strict())
        .max(100)
        .optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("add_sense"),
      lexemeId: id,
      definitionEn: text,
      translationUz: uz,
      definitionUz: uz,
      examples: z
        .array(z.object({ textEn: text, textUz: uz }).strict())
        .max(100)
        .default([]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("add_lexeme"),
      lemma: z.string().trim().min(1).max(120),
      partOfSpeech: z.enum(["n", "v", "a", "r", "noun", "verb", "adjective", "adverb", "preposition", "pronoun", "determiner", "conjunction", "interjection", "numeral", "modal verb", "auxiliary verb"]),
      lexicalType: z.enum([
        "word",
        "noun_phrase",
        "verb_phrase",
        "phrasal_verb",
        "idiom",
        "collocation",
        "fixed_expression",
        "compound",
        "technical_term",
        "phrase",
      ]),
      definitionEn: text,
      translationUz: uz,
      definitionUz: uz,
      examples: z
        .array(z.object({ textEn: text, textUz: uz }).strict())
        .max(100)
        .default([]),
    })
    .strict(),
]);
export type Draft = z.infer<typeof draftSchema>;
export function applyDraft(
  entries: Entry[],
  draft: Draft,
  releaseId: string,
): Entry {
  let e: Entry | undefined;
  if (draft.operation === "add_lexeme") {
    if (
      entries.some(
        (x) =>
          normalizeSearch(x.display_lemma) === normalizeSearch(draft.lemma) &&
          dictionaryPos(x.part_of_speech) === dictionaryPos(draft.partOfSpeech) &&
          x.lexical_type === draft.lexicalType,
      )
    )
      throw Error("duplicate_lexeme");
    const key = [
      normalizeSearch(draft.lemma),
      dictionaryPos(draft.partOfSpeech),
      draft.lexicalType,
    ].join("|");
    e = {
      schema_version: "1.0.0",
      release_id: releaseId,
      lexeme_id: projectId("lexeme", key),
      display_lemma: draft.lemma,
      normalized_search_form: normalizeSearch(draft.lemma),
      part_of_speech: draft.partOfSpeech,
      lexical_type: draft.lexicalType,
      homograph_group: null,
      is_satellite: false,
      pronunciations: [],
      forms: [],
      senses: [],
      relations: [],
      collocations: [],
      attribution: [
        {
          source_name: "Learners Area",
          snapshot_id: "learners_area_custom",
          creator: "Learners Area",
          source_url: "",
          license_reference: "Learners Area owned",
          license_url: "",
          attribution_text: "Learners Area custom entry",
        },
      ],
    };
  } else e = entries.find((x) => x.lexeme_id === draft.lexemeId);
  if (!e) throw Error("entry_not_found");
  e = structuredClone(e);
  e.release_id = releaseId;
  if (draft.operation === "edit_sense") {
    const s = e.senses.find((x) => x.sense_id === draft.senseId);
    if (!s) throw Error("sense_not_found");
    if (draft.translationUz !== undefined)
      s.translations[0]!.text = draft.translationUz;
    if (draft.definitionUz !== undefined) s.definition_uz = draft.definitionUz;
    for (const edit of draft.examples ?? []) {
      const ex = s.examples.find((x) => x.example_id === edit.exampleId);
      if (!ex) throw Error("example_not_found");
      ex.text_uz = edit.textUz;
    }
  } else {
    if (
      e.senses.some(
        (x) =>
          normalizeSearch(x.definition_en) ===
          normalizeSearch(draft.definitionEn),
      )
    )
      throw Error("duplicate_sense");
    const senseId = projectId(
      "sense",
      e.lexeme_id + "|" + normalizeSearch(draft.definitionEn),
    );
    e.senses.push({
      sense_id: senseId,
      definition_en: draft.definitionEn,
      definition_uz: draft.definitionUz,
      translations: [
        {
          translation_id: projectId("translation", senseId),
          text: draft.translationUz,
          order: 0,
        },
      ],
      examples: draft.examples.map((x, i) => ({
        example_id: projectId("example", senseId + "|" + i + "|" + x.textEn),
        text_en: x.textEn,
        text_uz: x.textUz,
      })),
    });
  }
  return entrySchema.parse(e);
}

export function entryContentHash(entry:Entry){const {release_id:release,...content}=entry;void release;return sha(stableJson(content));}

/** English sense identity for verified presentation links; Uzbek edits do not change it. */
export const senseMeaningHash=(entry:Pick<Entry,"display_lemma"|"part_of_speech">,sense:Pick<Sense,"definition_en">)=>sha(stableJson({lemma:entry.display_lemma,pos:entry.part_of_speech,definition:sense.definition_en}));
