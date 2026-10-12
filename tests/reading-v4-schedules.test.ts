import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {saveContentDraft,publishContentVersion} from '../src/lib/content/authoring';
import {listGeneralSets} from '../src/lib/data/general-reading';
import {startAcademicSet} from '../src/lib/data/reading-assessments';
import {getAttemptDetail} from '../src/lib/data/reading';

test('Reading schedule activates through real catalogue/start, binds newest due revision, retires obsolete schedules and preserves V1',async()=>{
 const env=await createTestDatabase();
 try{
  const [u]=await env.query<{id:string}>("insert into users(name,role) values ('QA owner','owner') returning id");
  const actor={id:u!.id,role:'owner',mayPublish:true};
  const draft=async(n:number)=>{
   const r=await env.db.transaction(tx=>saveContentDraft(tx,{actor,module:'reading',contentType:'general_set',sourceRef:'qa-scheduled-reading',title:`Revision ${n}`,track:'academic',payload:{passages:[1,2,3].map(p=>({title:`Passage ${p}`,bodyText:`Revision ${n}. `+'A genuine QA-only authored passage. '.repeat(4),questions:Array.from({length:p===3?14:13},(_,i)=>({typeCode:'short_answer',questionText:`Question ${i}`,correctAnswer:`key${n}`}))}))}}));
   assert.ok(r.ok);if(!r.ok)throw Error('draft');return r.version;
  };
  const v1=await draft(1);
  assert.ok((await env.db.transaction(tx=>publishContentVersion(tx,{actor,versionId:v1.id,to:'published'}))).ok);
  const old=await startAcademicSet(u!.id,v1.targetId!,env.db);assert.ok(old);
  const before=(await getAttemptDetail(old!,u!.id,env.db))!;
  const v2=await draft(2),v3=await draft(3),v4=await draft(4);
  for(const v of [v2,v3,v4]) assert.ok((await env.db.transaction(tx=>publishContentVersion(tx,{actor,versionId:v.id,to:'scheduled',publishAt:new Date(Date.now()+3600000)}))).ok);
  assert.deepEqual((await listGeneralSets(u!.id,{academic:true},env.db)).map(s=>s.id),[v1.targetId]);
  // Advance only these fixture schedules, without changing clock/global state.
  await env.query("update general_reading_sets set publish_at=now()-interval '1 minute' where id=any($1::uuid[])",[[v2.targetId,v3.targetId]]);
  await env.query("update reading_passages set publish_at=now()-interval '1 minute' where id in (select passage_id from general_reading_passages where set_id=any($1::uuid[]))",[[v2.targetId,v3.targetId]]);
  assert.deepEqual((await listGeneralSets(u!.id,{academic:true},env.db)).map(s=>s.id),[v3.targetId]);
  assert.equal(await startAcademicSet(u!.id,v2.targetId!,env.db),null,'older due version never takes over again');
  const fresh=await startAcademicSet(u!.id,v3.targetId!,env.db);assert.ok(fresh);
  assert.equal((await getAttemptDetail(fresh!,u!.id,env.db))!.attempt.contentVersionId,v3.id);
  const after=(await getAttemptDetail(old!,u!.id,env.db))!;
  assert.deepEqual(after.questions,before.questions);assert.equal(after.attempt.contentVersionId,v1.id);
  const states=await env.query<{id:string;publication_state:string}>("select id,publication_state from content_versions where id=any($1::uuid[])",[[v2.id,v3.id,v4.id]]);
  assert.equal(states.find(v=>v.id===v2.id)!.publication_state,'archived');
  assert.equal(states.find(v=>v.id===v3.id)!.publication_state,'published');
  assert.equal(states.find(v=>v.id===v4.id)!.publication_state,'scheduled');
 }finally{await env.close();}
});
