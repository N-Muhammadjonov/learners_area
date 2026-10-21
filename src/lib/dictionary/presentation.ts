import 'server-only';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import manifest from '../../../content/dictionary/presentation/manifest.json';
import {bytesHash} from './shards';
import {senseMeaningHash,type Entry} from './model';
import {exampleUsesEntry} from './example-match';
import type {EntryPresentation,StoredPresentation} from './presentation-types';
const cache=new Map<string,Record<string,StoredPresentation>>();
/** Presentation metadata is tied to exact source content, never a spelling-only
 * meaning guess. Canonical release bytes/IDs and editorial provenance stay intact. */
export function dictionaryPresentation(entry:Entry):EntryPresentation{
 const prefix=entry.lexeme_id.slice(0,2),descriptor=(manifest.shards as Record<string,{sha256:string;bytes:number}>)[prefix];
 let shard=cache.get(prefix);
 if(!shard&&descriptor){const body=readFileSync(join(process.cwd(),'content/dictionary/presentation',prefix+'.json.gz'));if(body.length!==descriptor.bytes||bytesHash(body)!==descriptor.sha256)throw Error('dictionary_presentation_checksum');shard=JSON.parse(gunzipSync(body,{maxOutputLength:4*1024*1024}).toString()) as Record<string,StoredPresentation>;cache.set(prefix,shard);while(cache.size>16)cache.delete(cache.keys().next().value!);}
 const stored=shard?.[entry.lexeme_id];
 return {senses:Object.fromEntries(entry.senses.map(sense=>{const candidate=stored?.senses[sense.sense_id],row=candidate?.meaningSha===senseMeaningHash(entry,sense)?candidate:undefined;return [sense.sense_id,{synonyms:row?.synonyms??(entry.senses.length===1?entry.relations.filter(r=>r.relation_type==='synonym').map(r=>({text:r.display_lemma,lexemeId:r.target_lexeme_id,senseId:r.target_sense_id??undefined})):[]),collocations:row?.collocations??entry.collocations.filter(c=>c.sense_id===sense.sense_id||(!c.sense_id&&entry.senses.length===1)).map(c=>({text:c.text})),examples:row?[...(row.addedExamples??[]),...sense.examples.filter(ex=>exampleUsesEntry(entry,ex.text_en))]:sense.examples.filter(ex=>exampleUsesEntry(entry,ex.text_en))}];}))};
}
