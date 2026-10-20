import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { entrySchema, entryTerms, normalizeSearch, sha, stableJson, type Entry } from "../../src/lib/dictionary/model";
import { bytesHash, shardId, type ShardDescriptor } from "../../src/lib/dictionary/shards";
import { writeShard, publishManifest } from "../../src/lib/dictionary/offload";
import { contentHash, releaseManifest, rows, writeTerms } from "../../src/lib/dictionary/store";
import {senseKeyOf} from "../../src/lib/services/vocabulary/dedupe";
import {dictionaryPos} from "../../src/lib/dictionary/labels";
import type { DictionaryObjects } from "../../src/lib/dictionary/object-store";
export const V2_RELEASE="rel-v1-a834010a6ccc72c8b3cd8db9";
export const SOURCE_COMMIT="64af9c187dee17f2e12eee9b1a4587ab675caa47";
export function verifiedSource(file:string, attributionFile:string) {
  const compressed=readFileSync(file);
  if(bytesHash(compressed)!=="5224b974f8bfc11213e265841087156c262cc0f5db78f489a5cab0997a0113b7")throw Error("source_checksum_mismatch");
  const raw=gunzipSync(compressed,{maxOutputLength:210_000_000});
  if(bytesHash(raw)!=="81fd356d099b85b2b363141237345857c8acc9568810d65a70cd8746a80e6ca5")throw Error("source_checksum_mismatch");
  const source=JSON.parse(raw.toString()) as {release_id:string;entries:Entry[]};
  if(source.release_id!==V2_RELEASE||source.entries.length!==62376)throw Error("source_identity_mismatch");
  const attribution=JSON.parse(readFileSync(attributionFile,"utf8")) as {sources:Record<string,string>[]};
  const ids=new Set<string>(),senses=new Set<string>(),examples=new Set<string>();let synonyms=0,cefr=0;
  for(const e of source.entries){
    entrySchema.parse(e);
    if(e.release_id!==V2_RELEASE||ids.has(e.lexeme_id))throw Error("duplicate_identity");ids.add(e.lexeme_id);
    for(const a of e.attribution)if(!attribution.sources.some(s=>s.clearance_status==='APPROVED_FOR_PUBLIC_REUSE'&&Object.entries(a).every(([k,v])=>s[k]===v)))throw Error("uncleared_source_attribution");
    for(const s of e.senses){if(senses.has(s.sense_id))throw Error("duplicate_identity");senses.add(s.sense_id);if(s.cefr){if(!/^(A1|A2|B1|B2|C1|C2)$/.test(s.cefr))throw Error("invalid_cefr");cefr++;}for(const x of s.examples){if(examples.has(x.example_id))throw Error("duplicate_identity");examples.add(x.example_id);}}
    synonyms+=e.relations.filter(r=>r.relation_type==='synonym').length;
  }
  if(senses.size!==105488||examples.size!==81099||synonyms!==151756||cefr!==101260)throw Error("source_counts_mismatch");
  for(const e of source.entries)for(const r of e.relations)if(!ids.has(r.target_lexeme_id)||(r.target_sense_id&&!senses.has(r.target_sense_id)))throw Error("broken_relation_target");
  return {entries:source.entries,counts:{lexemes:ids.size,senses:senses.size,examples:examples.size,synonyms,cefr},sourceCommit:SOURCE_COMMIT};
}

type ImportDb=Pick<typeof db,"execute"|"transaction">;
/** No channel activation here. Complete per-shard transactions make retry idempotent. */
export type ExpectedImport = {release:string;lexemes:number;senses:number;examples:number;entryInventorySha:string;senseSetSha:string;exampleSetSha:string;searchTerms:number};
export async function importHybridGroups(groups:AsyncIterable<Entry[]>,expected:ExpectedImport,objects:DictionaryObjects,conn:ImportDb,owner:string|null=null,workerIndex?:import('../../src/lib/dictionary/worker-gateway').WorkerIndexManifest,prepared?:(entries:Entry[])=>{body:Buffer;descriptor:ShardDescriptor}) {
  const release=expected.release;
  const [existing]=await rows<{state:string;manifest:unknown;manifest_sha:string}>(sql`select state,manifest,manifest_sha from dictionary_releases where id=${release}`,conn);
  const assertExpected=(manifest:Awaited<ReturnType<typeof releaseManifest>>) => {
    if(manifest.lexemes!==expected.lexemes||manifest.senses!==expected.senses||manifest.examples!==expected.examples||manifest.entry_inventory_sha256!==expected.entryInventorySha||manifest.sense_set_sha256!==expected.senseSetSha||manifest.example_set_sha256!==expected.exampleSetSha||manifest.search_terms!==expected.searchTerms)throw Error("materialized_inventory_mismatch");
  };
  if(existing?.state==='validated'){
    const actual=await releaseManifest(release,conn);assertExpected(actual);
    if(sha(stableJson(actual))!==existing.manifest_sha||stableJson(actual)!==stableJson(existing.manifest))throw Error("validated_release_manifest_mismatch");
    return {release,alreadyValidated:true,manifest:actual};
  }
  if(existing?.state==='failed')throw Error("failed_release_requires_cleanup");
  await conn.execute(sql`insert into dictionary_releases(id,state,created_by,delivery) values(${release},'building',${owner}::uuid,${workerIndex?'r2-worker-v1':'legacy'}) on conflict do nothing`);
  if(workerIndex)await conn.execute(sql`insert into dictionary_search_indexes(release_id,descriptor) values(${release},${JSON.stringify(workerIndex)}::jsonb) on conflict do nothing`);
  const app=await rows<{id:string;term:string;part_of_speech:string|null;definition_en:string;lexical_unit_id:string|null}>(sql`select id,term,part_of_speech,definition_en,lexical_unit_id from lexemes order by id limit 10001`,conn);
  if(app.length>10000)throw Error("existing_lexicon_mapping_review_required");
  const keyOf=(term:string,pos:string|null,meaning:string)=>senseKeyOf({term,partOfSpeech:pos?dictionaryPos(pos):null,meaning});
  const byAppKey=new Map<string,typeof app>();for(const row of app){const key=keyOf(row.term,row.part_of_speech,row.definition_en),list=byAppKey.get(key)??[];list.push(row);byAppKey.set(key,list);}
  const byAppId=new Map(app.map(row=>[row.id,row]));
  const candidates=new Map<string,Set<string>>();
  const direct=new Map<string,string>();
  for await(const group of groups) await conn.transaction(async tx=>{
    if(!group.length||group.some(e=>e.release_id!==release))throw Error("source_identity_mismatch");
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    const [state]=await rows<{state:string}>(sql`select state from dictionary_releases where id=${release} for update`,tx);
    if(state?.state!=='building')throw Error("release_not_building");
    for(const e of group)for(const sense of e.senses){
      const key=keyOf(e.display_lemma,e.part_of_speech,sense.definition_en),sameId=byAppId.get(sense.sense_id);
      if(sameId){const sameUntypedIdentity=sameId.part_of_speech===null&&normalizeSearch(sameId.term)===normalizeSearch(e.display_lemma)&&normalizeSearch(sameId.definition_en)===normalizeSearch(sense.definition_en);if(keyOf(sameId.term,sameId.part_of_speech,sameId.definition_en)!==key&&!sameUntypedIdentity)throw Error("canonical_identity_conflict");direct.set(sameId.id,sense.sense_id);}
      if(byAppKey.has(key)){const set=candidates.get(key)??new Set<string>();set.add(sense.sense_id);candidates.set(key,set);}
    }
    await writeShard(group,objects,tx,!workerIndex,prepared?.(group));if(!workerIndex)await writeTerms(group,tx);
  });
  const manifest=await releaseManifest(release,conn);assertExpected(manifest);
  await publishManifest(release,manifest,objects);
  await conn.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    let mapped=0,ambiguous=0;
    for(const row of app){const found=candidates.get(keyOf(row.term,row.part_of_speech,row.definition_en));const canonical=direct.get(row.id);const unique=byAppKey.get(keyOf(row.term,row.part_of_speech,row.definition_en))?.length===1;
      const sense=canonical??(unique&&found?.size===1?[...found][0]:null);
      if(!sense){if(found?.size)ambiguous++;continue;}
      const inserted=await rows(sql`insert into dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method) values(${sense}::uuid,${row.id}::uuid,${row.lexical_unit_id}::uuid,${canonical?'canonical_id':'exact_identity'}) on conflict do nothing returning sense_id`,tx);
      mapped+=inserted.length;
    }
    const current=await releaseManifest(release,tx);
    if(stableJson(current)!==stableJson(manifest))throw Error("import_changed_during_validation");
    await tx.execute(sql`update dictionary_releases set state='validated',manifest=${JSON.stringify(manifest)}::jsonb,manifest_sha=${sha(stableJson(manifest))},validated_at=now() where id=${release} and state='building'`);
    await tx.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,candidate_release_id,validation_result) values(${owner}::uuid,'r2_import_validated',${release},${JSON.stringify({pass:true,manifest_sha:sha(stableJson(manifest)),mappedExistingSenses:mapped,ambiguousExistingSenses:ambiguous})}::jsonb)`);
  });
  return {release,alreadyValidated:false,manifest};
}
export function expectedImport(entries:Entry[]):ExpectedImport {
  const senses=entries.flatMap(e=>e.senses.map(s=>s.sense_id)).sort(),examples=entries.flatMap(e=>e.senses.flatMap(s=>s.examples.map(x=>x.example_id))).sort();
  return {release:entries[0]!.release_id,lexemes:entries.length,senses:senses.length,examples:examples.length,entryInventorySha:sha(entries.toSorted((a,b)=>a.lexeme_id.localeCompare(b.lexeme_id)).map(e=>`${e.lexeme_id}:${contentHash(e)}`).join('\n')),senseSetSha:sha(JSON.stringify(senses)),exampleSetSha:sha(JSON.stringify(examples)),searchTerms:entries.reduce((n,e)=>n+entryTerms(e).length,0)};
}
export function importHybrid(entries:Entry[],objects:DictionaryObjects,conn:ImportDb,owner:string|null=null) {
  if(!entries.length)throw Error("source_identity_mismatch");
  const groups=new Map<string,Entry[]>();for(const e of entries){const id=shardId(e.lexeme_id);const group=groups.get(id)??[];group.push(e);groups.set(id,group);}
  return importHybridGroups((async function*(){for(const [,group] of [...groups].sort(([a],[b])=>a.localeCompare(b)))yield group;})(),expectedImport(entries),objects,conn,owner);
}
