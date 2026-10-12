import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes, vocabularyTopicPackWords, vocabularyTopicPacks } from "@/db/schema";
import { pinVersion } from "@/lib/content/versions";
import { senseKeyOf } from "@/lib/services/vocabulary/dedupe";
import { isLive } from "@/lib/services/cms/publication";
import { TOPIC_PACKS, type PackWord } from "@/lib/services/vocabulary/packs";
import type { ImportTransaction } from "@/lib/import/core/dry-run";

/**
 * VOCABULARY TOPIC PACKS as canonical content (§31, §76, §100).
 *
 * A pack is authored in the database and versioned like every other content type.
 * Its words are NOT stored here: each word IS a `lexemes` row — the one canonical
 * sense table that Reading, Listening and TED/Podcast occurrences already resolve
 * into. This module owns only the pack (identity, labels, publication) and the
 * membership list (which senses, in which order).
 *
 * The built-in TypeScript packs remain as a COMPATIBILITY fallback: while the
 * table is empty (or unreadable), the learner sees exactly what they saw before.
 * Once the backfill has run, the database is the source of truth and adding a pack
 * needs no deployment.
 */

export type TopicPackWordInput = PackWord;

export type SavePackInput = {
  actorUserId: string;
  sourceRef: string;
  slug: string;
  labelEn: string;
  labelUz?: string | null;
  topicCode?: string | null;
  level?: string | null;
  position?: number;
  words: TopicPackWordInput[];
  /** Create as draft (default) or publish immediately. */
  publish?: boolean;
};

export type SavePackResult = { ok: true; packId: string; versionId: string; words: number } | { ok: false; issues: { code: string; message: string }[] };

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Resolve a word to its canonical sense, creating it when it is genuinely new.
 * Dedup is `senseKeyOf` — the same identity the vocabulary engine uses — so a pack
 * can never introduce a second row for a word the learner already has.
 */
async function resolveLexeme(
  tx: ImportTransaction & { insert: typeof db.insert },
  word: TopicPackWordInput,
): Promise<string> {
  const senseKey = senseKeyOf({ term: word.term, partOfSpeech: word.partOfSpeech, meaning: word.definitionEn });
  const existing = await tx.select({ id: lexemes.id }).from(lexemes).where(eq(lexemes.senseKey, senseKey)).limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await tx
    .insert(lexemes)
    .values({
      term: word.term,
      partOfSpeech: word.partOfSpeech,
      definitionEn: word.definitionEn,
      translationUz: word.translationUz,
      exampleSentence: word.example,
      collocations: word.collocations ?? null,
      senseKey,
      provenance: "topic_pack",
    })
    .returning({ id: lexemes.id });
  return created!.id;
}

/** Author or revise a pack. The membership list is replaced as a set. */
export async function saveTopicPack(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update },
  input: SavePackInput,
): Promise<SavePackResult> {
  const issues: { code: string; message: string }[] = [];
  if (!input.labelEn.trim()) issues.push({ code: "missing_label", message: "A pack needs an English label." });
  if (slug(input.sourceRef) !== input.sourceRef)
    issues.push({ code: "unstable_source_ref", message: "A source reference must be lower-case a–z, 0–9, dot, dash or underscore." });
  if (input.words.length === 0) issues.push({ code: "empty_pack", message: "A pack needs at least one word." });
  for (const [index, word] of input.words.entries()) {
    if (!word.term.trim()) issues.push({ code: "missing_term", message: `Word ${index + 1} has no term.` });
    if (!word.definitionEn.trim()) issues.push({ code: "missing_definition", message: `Word ${index + 1} has no definition.` });
  }
  if (issues.length) return { ok: false, issues };

  const [existing] = await tx.select().from(vocabularyTopicPacks).where(eq(vocabularyTopicPacks.sourceRef, input.sourceRef)).limit(1);
  if (existing && existing.publicationState === "published" && !input.publish)
    return { ok: false, issues: [{ code: "pack_published", message: "A published pack is frozen: revise it into a draft first." }] };

  const values = {
    sourceRef: input.sourceRef,
    slug: slug(input.slug || input.labelEn),
    labelEn: input.labelEn.trim(),
    labelUz: input.labelUz ?? null,
    topicCode: input.topicCode ?? null,
    level: input.level ?? null,
    position: input.position ?? 0,
    updatedAt: new Date(),
  };

  let packId = existing?.id;
  if (packId) await tx.update(vocabularyTopicPacks).set(values).where(eq(vocabularyTopicPacks.id, packId));
  else {
    const [created] = await tx
      .insert(vocabularyTopicPacks)
      .values({ ...values, createdByUserId: input.actorUserId, publicationState: input.publish ? "published" : "draft" })
      .returning({ id: vocabularyTopicPacks.id });
    packId = created!.id;
  }
  if (existing && input.publish) await tx.update(vocabularyTopicPacks).set({ publicationState: "published" }).where(eq(vocabularyTopicPacks.id, packId));

  await tx.delete(vocabularyTopicPackWords).where(eq(vocabularyTopicPackWords.packId, packId!));
  const lexemeIds: string[] = [];
  for (const word of input.words) lexemeIds.push(await resolveLexeme(tx, word));
  await tx.insert(vocabularyTopicPackWords).values(
    lexemeIds.map((lexemeId, index) => ({ packId: packId!, lexemeId, position: index + 1 })),
  );

  const pinned = await pinVersion(tx, {
    module: "vocabulary",
    contentType: "topic_pack",
    sourceRef: input.sourceRef,
    title: values.labelEn,
    track: "unspecified",
    content: {
      labelEn: values.labelEn,
      labelUz: values.labelUz,
      topicCode: values.topicCode,
      level: values.level,
      // The pack's content is its senses: term + pos + definition, by identity.
      words: input.words.map((word) => ({ term: word.term, partOfSpeech: word.partOfSpeech, definitionEn: word.definitionEn })),
    },
    publicationState: input.publish ? "published" : "draft",
    targetType: "vocabulary_topic_pack",
    targetId: packId!,
    actorUserId: input.actorUserId,
    provenance: { origin: "authored", words: input.words.length },
  });

  return { ok: true, packId: packId!, versionId: pinned.version.id, words: lexemeIds.length };
}

/** A pack as a learner may see it: labels plus the canonical senses it contains. */
export type LearnerPack = { id: string; slug: string; label: string; labelUz: string | null; words: PackWord[] };

export async function listTopicPacksForLearner(locale: "en" | "uz" = "en", executor: { select: typeof db.select } = db): Promise<LearnerPack[]> {
  const packs = await executor
    .select()
    .from(vocabularyTopicPacks)
    .orderBy(asc(vocabularyTopicPacks.position), asc(vocabularyTopicPacks.labelEn))
    .where(and(eq(vocabularyTopicPacks.publicationState, "published")));

  const live = packs.filter((pack) => isLive({ publicationState: pack.publicationState, publishAt: pack.publishAt }));
  if (live.length === 0) return builtInPacks(locale);

  const membership = await executor
    .select({
      packId: vocabularyTopicPackWords.packId,
      position: vocabularyTopicPackWords.position,
      term: lexemes.term,
      partOfSpeech: lexemes.partOfSpeech,
      definitionEn: lexemes.definitionEn,
      translationUz: lexemes.translationUz,
      exampleSentence: lexemes.exampleSentence,
      collocations: lexemes.collocations,
    })
    .from(vocabularyTopicPackWords)
    .innerJoin(lexemes, eq(lexemes.id, vocabularyTopicPackWords.lexemeId))
    .where(inArray(vocabularyTopicPackWords.packId, live.map((pack) => pack.id)))
    .orderBy(asc(vocabularyTopicPackWords.position));

  return live.map((pack) => ({
    id: pack.slug,
    slug: pack.slug,
    label: locale === "uz" ? pack.labelUz ?? pack.labelEn : pack.labelEn,
    labelUz: pack.labelUz,
    words: membership
      .filter((row) => row.packId === pack.id)
      .map((row) => ({
        term: row.term,
        partOfSpeech: row.partOfSpeech ?? "",
        definitionEn: row.definitionEn,
        translationUz: row.translationUz ?? "",
        example: row.exampleSentence ?? "",
        collocations: row.collocations ?? undefined,
      })),
  }));
}

/** Read one pack by its slug, falling back to the built-in packs by id. */
export async function findTopicPackForLearner(slugOrId: string, executor: { select: typeof db.select } = db): Promise<LearnerPack | null> {
  const packs = await listTopicPacksForLearner("en", executor);
  return packs.find((pack) => pack.slug === slugOrId || pack.id === slugOrId) ?? null;
}

/** The built-in packs, in the shape the database returns. COMPATIBILITY ONLY. */
export function builtInPacks(locale: "en" | "uz" = "en"): LearnerPack[] {
  return TOPIC_PACKS.map((pack) => ({
    id: pack.id,
    slug: pack.id,
    label: locale === "uz" ? pack.label.uz : pack.label.en,
    labelUz: pack.label.uz,
    words: pack.words,
  }));
}
