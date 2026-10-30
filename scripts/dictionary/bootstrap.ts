import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/tooling-client";
import { BASE_RELEASE, entrySchema, normalizeSearch, sha, stableJson, type Entry } from "../../src/lib/dictionary/model";
import { releaseManifest, rows, writeEntries, writeTerms } from "../../src/lib/dictionary/store";
import { senseKeyOf } from "../../src/lib/services/vocabulary/dedupe";
const file=process.argv[2];if(!file)throw Error("Usage: bootstrap.ts <verified nested.json.gz> [receipt.json]");
const url=new URL(process.env.DATABASE_URL??"");if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/learners_qa2')throw Error("Only isolated learners_qa2 allowed; shared bootstrap requires a separately approved runner");
const compressed=readFileSync(file);
import { createHash } from "node:crypto";
const checksum=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
if(checksum(compressed)!=='ae4130d6b7d9ad1d5a65cb4f56944735e497e9754fd53c6a387097c7aaff650c')throw Error('source_checksum_mismatch');
const raw=gunzipSync(compressed);if(checksum(raw)!=='dcea1e0304131413069986b6f096e71ab92070ce6a1c27b77410e82294fd602c')throw Error('source_checksum_mismatch');
const source=JSON.parse(raw.toString()) as {entries:Entry[];release_id:string;published_entries:number;published_senses:number;published_examples:number};
if(source.release_id!==BASE_RELEASE||source.entries.length!==62376||source.published_senses!==105488||source.published_examples!==81099)throw Error('source_counts_mismatch');
for(const entry of source.entries)entrySchema.parse(entry);
const [present]=await rows(sql`select id,state from dictionary_releases where id=${BASE_RELEASE}`);if(present?.state==='validated'){const actual=await releaseManifest(BASE_RELEASE); const [stored]=await rows<{manifest:unknown;manifest_sha:string}>(sql`select manifest,manifest_sha from dictionary_releases where id=${BASE_RELEASE}`);if(sha(stableJson(actual))!==stored?.manifest_sha||stableJson(actual)!==stableJson(stored.manifest))throw Error('validated_base_manifest_mismatch');console.log(JSON.stringify({pass:true,baseAlreadyValidated:true,manifest:actual}));process.exit(0);}
await db.execute(sql`insert into dictionary_releases(id,state) values(${BASE_RELEASE},'building') on conflict do nothing`);
const started=Date.now();for(let at=0;at<source.entries.length;at+=200){const chunk=source.entries.slice(at,at+200);await db.transaction(async tx=>{await writeEntries(chunk,tx);await writeTerms(chunk,tx);});if(at%5000===0)console.log('indexed',at);}
const manifest=await releaseManifest(BASE_RELEASE);if(manifest.lexemes!==62376||manifest.senses!==105488||manifest.examples!==81099)throw Error('materialized_counts_mismatch');
const appRows=await rows<{id:string;term:string;part_of_speech:string|null;definition_en:string;lexical_unit_id:string|null}>(sql`select id,term,part_of_speech,definition_en,lexical_unit_id from lexemes`);
const byIdentity=new Map<string,{entry:Entry;senseId:string}[]>();for(const entry of source.entries)for(const sense of entry.senses){const pos={n:'noun',v:'verb',a:'adjective',r:'adverb'}[entry.part_of_speech]??entry.part_of_speech;const key=senseKeyOf({term:entry.display_lemma,partOfSpeech:pos,meaning:sense.definition_en});const arr=byIdentity.get(key)??[];arr.push({entry,senseId:sense.sense_id});byIdentity.set(key,arr);}
const appByIdentity=new Map<string,typeof appRows>();for(const row of appRows){const key=senseKeyOf({term:row.term,partOfSpeech:row.part_of_speech,meaning:row.definition_en});const matches=appByIdentity.get(key)??[];matches.push(row);appByIdentity.set(key,matches);}
const ambiguities:unknown[]=[];let mapped=0,unmapped=0;
for(const row of appRows){const candidates=byIdentity.get(senseKeyOf({term:row.term,partOfSpeech:row.part_of_speech,meaning:row.definition_en}))??[];
 if(candidates.length!==1){if(candidates.length)ambiguities.push({appSenseId:row.id,candidateSenseIds:candidates.map(c=>c.senseId)});else unmapped++;continue;}
 const target=candidates[0]!;const duplicates=appByIdentity.get(senseKeyOf({term:row.term,partOfSpeech:row.part_of_speech,meaning:row.definition_en}))??[];if(duplicates.length!==1){ambiguities.push({appSenseId:row.id,duplicateAppIds:duplicates.map(x=>x.id)});continue;}
 await db.execute(sql`insert into dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method) values(${target.senseId}::uuid,${row.id}::uuid,${row.lexical_unit_id}::uuid,'exact_identity') on conflict do nothing`);mapped++;
}
await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);await tx.execute(sql`update dictionary_releases set state='validated',manifest=${JSON.stringify(manifest)}::jsonb,manifest_sha=${sha(stableJson(manifest))},validated_at=now() where id=${BASE_RELEASE} and state='building'`);await tx.execute(sql`insert into dictionary_channels(name,active_release_id) values('stable',${BASE_RELEASE}) on conflict do nothing`);});
const receipt={pass:true,sourceCommit:'594c00904e07702c27329f1c0ce9ec6dadee1adb',manifest,mapped,unmapped,ambiguities,elapsedMs:Date.now()-started};writeFileSync(process.argv[3]??'../evidence/dictionary-bootstrap-local.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({...receipt,ambiguities:ambiguities.length}));
