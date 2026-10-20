import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDraft} from '../src/lib/dictionary/model';
import {buildSearchIndex,indexKey} from '../src/lib/dictionary/search-index';
import {encodeShard,shardKey} from '../src/lib/dictionary/shards';
import {dictionaryProof} from '../src/lib/dictionary/worker-protocol';
import {serveDictionary,type DictionaryEnvironment} from '../workers/learnersarea-dictionary/handler';
const secret='isolated-worker-fixture-key-at-least-32-bytes';
const release='rel-v1-777777777777777777777777';
test('Worker verifies gateway proof before storage, serves indexed previews and full canonical entries with bounded cached reads',async()=>{
 const entry=applyDraft([],{operation:'add_lexeme',lemma:'find out',partOfSpeech:'v',lexicalType:'phrasal_verb',definitionEn:'Discover information',translationUz:'bilib olmoq',definitionUz:'Yangi ma’lumotni bilib olmoq',examples:[]},release),built=buildSearchIndex([entry],release),encoded=encodeShard(release,[entry]);
 const objects=new Map([...built.objects].map(([name,body])=>[indexKey(release,name),body]));objects.set(shardKey(release,encoded.descriptor.shard),encoded.body);let gets=0;
 const env:DictionaryEnvironment={DICTIONARY_SIGNING_SECRET:secret,DICTIONARY_BUCKET:{async get(key){gets++;const body=objects.get(key);return body?{size:body.length,body:new Response(Uint8Array.from(body)).body!}:null;}}};
 const body={action:'search',release,directory:built.descriptor,query:'find',direction:'EN'};
 async function send(value:unknown,at=Math.floor(Date.now()/1000)){const raw=JSON.stringify(value);return serveDictionary(new Request('https://worker.invalid/v1/dictionary',{method:'POST',headers:{'X-LA-Dictionary-Proof':await dictionaryProof(secret,raw,at)},body:raw}),env);}
 const unsigned=await serveDictionary(new Request('https://worker.invalid/v1/dictionary',{method:'POST',body:JSON.stringify(body)}),env);assert.equal(unsigned.status,403);assert.equal(gets,0);
 assert.equal((await send(body,Math.floor(Date.now()/1000)-30)).status,403);assert.equal(gets,0);
 const replies=await Promise.all(Array.from({length:12},()=>send(body)));for(const r of replies){assert.equal(r.status,200);const b=await r.json();assert.equal(b.results[0].display_lemma,'find out');assert.equal(b.results[0].translation_uz,'bilib olmoq');assert.ok(r.headers.get('server-timing'));}
 assert.equal(gets,2,'directory and one index partition coalesce across concurrent requests');
 const detail=await send({action:'entry',release,lexemeId:entry.lexeme_id,shard:encoded.descriptor});assert.equal(detail.status,200);assert.deepEqual((await detail.json()).entry,entry);assert.equal(gets,3);
 await send(body);assert.equal(gets,3,'hot parsed indexes require no additional R2 reads');
 assert.equal((await send({...body,query:'x'.repeat(81)})).status,400);
 assert.equal((await send({...body,extra:'arbitrary-object-path'})).status,400);
 assert.equal((await send({...body,release:'rel-v1-888888888888888888888888'})).status,503);
});
test('corrupt objects fail closed and never populate shared edge cache',async()=>{
 const entry=applyDraft([],{operation:'add_lexeme',lemma:'run',partOfSpeech:'v',lexicalType:'word',definitionEn:'Move quickly',translationUz:'yugurmoq',definitionUz:'Tez harakat qilmoq',examples:[]},release),built=buildSearchIndex([entry],release);let gets=0,puts=0;
 const env:DictionaryEnvironment={DICTIONARY_SIGNING_SECRET:secret,DICTIONARY_BUCKET:{async get(){gets++;return {size:built.descriptor.compressed_bytes,body:new Response('corrupt').body!};}}};
 const raw=JSON.stringify({action:'search',release,directory:built.descriptor,query:'run',direction:'EN'});
 for(let i=0;i<2;i++){const r=await serveDictionary(new Request('https://worker.invalid/v1/dictionary',{method:'POST',headers:{'X-LA-Dictionary-Proof':await dictionaryProof(secret,raw,Math.floor(Date.now()/1000))},body:raw}),env,{async match(){return undefined;},async put(){puts++;}});assert.equal(r.status,503);}
 assert.equal(gets,2);assert.equal(puts,0);
});
test('packed entries use a single exact bounded R2 range and validate the canonical content hash',async()=>{
 const entries=Array.from({length:40},(_,i)=>applyDraft([],{operation:'add_lexeme',lemma:'range '+i,partOfSpeech:'n',lexicalType:'phrase',definitionEn:'A distinct range fixture '+i,translationUz:'Oraliq '+i,definitionUz:'Sinov ma’nosi '+i,examples:[]},release));
 // Force one UUID-prefix object while retaining distinct stable identities.
 for(let i=0;i<entries.length;i++)entries[i]!.lexeme_id='aa'+entries[i]!.lexeme_id.slice(2);
 const packed=encodeShard(release,entries,true),entry=entries[13]!,range=packed.ranges.get(entry.lexeme_id)!;let gets=0,bytes=0;
 const env:DictionaryEnvironment={DICTIONARY_SIGNING_SECRET:secret,DICTIONARY_BUCKET:{async get(key,options){gets++;assert.equal(key,shardKey(release,'aa'));assert.deepEqual(options?.range,{offset:range.offset,length:range.length});const body=packed.body.subarray(range.offset,range.offset+range.length);bytes+=body.length;return {size:packed.body.length,range:options!.range,body:new Response(Uint8Array.from(body)).body!};}}};
 const {entryContentHash}=await import('../src/lib/dictionary/model');
 async function send(hash:string){const raw=JSON.stringify({action:'entry',release,lexemeId:entry.lexeme_id,shard:packed.descriptor,range,contentSha:hash});return serveDictionary(new Request('https://worker.invalid/v1/dictionary',{method:'POST',headers:{'X-LA-Dictionary-Proof':await dictionaryProof(secret,raw,Math.floor(Date.now()/1000))},body:raw}),env);}
 const result=await send(entryContentHash(entry));assert.equal(result.status,200);assert.deepEqual((await result.json()).entry,entry);assert.equal(gets,1);assert.ok(bytes<packed.body.length/10);assert.equal((await send(entryContentHash(entry))).status,200);assert.equal(gets,1);assert.equal((await send('0'.repeat(64))).status,503);
});
