/** Full frozen-source acceptance against an explicitly isolated native PostgreSQL.
 * R2 transport is a local HTTP fixture. It is never production evidence. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {sql} from 'drizzle-orm';
import {db} from '../../src/db/client';
import {verifiedSource,importHybrid,expectedImport,SOURCE_COMMIT} from './hybrid-import';
import {bytesHash,encodeShard,shardId} from '../../src/lib/dictionary/shards';
import type {DictionaryObjects} from '../../src/lib/dictionary/object-store';
import {activateHybridRelease} from '../../src/lib/dictionary/activation';
import {entryById,searchDictionary,rows} from '../../src/lib/dictionary/store';
import {saveDictionarySense} from '../../src/lib/dictionary/save';
import {sha,stableJson} from '../../src/lib/dictionary/model';
const [sourceFile,attributionFile,outputDirectory]=process.argv.slice(2);
async function main(){
 const url=new URL(process.env.DATABASE_URL??'');
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/learners_qa2'||url.port!=='55439'||!sourceFile||!attributionFile||!outputDirectory)throw Error('isolated_native_dictionary_qa_only');
 const root=resolve(outputDirectory);await mkdir(root);const started=performance.now(),source=verifiedSource(sourceFile,attributionFile),release=source.entries[0]!.release_id;
 const path=(key:string)=>{if(!/^dictionary\/releases\/rel-v1-[a-f0-9]{24}\/(manifest\.json|shards\/[a-f0-9]{2}\.json\.gz)$/.test(key))throw Error('unsafe_qa_key');return join(root,key);};
 const objects:DictionaryObjects={read:async(key,max)=>{const p=path(key);if((await stat(p)).size>max)throw Error('limit');return readFile(p);},putImmutable:async(key,body)=>{const p=path(key);await mkdir(p.slice(0,p.lastIndexOf('/')),{recursive:true});try{await writeFile(p,body,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;assert.equal(bytesHash(await readFile(p)),bytesHash(body));}},delete:async()=>{throw Error('qa_cleanup_not_requested');}};
 const grouped=new Map<string,typeof source.entries>();for(const e of source.entries){const id=shardId(e.lexeme_id),group=grouped.get(id)??[];group.push(e);grouped.set(id,group);}
 const descriptors=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([,entries])=>encodeShard(release,entries).descriptor);
 const plan={version:1,sourceCommit:SOURCE_COMMIT,sourceGzipSha256:"5224b974f8bfc11213e265841087156c262cc0f5db78f489a5cab0997a0113b7",expected:expectedImport(source.entries),counts:source.counts,shards:descriptors};
 const planSha=sha(stableJson(plan));
 const owner=(await rows<{id:string}>(sql`insert into users(name,role,account_status) values('Dictionary isolated QA owner','owner','active') returning id`))[0]!.id;
 const student=(await rows<{id:string}>(sql`insert into users(name,role,account_status) values('Dictionary isolated QA learner','student','active') returning id`))[0]!.id;
 const vocabularyBefore=await rows(sql`select * from user_vocabulary order by id`);
 const protectedVocabularySha=sha(stableJson(JSON.parse(JSON.stringify(vocabularyBefore))));
 const imported=await importHybrid(source.entries,objects,db,owner);assert.equal(imported.manifest.lexemes,62376);assert.equal(imported.manifest.senses,105488);assert.equal(imported.manifest.examples,81099);
 assert.equal((await rows(sql`select * from dictionary_channels`)).length,0);
 const repeat=await importHybrid(source.entries,objects,db,owner);assert.equal(repeat.alreadyValidated,true);
 await activateHybridRelease({ownerId:owner,release,manifestSha:sha(stableJson(imported.manifest)),expectedBase:null},objects);
 assert.equal(sha(stableJson(JSON.parse(JSON.stringify(await rows(sql`select * from user_vocabulary order by id`))))),protectedVocabularySha,'existing personal vocabulary and SRS must remain identical');
 const server=createServer(async(req,res)=>{try{const key=decodeURIComponent((req.url??'').split('?')[0]!).replace(/^\/qa\//,'');const body=await objects.read(key,2*1024*1024);res.writeHead(200,{'Content-Length':body.length});res.end(body);}catch{res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
 Object.assign(process.env,{STORAGE_PROVIDER:'r2',R2_ENDPOINT:`http://127.0.0.1:${(server.address() as {port:number}).port}`,R2_BUCKET_NAME:'qa',R2_ACCESS_KEY_ID:'qa',R2_SECRET_ACCESS_KEY:'qa'});
 try{
 const searchMeasurements=[];
 for(const [query,direction] of [['bank','EN'],['ban','EN'],['ran','EN'],['find out','EN'],['shishmoq','UZ'],['shish','UZ']] as const){const times=[];let results:Awaited<ReturnType<typeof searchDictionary>>=[];for(let i=0;i<10;i++){const at=performance.now();results=await searchDictionary(query,direction,release);times.push(performance.now()-at);}assert.ok(results.length,query);times.sort((a,b)=>a-b);searchMeasurements.push({query,direction,p50:times[4],p95:times[9],results:results.length});}
 const found=await searchDictionary('shishmoq','UZ',release);const swell=found.find(r=>r.display_lemma==='swell')!;assert.ok(swell);
 const at=performance.now(),entry=await entryById(swell.lexeme_id,release);const coldEntryMs=performance.now()-at;assert.ok(entry);
 const warmAt=performance.now();await Promise.all(Array.from({length:20},()=>entryById(swell.lexeme_id,release)));const warmConcurrent20Ms=performance.now()-warmAt;
 const sense=entry.senses.find(s=>s.translations.some(t=>t.text==='shishmoq'))!;assert.ok(sense);
 assert.equal((await saveDictionarySense(student,entry.lexeme_id,sense.sense_id,release,null)).ok,true);const before=await rows(sql`select * from user_vocabulary where user_id=${student}::uuid`);
 await saveDictionarySense(student,entry.lexeme_id,sense.sense_id,release,null);assert.deepEqual(await rows(sql`select * from user_vocabulary where user_id=${student}::uuid`),before);
 const sizes=await rows(sql`select c.relname,pg_total_relation_size(c.oid)::text bytes,pg_indexes_size(c.oid)::text indexes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'dictionary%' order by c.relname`);
 const plans=await rows(sql`explain (analyze,buffers,format json) select lexeme_id from dictionary_search_terms where release_id=${release} and direction='EN' and term like 'ban%' limit 20`);
 const receipt={planSha,dictionaryBytes:sizes.reduce((n,x)=>n+Number(x.bytes),0),existingVocabularyPreserved:vocabularyBefore.length,fullImportVerified:true,nativePostgresVerified:true,transport:'isolated local S3 HTTP fixture; NOT Cloudflare live',source:source.counts,sourceCommit:source.sourceCommit,manifest:imported.manifest,searchMeasurements,coldEntryMs,warmConcurrent20Ms,sizes,plans,elapsedMs:performance.now()-started,memory:process.memoryUsage(),dictionaryPayloadsInPostgres:(await rows(sql`select count(*)::int n from dictionary_entries where payload is not null`))[0]};
 await writeFile(join(root,'acceptance.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({...receipt,manifest:{...imported.manifest,storage:{shards:imported.manifest.storage?.shards.length}}}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;}).finally(()=>db.$client.end());
