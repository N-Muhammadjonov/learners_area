import "server-only";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes } from "@/db/schema";
import { addVocabularyBatch } from "@/lib/services/vocabulary/engine";
import { activeRelease, entryById, rows } from "./store";
import { normalizeSearch } from "./model";
/** Exact external sense -> explicit existing app identity. No client meaning fields. */
export async function saveDictionarySense(
  userId: string,
  lexemeId: string,
  senseId: string,
  releaseId: string,
  folderId: string | null,
) {
  return db.transaction(async (tx) => {
    const appSenseId = await (async () => {
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    const channel = await activeRelease(tx);
    if (channel.active_release_id !== releaseId)
      throw Error("release_mismatch");
    const entry = await entryById(lexemeId, releaseId, tx);
    const sense = entry?.senses.find((s) => s.sense_id === senseId);
    if (!entry || !sense) throw Error("sense_not_found");
    const [mapped] = await rows<{ app_sense_id: string }>(
      sql`select app_sense_id from dictionary_sense_mappings where sense_id=${senseId}::uuid`,
      tx,
    );
    if (mapped) return mapped.app_sense_id;
    const pos =
      { n: "noun", v: "verb", a: "adjective", r: "adverb" }[
        entry.part_of_speech
      ] ?? entry.part_of_speech;
    const lexicalType =
      entry.lexical_type === "multiword" ? "phrase" : entry.lexical_type;
    const [unit] = await rows<{ id: string }>(
      sql`insert into lexical_units(id,lemma,lemma_norm,part_of_speech,lexical_type,provenance) values(${lexemeId}::uuid,${entry.display_lemma},${normalizeSearch(entry.display_lemma)},${pos},${lexicalType},'dictionary_release') on conflict(language,lemma_norm,part_of_speech,lexical_type) do update set lemma=lexical_units.lemma returning id`,
      tx,
    );
    await tx.execute(
      sql`insert into lexemes(id,term,part_of_speech,definition_en,translation_uz,example_sentence,sense_key,provenance,verification_status,lexical_unit_id) values(${senseId}::uuid,${entry.display_lemma},${pos},${sense.definition_en},${sense.translations[0]!.text},${sense.examples[0]?.text_en ?? null},${"dictionary:" + senseId},'dictionary_release','verified',${unit!.id}::uuid)`,
    );
    await tx.execute(
      sql`insert into dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method) values(${senseId}::uuid,${senseId}::uuid,${unit!.id}::uuid,'new_canonical')`,
    );
    return senseId;
    })();
  const sense = await tx.query.lexemes.findFirst({
    where: eq(lexemes.id, appSenseId),
  });
  if (!sense) throw Error("sense_not_found");
  return addVocabularyBatch({
    userId,
    sourceType: "dictionary",
    folderId,
    items: [{ ...sense, canonicalLexemeId: sense.id }],
  }, tx);
  });
}
export async function savedSenseIds(userId: string, senses: string[]) {
  if (!senses.length) return [];
  return rows<{ sense_id: string }>(
    sql`select m.sense_id from dictionary_sense_mappings m join user_vocabulary v on v.lexeme_id=m.app_sense_id where v.user_id=${userId}::uuid and m.sense_id in (${sql.join(
      senses.map((id) => sql`${id}::uuid`),
      sql`,`,
    )})`,
  );
}
