import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { loadSelfAssessments, recordGameAnswer } from "../src/lib/services/vocabulary/engine";
import { createTestDatabase } from "./support/pglite";
import { vocabularyGameAnswerHttpSchema } from "../src/lib/services/vocabulary/game-input";

test("game HTTP keeps identity, time and verdict server-owned and accepts empty practice answers",()=>{
  const body={entryId:randomUUID(),set:"all",gameId:"race",submission:{kind:"spelling",text:""}};
  assert.deepEqual(vocabularyGameAnswerHttpSchema.parse(body),body);
  for(const input of [{...body,points:1},{...body,correct:true},{...body,userId:randomUUID()},
    {...body,now:new Date().toISOString()},{...body,submission:{kind:"spelling",text:"",correct:true}},
    {...body,submission:{kind:"pair",pairEntryId:"foreign-id"}}]) {
    assert.equal(vocabularyGameAnswerHttpSchema.safeParse(input).success,false);
  }
});

const now = new Date("2026-10-10T06:00:00Z");
async function fixture(t: TestContext) {
  if (global.__learnersAreaPool) t.mock.method(global.__learnersAreaPool, "query", async () => { throw new Error("Global DB forbidden in isolated game test"); });
  const d = await createTestDatabase();
  const [user, other] = await d.query<{id:string}>("insert into users(name,role,account_status,last_meaningful_activity_at) values ('Game learner','student','active','2026-10-01'),('Other learner','student','active','2026-10-01') returning id");
  const [word] = await d.query<{id:string}>("insert into lexemes(term,definition_en,example_sentence,sense_key) values ('resilient','Able to recover','A resilient team recovers quickly.',$1) returning id",[randomUUID()]);
  const [entry,foreign] = await d.query<{id:string}>("insert into user_vocabulary(user_id,lexeme_id,next_review_at) values ($1,$3,$4),($2,$3,$4) returning id",[user!.id,other!.id,word!.id,now]);
  return {d,user:user!.id,other:other!.id,entry:entry!.id,foreign:foreign!.id};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const answer = (f:Fixture) => ({userId:f.user,entryId:f.entry,setKey:"all" as const,gameId:"race",submission:{kind:"spelling" as const,text:"resilient"},now});
async function state(f:Fixture) {
  return {
    word:await f.d.query("select * from user_vocabulary where id=$1",[f.entry]),
    actor:await f.d.query("select last_meaningful_activity_at from users where id=$1",[f.user]),
    events:await f.d.query("select count(*)::int n from activity_events"),
    points:await f.d.query("select count(*)::int n from vocab_point_events"),
  };
}

test("game point failure rolls back practice and activity; retry awards once without moving SRS",async t=>{
  const f=await fixture(t);
  try {
    const before=await state(f);
    await f.d.query("create function reject_game_points() returns trigger language plpgsql as $$ begin raise exception 'game point fixture failure'; end $$");
    await f.d.query("create trigger reject_game_points before insert on vocab_point_events for each row execute function reject_game_points()");
    await assert.rejects(recordGameAnswer(answer(f),f.d.db));
    assert.deepEqual(await state(f),before);
    await f.d.query("drop trigger reject_game_points on vocab_point_events");
    const result=await recordGameAnswer(answer(f),f.d.db);
    assert.ok(result.ok);
    assert.equal(result.awarded,1);
    const retry=await recordGameAnswer(answer(f),f.d.db);
    assert.ok(retry.ok);
    assert.equal(retry.awarded,0);
    assert.deepEqual((await state(f)).word,before.word);
    assert.deepEqual(await f.d.query("select count(*)::int n,sum(points)::int points from vocab_point_events"),[{n:1,points:1}]);
  } finally {await f.d.close();}
});

test("game actor suspension and foreign word are denied before any practice or point write",async t=>{
  const f=await fixture(t);
  try {
    const foreignBefore=await state(f);
    assert.deepEqual(await recordGameAnswer({...answer(f),entryId:f.foreign},f.d.db),{ok:false,error:"not_found"});
    assert.deepEqual(await state(f),foreignBefore);
    await f.d.query("update users set account_status='suspended' where id=$1",[f.user]);
    const before=await state(f);
    assert.deepEqual(await recordGameAnswer(answer(f),f.d.db),{ok:false,error:"unauthenticated"});
    assert.deepEqual(await state(f),before);
  } finally {await f.d.close();}
});

test("game storage refuses forged points, verdicts, identities, kinds and invalid time without writes",async t=>{
  const f=await fixture(t);
  try {
    for(const input of [{...answer(f),points:100},{...answer(f),correct:true},{...answer(f),userId:"not-a-user"},
      {...answer(f),now:new Date("invalid")},{...answer(f),gameId:"unknown"},{...answer(f),submission:{kind:"guess",known:true}},
      {...answer(f),submission:{kind:"spelling",text:"resilient",correct:true}}]) {
      const before=await state(f);
      assert.deepEqual(await recordGameAnswer(input as never,f.d.db),{ok:false,error:"invalid_input"});
      assert.deepEqual(await state(f),before);
    }
  } finally {await f.d.close();}
});

test("game event insertion failure cannot commit points or change SRS",async t=>{
  const f=await fixture(t);
  try {
    const before=await state(f);
    await f.d.query("create function reject_game_event() returns trigger language plpgsql as $$ begin if NEW.type='VOCAB_GAME_PRACTICED' then raise exception 'game event fixture failure'; end if; return NEW; end $$");
    await f.d.query("create trigger reject_game_event before insert on activity_events for each row execute function reject_game_event()");
    await assert.rejects(recordGameAnswer(answer(f),f.d.db));
    assert.deepEqual(await state(f),before);
  } finally {await f.d.close();}
});

test("game set and pair membership stay owner-scoped and create no evidence on denial",async t=>{
  const f=await fixture(t);
  try {
    const before=await state(f);
    for(const input of [{...answer(f),setKey:"reading" as const},{...answer(f),setKey:"listening" as const},
      {...answer(f),setKey:"assigned" as const},{...answer(f),setKey:"topic" as const,topicPack:"unknown"},
      {...answer(f),gameId:"match",submission:{kind:"pair" as const,pairEntryId:f.foreign}}]) {
      assert.deepEqual(await recordGameAnswer(input,f.d.db),{ok:false,error:"not_in_set"});
      assert.deepEqual(await state(f),before);
    }
    const [folder]=await f.d.query<{id:string}>("insert into vocab_folders(user_id,name) values ($1,'Private folder') returning id",[f.user]);
    await f.d.query("update user_vocabulary set folder_id=$1 where id=$2",[folder!.id,f.entry]);
    const valid=await recordGameAnswer({...answer(f),setKey:"folder",folderId:folder!.id},f.d.db);
    assert.ok(valid.ok&&valid.awarded===1);
    const matched=await recordGameAnswer({...answer(f),gameId:"match",submission:{kind:"pair",pairEntryId:f.entry}},f.d.db);
    assert.deepEqual(matched,{ok:true,correct:true,verified:true,awarded:0,srsUntouched:true});
    const [otherWord]=await f.d.query<{id:string}>("insert into lexemes(term,definition_en,sense_key) values ('durable','Lasting a long time',$1) returning id",[randomUUID()]);
    const [otherEntry]=await f.d.query<{id:string}>("insert into user_vocabulary(user_id,lexeme_id) values ($1,$2) returning id",[f.user,otherWord!.id]);
    const mismatched=await recordGameAnswer({...answer(f),gameId:"match",submission:{kind:"pair",pairEntryId:otherEntry!.id}},f.d.db);
    assert.deepEqual(mismatched,{ok:true,correct:false,verified:true,awarded:0,srsUntouched:true});
  } finally {await f.d.close();}
});

test("competing correct games share one word-day award and leave every SRS field unchanged",async t=>{
  const f=await fixture(t);
  try {
    const before=(await state(f)).word;
    const results=await Promise.all(["race","choice","gap","translation"].map(gameId=>recordGameAnswer({...answer(f),gameId},f.d.db)));
    assert.ok(results.every(result=>result.ok&&result.verified&&result.correct));
    assert.equal(results.reduce((n,result)=>n+(result.ok?result.awarded:0),0),1);
    assert.deepEqual((await state(f)).word,before);
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events"),[{n:4}]);
    assert.deepEqual(await f.d.query("select count(*)::int n,sum(points)::int points from vocab_point_events"),[{n:1,points:1}]);
  } finally {await f.d.close();}
});

test("game awards obey the Tashkent day boundary across game modes",async t=>{
  const f=await fixture(t);
  try {
    const dates=["2026-10-10T18:59:59.999Z","2026-10-10T19:00:00.000Z","2026-10-10T19:01:00.000Z"];
    const awards=[];
    for(const date of dates) {
      const result=await recordGameAnswer({...answer(f),now:new Date(date)},f.d.db);
      assert.ok(result.ok);
      awards.push(result.awarded);
    }
    assert.deepEqual(awards,[1,1,0]);
  } finally {await f.d.close();}
});

test("game clock failures roll back all evidence; wrong and self answers count as activity with zero credit",async t=>{
  const f=await fixture(t);
  try {
    const before=await state(f);
    await f.d.query("create function reject_game_clock() returns trigger language plpgsql as $$ begin raise exception 'game activity fixture failure'; end $$");
    await f.d.query("create trigger reject_game_clock before update on users for each row execute function reject_game_clock()");
    await assert.rejects(recordGameAnswer(answer(f),f.d.db));
    assert.deepEqual(await state(f),before);
    await f.d.query("drop trigger reject_game_clock on users");
    const inputs=[{...answer(f),submission:{kind:"spelling" as const,text:"wrong"}},
      {...answer(f),gameId:"cards",submission:{kind:"self" as const,known:true}},
      {...answer(f),gameId:"cards"}];
    for(const input of inputs) {
      const result=await recordGameAnswer(input,f.d.db);
      assert.ok(result.ok);
      assert.equal(result.awarded,0);
    }
    assert.deepEqual((await state(f)).word,before.word);
    assert.deepEqual(await f.d.query("select last_meaningful_activity_at from users where id=$1",[f.user]),[{last_meaningful_activity_at:now}]);
    assert.deepEqual(await f.d.query("select count(*)::int n from vocab_point_events"),[{n:0}]);
    assert.deepEqual(await loadSelfAssessments(f.user,[f.entry],f.d.db),{[f.entry]:"known"});
    const verdicts=await f.d.query("select (payload->>'correct')::boolean correct,(payload->>'verified')::boolean verified from activity_events");
    assert.deepEqual(verdicts.map(value=>JSON.stringify(value)).sort(),
      [{correct:false,verified:true},{correct:true,verified:false},{correct:false,verified:false}].map(value=>JSON.stringify(value)).sort());
    const future=new Date(now.getTime()+86400000);
    await f.d.query("update users set last_meaningful_activity_at=$1 where id=$2",[future,f.user]);
    assert.ok((await recordGameAnswer(answer(f),f.d.db)).ok);
    assert.deepEqual(await f.d.query("select last_meaningful_activity_at from users where id=$1",[f.user]),[{last_meaningful_activity_at:future}]);
  } finally {await f.d.close();}
});
