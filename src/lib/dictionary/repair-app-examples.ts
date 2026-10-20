import 'server-only';
import {sql,eq} from 'drizzle-orm';
import {db} from '@/db/client';
import {lexemes} from '@/db/schema';
import {activeRelease,entriesByIds,rows} from './store';
import {dictionaryPresentation} from './presentation';
import {exampleUsesEntry} from './example-match';
/** Exact dictionary mappings only; this operation never changes meanings,
 * user vocabulary rows, SRS, scores, attempts, or source snapshots. */
export async function repairMappedExamples(executor:typeof db=db){
 const active=await activeRelease(executor);
 const mapped=await rows<{app_sense_id:string;sense_id:string;lexeme_id:string;example_sentence:string}>(sql`select m.app_sense_id,m.sense_id,e.lexeme_id,l.example_sentence from dictionary_sense_mappings m join lexemes l on l.id=m.app_sense_id join dictionary_entries e on e.release_id=${active.active_release_id} and m.sense_id=any(e.sense_ids) where l.example_sentence is not null`,executor);
 let inspected=0,changed=0;
 const ids=[...new Set(mapped.map(m=>m.lexeme_id))];
 for(let at=0;at<ids.length;at+=20){const entries=await entriesByIds(ids.slice(at,at+20),active.active_release_id,executor);await executor.transaction(async tx=>{for(const m of mapped.filter(m=>entries.has(m.lexeme_id))){const entry=entries.get(m.lexeme_id)!;inspected++;if(exampleUsesEntry(entry,m.example_sentence))continue;const replacement=dictionaryPresentation(entry).senses[m.sense_id]?.examples[0]?.text_en??null;const result=await tx.update(lexemes).set({exampleSentence:replacement}).where(sql`${eq(lexemes.id,m.app_sense_id)} and ${lexemes.exampleSentence}=${m.example_sentence}`).returning({id:lexemes.id});changed+=result.length;}});}
 return {release:active.active_release_id,inspected,changed,learningHistoryUnchanged:true};
}
