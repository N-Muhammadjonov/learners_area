import "server-only";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes } from "@/db/schema";
import { addVocabularyBatch } from "@/lib/services/vocabulary/engine";
import { activeRelease, entryById, rows } from "./store";
import {materializeDictionarySense} from "./materialize-sense";
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
    if (!entry) throw Error("sense_not_found");
    return materializeDictionarySense(tx,entry,senseId);
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
