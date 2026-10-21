import "server-only";
import {sql} from "drizzle-orm";
import type {db} from "@/db/client";
import {normalizeSearch,type Entry} from "./model";
import {dictionaryPresentation} from "./presentation";
import {exampleUsesEntry} from "./example-match";
import {rows} from "./store";
import {LEXICAL_TYPES,lexicalTypeFor} from "@/lib/text/lexical-normalize";

/** Install an already validated exact dictionary sense in the shared lexicon.
 * The caller holds the dictionary advisory lock and pins the active release.
 * This does not add a learner's word, start an attempt or change SRS/results. */
export async function materializeDictionarySense(tx:Pick<typeof db,"execute">,entry:Entry,senseId:string){
 const sense=entry.senses.find(row=>row.sense_id===senseId);
 if(!sense)throw Error("sense_not_found");
 const study=dictionaryPresentation(entry).senses[senseId];
 const example=study?.examples[0]?.text_en??null;
 const collocations=study?.collocations.map(phrase=>phrase.text).join(" · ")||null;
 const [mapped]=await rows<{app_sense_id:string}>(sql`select app_sense_id from dictionary_sense_mappings where sense_id=${senseId}::uuid`,tx);
 if(mapped){
  const [current]=await rows<{example_sentence:string|null;collocations:string|null}>(sql`select example_sentence,collocations from lexemes where id=${mapped.app_sense_id}::uuid`,tx);
  if(!current)throw Error("dictionary_mapping_missing");
  if(!current.example_sentence||!exampleUsesEntry(entry,current.example_sentence))await tx.execute(sql`update lexemes set example_sentence=${example} where id=${mapped.app_sense_id}::uuid`);
  if(!current.collocations?.trim()&&collocations)await tx.execute(sql`update lexemes set collocations=${collocations} where id=${mapped.app_sense_id}::uuid`);
  return mapped.app_sense_id;
 }
 const pos=({n:"noun",v:"verb",a:"adjective",r:"adverb"} as Record<string,string>)[entry.part_of_speech]??entry.part_of_speech;
 // The source also uses labels such as "other" that are not app enum values.
 // Preserve recognized labels; otherwise use only the authored POS and shape.
 const lexicalType=(LEXICAL_TYPES as readonly string[]).includes(entry.lexical_type)?entry.lexical_type:lexicalTypeFor(entry.display_lemma,pos);
 const [unit]=await rows<{id:string}>(sql`insert into lexical_units(id,lemma,lemma_norm,part_of_speech,lexical_type,provenance) values(${entry.lexeme_id}::uuid,${entry.display_lemma},${normalizeSearch(entry.display_lemma)},${pos},${lexicalType},'dictionary_release') on conflict(language,lemma_norm,part_of_speech,lexical_type) do update set lemma=lexical_units.lemma returning id`,tx);
 await tx.execute(sql`insert into lexemes(id,term,part_of_speech,definition_en,translation_uz,example_sentence,collocations,sense_key,provenance,verification_status,lexical_unit_id) values(${senseId}::uuid,${entry.display_lemma},${pos},${sense.definition_en},${sense.translations[0]!.text},${example},${collocations},${"dictionary:"+senseId},'dictionary_release',${sense.editorial&&sense.editorial.translation_status!=="human_reviewed"?"unverified":"verified"},${unit!.id}::uuid)`);
 await tx.execute(sql`insert into dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method) values(${senseId}::uuid,${senseId}::uuid,${unit!.id}::uuid,'new_canonical')`);
 return senseId;
}
