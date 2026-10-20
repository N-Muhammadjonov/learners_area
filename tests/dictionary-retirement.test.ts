import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {db} from '../src/db/client';
import {retireUnusedLegacyIndex} from '../src/lib/dictionary/retire';
import {sha} from '../src/lib/dictionary/model';
test('entry range metadata cannot be partially null',async()=>{
 const d=await createTestDatabase();try{
  const release='rel-v1-444444444444444444444444';await d.query("insert into dictionary_releases(id,state) values($1,'building')",[release]);
  const insert="insert into dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,storage_shard,storage_release,sense_ids,example_ids,storage_offset,storage_length,storage_raw_bytes) values($1,'aa000000-0000-5000-8000-000000000000','range','n','word',null,'fixture','aa',$1,'{}','{}',$2,$3,$4)";
  for(const values of [[0,null,100],[null,10,100],[0,10,null]])await assert.rejects(()=>d.query(insert,[release,...values]),/dictionary_entry_range/);
  await d.query(insert,[release,0,10,100]);
 }finally{await d.close();}
});
test('retirement preserves immutable manifests and protects active, previous and borrowed releases',async()=>{
 const d=await createTestDatabase();try{
  const [owner]=await d.query<{id:string}>("insert into users(name,role,account_status) values('Retirement QA','owner','active') returning id");
  const old='rel-v1-111111111111111111111111',current='rel-v1-222222222222222222222222',hash=sha('old-manifest');
  await d.query("insert into dictionary_releases(id,state,manifest,manifest_sha,validated_at,delivery) values($1,'validated','{}',$3,now(),'legacy'),($2,'validated','{}',$3,now(),'r2-worker-v1')",[old,current,hash]);
  await d.query("insert into dictionary_channels(name,active_release_id,previous_release_id) values('stable',$1,$2)",[current,old]);
  mock.method(db,'execute',d.db.execute.bind(d.db));mock.method(db,'transaction',d.db.transaction.bind(d.db));
  const input={ownerId:owner!.id,release:old,expectedActive:current,expectedManifestSha:hash};
  await assert.rejects(()=>retireUnusedLegacyIndex(input),/protected/);
  await d.query("update dictionary_channels set previous_release_id=null where name='stable'");
  await assert.rejects(()=>d.query("update dictionary_releases set manifest='{}',manifest_sha='tampered' where id=$1",[old]),/immutable/);
  await assert.rejects(()=>retireUnusedLegacyIndex({...input,expectedManifestSha:'wrong'}),/manifest/);
  await assert.rejects(()=>retireUnusedLegacyIndex({...input,release:current}),/protected/);
  await retireUnusedLegacyIndex(input);
  assert.equal((await retireUnusedLegacyIndex(input)).alreadyRetired,true,'an interrupted operator response can be retried without changing the immutable registry');
  const [after]=await d.query<{state:string;manifest_sha:string}>('select state,manifest_sha from dictionary_releases where id=$1',[old]);assert.equal(after!.state,'retired');assert.equal(after!.manifest_sha,hash);
  await assert.rejects(()=>d.query("update dictionary_releases set state='building' where id=$1",[old]),/immutable/);
  await assert.rejects(()=>d.query('delete from dictionary_releases where id=$1',[old]),/immutable/);
  assert.equal((await d.query<{active_release_id:string}>("select active_release_id from dictionary_channels where name='stable'"))[0]!.active_release_id,current);
 }finally{mock.restoreAll();await d.close();}
});
