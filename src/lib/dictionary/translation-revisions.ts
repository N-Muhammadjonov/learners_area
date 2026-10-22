import {z} from 'zod';
import {entrySchema,senseMeaningHash,sha,stableJson,type Entry} from './model';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const translationRevisionSchema=z.object({version:z.literal(1),status:z.literal('ai_editorial_draft_not_published'),rows:z.array(z.object({entryId:z.string().uuid(),senseId:z.string().uuid(),meaningSha:hash,beforeTranslationSha:hash,translationUz:z.string().trim().min(1).max(6000),definitionUz:z.string().trim().min(1).max(6000),reason:z.string().trim().min(12)}).strict()).min(1)}).strict();
export type TranslationRevision=z.infer<typeof translationRevisionSchema>;
export const translationContentHash=(sense:Entry['senses'][number])=>sha(stableJson({definitionUz:sense.definition_uz,translations:sense.translations}));
/** Candidate-only transformation. English meanings, IDs, examples, relations and
 * untouched translations stay intact; a stale source must be reviewed again. */
export function reviseDictionaryTranslations(entries:Entry[],input:TranslationRevision){
 const draft=translationRevisionSchema.parse(input),result=new Map(entries.map(e=>[e.lexeme_id,e])),seen=new Set<string>();
 if(result.size!==entries.length)throw Error('duplicate_dictionary_entry');
 for(const row of draft.rows){
  if(seen.has(row.senseId))throw Error('duplicate_translation_revision');seen.add(row.senseId);
  const current=result.get(row.entryId),sense=current?.senses.find(s=>s.sense_id===row.senseId);
  if(!current||!sense||senseMeaningHash(current,sense)!==row.meaningSha||translationContentHash(sense)!==row.beforeTranslationSha)throw Error('translation_revision_source_changed');
  const next=structuredClone(current),target=next.senses.find(s=>s.sense_id===row.senseId)!;
  target.definition_uz=row.definitionUz;target.translations[0]!.text=row.translationUz;
  target.editorial={status:target.editorial?.status??'owner_supplied',translation_status:'ai_draft',reference_urls:target.editorial?.reference_urls??[],provenance:(target.editorial?.provenance??'canonical_dictionary')+';explicit_uz_translation_revision'};
  entrySchema.parse(next);result.set(next.lexeme_id,next);
 }
 return [...result.values()];
}
