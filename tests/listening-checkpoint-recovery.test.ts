import test from 'node:test';
import assert from 'node:assert/strict';
import {readListeningCheckpoint,archiveListeningOutbox,archivedListeningOutboxes} from '../src/lib/client/listening-checkpoint';

test('only an explicit authoritative stale-checkpoint response can recover an outbox',async()=>{
  const values={exam:JSON.stringify({answers:{1:'saved answer'}})};
  assert.deepEqual(await readListeningCheckpoint(Response.json({error:'stale_checkpoint',values},{status:409})),{values,course:undefined,recovered:true});
  assert.equal((await readListeningCheckpoint(Response.json({values}))).recovered,false);
  for(const [status,body] of [[503,{error:'save_failed'}],[401,{error:'unauthenticated'}],[409,{error:'another_conflict',values}],[409,{error:'stale_checkpoint',values:{exam:42}}],[409,{error:'stale_checkpoint',values:[]}]] as const){
    await assert.rejects(()=>readListeningCheckpoint(Response.json(body,{status})),/checkpoint_unavailable/);
  }
});

test('recovery preserves both the rejected draft and any later queued draft; quota failures keep the retry entry',()=>{
  const key='la-authored-listening:student:test',sent=JSON.stringify({exam:'older answer'}),queued=JSON.stringify({exam:'later answer'});
  const data=new Map([[key+':pending',queued]]);
  const storage={get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}} as Storage;
  const first=archiveListeningOutbox(storage,key,sent);
  assert.deepEqual(JSON.parse(first).drafts,[JSON.parse(sent),JSON.parse(queued)]);
  assert.equal(data.has(key+':pending'),false);
  assert.equal([...data.keys()].filter(k=>k.startsWith(key+':conflict:')).length,1);
  data.set(key+':pending',sent);
  archiveListeningOutbox(storage,key,sent);
  assert.equal([...data.keys()].filter(k=>k.startsWith(key+':conflict:')).length,2,'a later conflict never overwrites the first backup');
  assert.equal(JSON.parse(archivedListeningOutboxes(storage,key)!).backups.length,2);
  assert.equal(archivedListeningOutboxes(storage,'another-student:test'),null);
  data.set(key+':pending',queued);
  const raced={...storage,setItem:(k:string,v:string)=>{data.set(k,v);data.set(key+':pending','newer-tab-work');}} as Storage;
  archiveListeningOutbox(raced,key,sent);
  assert.equal(data.get(key+':pending'),'newer-tab-work','another tab arriving during backup keeps its retry entry');
  data.set(key+':pending',queued);
  const full={...storage,setItem:()=>{throw new DOMException('Storage full','QuotaExceededError');}} as Storage;
  assert.throws(()=>archiveListeningOutbox(full,key,sent),{name:'QuotaExceededError'});
  assert.equal(data.get(key+':pending'),queued,'unbacked work must remain queued');
});
