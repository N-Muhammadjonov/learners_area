import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {applyDraft,stableJson,type Entry} from '../src/lib/dictionary/model';
import {encodeShard,decodeShard,preparedShard,decodeEntryRange,shardKey,bytesHash} from '../src/lib/dictionary/shards';
import {entryContentHash} from '../src/lib/dictionary/model';
import {DictionaryShardCache} from '../src/lib/dictionary/shard-cache';
export const fixture=(n:string,release='rel-v1-111111111111111111111111'):Entry=>applyDraft([],{operation:'add_lexeme',lemma:n,partOfSpeech:'n',lexicalType:'word',definitionEn:'A test-only meaning for '+n,translationUz:'sinov '+n,definitionUz:'Sinov ma’nosi',examples:[]},release);
test('prepared packed shards retain foreign gzip bytes and derive exact ranges without recompression',()=>{
 const entries=[fixture('one'),fixture('two')].map((e,i)=>({...e,lexeme_id:`aa000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 const raw=Buffer.from(entries.map(e=>stableJson(e)+'\n').join(''));
 const body=Buffer.concat(entries.map(e=>{const b=gzipSync(stableJson(e)+'\n',{level:1});b[9]=19;return b;}));
 const descriptor={shard:'aa',sha256:bytesHash(body),raw_sha256:bytesHash(raw),compressed_bytes:body.length,raw_bytes:raw.length,entries:2,format:'entry-jsonl-gzip-v1' as const};
 const prepared=preparedShard(entries[0]!.release_id,entries,descriptor,body);
 assert.equal(prepared.body,body);assert.notDeepEqual(body,encodeShard(entries[0]!.release_id,entries,true).body);
 for(const entry of entries){const range=prepared.ranges.get(entry.lexeme_id)!;assert.deepEqual(decodeEntryRange(entry.release_id,entry.lexeme_id,range,body.subarray(range.offset,range.offset+range.length),entryContentHash(entry)),entry);}
 assert.throws(()=>preparedShard(entries[0]!.release_id,[{...entries[0]!,display_lemma:'changed'},entries[1]!],descriptor,body),/entries_mismatch/);
});
test('deterministic compressed shards reject corruption, wrong IDs and foreign release',()=>{
 const e=fixture('bank'),encoded=encodeShard(e.release_id,[e]),{body,descriptor}=encoded;
 assert.deepEqual(encodeShard(e.release_id,[e]),encoded);assert.deepEqual(decodeShard(e.release_id,descriptor,body).get(e.lexeme_id),e);
 assert.throws(()=>decodeShard(e.release_id,descriptor,Buffer.from('broken')),/checksum/);
 assert.throws(()=>decodeShard('rel-v1-222222222222222222222222',descriptor,body),/identity/);
 assert.throws(()=>encodeShard(e.release_id,[e,e]),/identity/);
 assert.throws(()=>shardKey('../escape','aa'),/key/);
 assert.throws(()=>shardKey(e.release_id,'../aa'),/key/);
 const corrupt=Buffer.from(body);corrupt[8]=corrupt[8]!^1;assert.notEqual(bytesHash(corrupt),descriptor.sha256);
});
test('cache coalesces concurrent misses, expires, evicts within budget and does not cache errors',async()=>{
 const e=fixture('bank'),encoded=encodeShard(e.release_id,[e]);let calls=0,now=1,fail=false;
 const cache=new DictionaryShardCache({read:async()=>{calls++;if(fail)throw Error('unavailable');await Promise.resolve();return encoded.body;}},encoded.descriptor.raw_bytes*4,10,()=>now);
 const values=await Promise.all(Array.from({length:10},()=>cache.get(e.release_id,encoded.descriptor)));assert.equal(calls,1);assert.ok(values.every(v=>v.get(e.lexeme_id)?.lexeme_id===e.lexeme_id));
 now=12;await cache.get(e.release_id,encoded.descriptor);assert.equal(calls,2);assert.ok(cache.stats().bytes<=cache.stats().maxBytes);
 now=24;fail=true;await assert.rejects(()=>cache.get(e.release_id,encoded.descriptor),/unavailable/);assert.equal(cache.stats().inflight,0);
 fail=false;await cache.get(e.release_id,encoded.descriptor);assert.equal(calls,4);
 const tiny=new DictionaryShardCache({read:async()=>encoded.body},1);await tiny.get(e.release_id,encoded.descriptor);assert.equal(tiny.stats().bytes,0);
});
test('cache validates hard retrieval concurrency across distinct keys',async()=>{
 let release!:()=>void;const held=new Promise<void>(r=>{release=r;});const entries=Array.from({length:5},(_,i)=>fixture('word'+i));
 const cache=new DictionaryShardCache({read:async key=>{await held;const e=entries.find(e=>shardKey(e.release_id,e.lexeme_id.slice(0,2))===key)!;return encodeShard(e.release_id,[e]).body;}});
 const work=entries.slice(0,4).map(e=>cache.get(e.release_id,encodeShard(e.release_id,[e]).descriptor));
 await assert.rejects(()=>cache.get(entries[4]!.release_id,encodeShard(entries[4]!.release_id,[entries[4]!]).descriptor),/busy/);release();await Promise.all(work);
});
