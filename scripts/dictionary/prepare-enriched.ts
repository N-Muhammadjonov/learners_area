import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {entrySchema,sha,stableJson,type Entry} from '../../src/lib/dictionary/model';
import {INDEX_VERSION,compareDictionaryText} from '../../src/lib/dictionary/search-index';
import {encodeShard,bytesHash} from '../../src/lib/dictionary/shards';
import {expectedImport} from './hybrid-import';
const [sourceFile,out]=process.argv.slice(2);if(!sourceFile||!out)throw Error('Usage: prepare-enriched.ts REVIEWED-ENTRIES.json.gz NEW-DIRECTORY');
const sourceBytes=readFileSync(sourceFile),source=JSON.parse(gunzipSync(sourceBytes,{maxOutputLength:250_000_000}).toString()) as {entries:Entry[];summary:unknown;sourceInventorySha:string;sourceRelease:string;corpusSha:string;corrections:{id:string}[];mappings:{app_sense_id:string}[]};
const release='rel-v1-'+sha(stableJson({source:bytesHash(sourceBytes),index:INDEX_VERSION,layout:'bounded-disk-prefix-packed-v2',targetBytes:131072})).slice(0,24),entries=source.entries.map(e=>entrySchema.parse({...e,release_id:release}));
mkdirSync(out);mkdirSync(join(out,'shards'));mkdirSync(join(out,'search'));
const groups=new Map<string,Entry[]>();for(const e of entries){const key=e.lexeme_id.slice(0,2),group=groups.get(key)??[];group.push(e);groups.set(key,group);}
const shards=[];for(const [key,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const encoded=encodeShard(release,group,true);writeFileSync(join(out,'shards',key+'.json.gz'),encoded.body);shards.push(encoded.descriptor);}
const order=entries.toSorted((a,b)=>compareDictionaryText(a.normalized_search_form,b.normalized_search_form)||a.lexeme_id.localeCompare(b.lexeme_id)).map(e=>e.lexeme_id);
writeFileSync(join(out,'sort-order.json.gz'),gzipSync(Buffer.from(JSON.stringify(order)),{level:9}));
const mappedIds=new Set(source.mappings.map(m=>m.app_sense_id)),appliedCorrections=source.corrections.filter(c=>mappedIds.has(c.id));
const correctionBytes=stableJson(appliedCorrections);writeFileSync(join(out,'course-corrections.json'),correctionBytes);
const plan={version:3,courseCorrectionsSha:sha(correctionBytes),release,sourceRelease:source.sourceRelease,sourceInventorySha:source.sourceInventorySha,sourceFileSha:bytesHash(sourceBytes),corpusSha:source.corpusSha,enrichment:{...(source.summary as Record<string,unknown>),correctedContextMeanings:appliedCorrections.length},expected:expectedImport(entries),shards,search:null};
writeFileSync(join(out,'release-plan.json'),stableJson(plan));console.log(JSON.stringify({release,entries:entries.length,senses:plan.expected.senses,prepared:true,indexPending:true}));
