import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./support/pglite";
import { gameSet } from "../src/lib/services/vocabulary/engine";
import { mayManageResourceOwner, mayWriteResources } from "../src/lib/services/resources/owners";

test("materials allow teacher and owner while retaining creator isolation", () => {
  assert.equal(mayWriteResources('student'),false);
  for(const role of ['teacher','admin','owner'] as const) assert.equal(mayWriteResources(role),true);
  const owner={id:'content',creatorId:'first-teacher',studentVisible:true,title:'Owned material',label:'speaking_material'};
  assert.equal(mayManageResourceOwner({id:'first-teacher',role:'teacher'},owner),true);
  assert.equal(mayManageResourceOwner({id:'second-teacher',role:'teacher'},owner),false);
  assert.equal(mayManageResourceOwner({id:'centre-owner',role:'owner'},owner),true);
  assert.equal(mayManageResourceOwner({id:'first-teacher',role:'student'},owner),false);
});

test("games sample the owned folder beyond row 500; counts and foreign-folder isolation use the full database", async()=>{
  const database=await createTestDatabase();
  try{
    const [first,second]=await database.query<{id:string}>("insert into users(name,role,account_status) values ('First QA','student','active'),('Second QA','student','active') returning id");
    const [folder]=await database.query<{id:string}>("insert into vocab_folders(user_id,name) values ($1,'Late folder') returning id",[first!.id]);
    const [foreign]=await database.query<{id:string}>("insert into vocab_folders(user_id,name) values ($1,'Other user folder') returning id",[second!.id]);
    await database.query("insert into lexemes(term,sense_key,definition_en) select 'word'||n,'qa:'||n,'meaning'||n from generate_series(1,602) n");
    await database.query(`insert into user_vocabulary(user_id,lexeme_id,sense_key,folder_id,next_review_at)
      select case when term='word602' then $3::uuid else $1::uuid end,id,sense_key,
       case when term='word602' then $4::uuid when substring(term from 5)::int>500 then $2::uuid else null end,
       now()-interval '1 day' from lexemes`,[first!.id,folder!.id,second!.id,foreign!.id]);
    const pool=await gameSet(first!.id,'folder',{folderId:folder!.id,limit:500},database.db);
    assert.equal(pool.total,101);assert.equal(pool.count,101);assert.equal(pool.due,101);
    assert.ok(pool.words.every(word=>word.folderId===folder!.id));
    const sample=await gameSet(first!.id,'all',{limit:10},database.db);
    assert.equal(sample.total,601);assert.equal(sample.count,10);assert.equal(sample.due,601);
    const denied=await gameSet(first!.id,'folder',{folderId:foreign!.id,limit:500},database.db);
    assert.deepEqual({total:denied.total,count:denied.count,due:denied.due},{total:0,count:0,due:0});
    const weak=await gameSet(first!.id,'weak',{limit:10},database.db);
    assert.equal(weak.total,601);assert.equal(weak.count,10);
  }finally{await database.close();}
});
