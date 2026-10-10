import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { applyScheduledReview, confirmSentenceUse, recordSentenceUse } from "../src/lib/services/vocabulary/engine";
import { createTestDatabase } from "./support/pglite";
import { vocabularyReviewHttpSchema } from "../src/lib/services/vocabulary/review-input";

const now = new Date("2026-10-10T06:00:00Z");

test("review HTTP accepts recall alone and refuses caller-selected time, stage, points or identity", () => {
  assert.deepEqual(vocabularyReviewHttpSchema.parse({outcome:"correct"}),{outcome:"correct"});
  for (const body of [null,{outcome:"guess"},{outcome:"correct",now:now.toISOString()},
    {outcome:"correct",points:100},{outcome:"correct",srsStage:4},{outcome:"incorrect",userId:randomUUID()}]) {
    assert.equal(vocabularyReviewHttpSchema.safeParse(body).success,false);
  }
});

async function fixture(t: TestContext) {
  // Every tested write must use the explicit isolated database, even before the
  // repair. Block legacy best-effort bookkeeping from reaching any default DB.
  if (global.__learnersAreaPool) t.mock.method(global.__learnersAreaPool, "query", async () => { throw new Error("Global DB forbidden in isolated review test"); });
  const d = await createTestDatabase();
  const [user, other] = await d.query<{ id: string }>("insert into users(name,role,account_status,last_meaningful_activity_at) values ('Review learner','student','active','2026-10-01'),('Other learner','student','active','2026-10-01') returning id");
  const [word] = await d.query<{ id: string }>("insert into lexemes(term,definition_en,sense_key) values ('resilient','Able to recover',$1) returning id", [randomUUID()]);
  const [entry, foreign] = await d.query<{ id: string }>("insert into user_vocabulary(user_id,lexeme_id,next_review_at) values ($1,$3,$4),($2,$3,$4) returning id", [user!.id,other!.id,word!.id,now]);
  return { d,user:user!.id,other:other!.id,entry:entry!.id,foreign:foreign!.id };
}

async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    words:await f.d.query("select srs_stage,correct_count,incorrect_count,active_use_count,mastery,next_review_at,last_reviewed_at from user_vocabulary where id=$1",[f.entry]),
    actor:await f.d.query("select last_meaningful_activity_at from users where id=$1",[f.user]),
    events:await f.d.query("select count(*)::int n from activity_events"),
    points:await f.d.query("select count(*)::int n from vocab_point_events"),
  };
}

test("scheduled-review event failure leaves schedule, activity and points unchanged; retry awards once", async t => {
  const f=await fixture(t);
  try {
    const before=await state(f);
    await f.d.query("create function reject_review_event() returns trigger language plpgsql as $$ begin if NEW.type='VOCAB_REVIEWED' then raise exception 'review event fixture failure'; end if; return NEW; end $$");
    await f.d.query("create trigger reject_review_event before insert on activity_events for each row execute function reject_review_event()");
    const input={userId:f.user,entryId:f.entry,outcome:"correct" as const,now};
    await assert.rejects(applyScheduledReview(input,f.d.db));
    assert.deepEqual(await state(f),before);
    await f.d.query("drop trigger reject_review_event on activity_events");
    const result=await applyScheduledReview(input,f.d.db);
    assert.ok(result.ok);
    assert.equal(result.points,1);
    const replay=await applyScheduledReview(input,f.d.db);
    assert.equal(replay.ok,false);
    if (!replay.ok) assert.equal(replay.error,"not_due");
    assert.deepEqual(await f.d.query("select count(*)::int n from vocab_point_events"),[{n:1}]);
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events where type='VOCAB_REVIEWED'"),[{n:1}]);
  } finally { await f.d.close(); }
});

test("scheduled-review point failure rolls back the schedule, event and activity clock", async t => {
  const f=await fixture(t);
  try {
    const before=await state(f);
    await f.d.query("create function reject_review_points() returns trigger language plpgsql as $$ begin raise exception 'review points fixture failure'; end $$");
    await f.d.query("create trigger reject_review_points before insert on vocab_point_events for each row execute function reject_review_points()");
    await assert.rejects(applyScheduledReview({userId:f.user,entryId:f.entry,outcome:"incorrect",now},f.d.db));
    assert.deepEqual(await state(f),before);
  } finally { await f.d.close(); }
});

test("competing scheduled reviews consume one due slot and persist one outcome", async t => {
  const f=await fixture(t);
  try {
    const results=await Promise.all(["correct","incorrect"].map(outcome=>applyScheduledReview({userId:f.user,entryId:f.entry,outcome:outcome as "correct"|"incorrect",now},f.d.db)));
    assert.equal(results.filter(x=>x.ok).length,1);
    assert.equal(results.filter(x=>!x.ok&&x.error==="not_due").length,1);
    assert.deepEqual(await f.d.query("select correct_count+incorrect_count as attempts from user_vocabulary where id=$1",[f.entry]),[{attempts:1}]);
    assert.deepEqual(await f.d.query("select count(*)::int n,sum(points)::int points from vocab_point_events"),[{n:1,points:1}]);
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events where type='VOCAB_REVIEWED'"),[{n:1}]);
  } finally { await f.d.close(); }
});

test("review and accepted sentence keep both evidence ladders and derive mastery from the final row", async t => {
  const f=await fixture(t);
  try {
    await f.d.query("update user_vocabulary set srs_stage=3,correct_count=4,interval_days=16,mastery='known' where id=$1",[f.entry]);
    const usage=await recordSentenceUse({userId:f.user,entryId:f.entry,sentence:"Resilient people recover quickly."},f.d.db);
    assert.ok(usage.ok);
    const results=await Promise.all([
      applyScheduledReview({userId:f.user,entryId:f.entry,outcome:"correct",now},f.d.db),
      confirmSentenceUse({userId:f.user,usageId:usage.usageId,accepted:true,evaluationId:randomUUID()},f.d.db),
    ]);
    assert.ok(results.every(x=>x.ok));
    assert.deepEqual(await f.d.query("select srs_stage,correct_count,active_use_count,mastery from user_vocabulary where id=$1",[f.entry]),[{srs_stage:4,correct_count:5,active_use_count:1,mastery:"mastered"}]);
    assert.deepEqual(await f.d.query("select kind,points from vocab_point_events order by kind"),[{kind:"revision",points:1},{kind:"sentence",points:2}]);
  } finally { await f.d.close(); }
});

test("scheduled-review identity and strict input guards refuse forged state before any write", async t => {
  const f=await fixture(t);
  try {
    const input={userId:f.user,entryId:f.entry,outcome:"correct" as const,now};
    for (const forged of [{...input,outcome:"guessed"},{...input,points:100},{...input,srsStage:4},{...input,now:new Date("invalid")},{...input,userId:"not-a-user"}]) {
      const before=await state(f);
      assert.deepEqual(await applyScheduledReview(forged as never,f.d.db),{ok:false,error:"invalid_input"});
      assert.deepEqual(await state(f),before);
    }
    assert.deepEqual(await applyScheduledReview({...input,entryId:f.foreign},f.d.db),{ok:false,error:"not_found"});
    await f.d.query("update users set account_status='suspended' where id=$1",[f.user]);
    const before=await state(f);
    assert.deepEqual(await applyScheduledReview(input,f.d.db),{ok:false,error:"unauthenticated"});
    assert.deepEqual(await state(f),before);
  } finally { await f.d.close(); }
});

test("review respects the exact due boundary, fixed intervals and a monotonic activity clock", async t => {
  const f=await fixture(t);
  try {
    const before=await state(f);
    const early=await applyScheduledReview({userId:f.user,entryId:f.entry,outcome:"correct",now:new Date(now.getTime()-1)},f.d.db);
    assert.equal(early.ok,false);
    if (!early.ok) assert.equal(early.error,"not_due");
    assert.deepEqual(await state(f),before);
    const futureActivity=new Date(now.getTime()+1000);
    await f.d.query("update users set last_meaningful_activity_at=$2 where id=$1",[f.user,futureActivity]);
    let due=now;
    for (const days of [1,3,7,16,35]) {
      const result=await applyScheduledReview({userId:f.user,entryId:f.entry,outcome:"correct",now:due},f.d.db);
      assert.ok(result.ok);
      assert.equal(result.intervalDays,days);
      assert.equal(result.nextReviewAt.getTime()-due.getTime(),days*86400000);
      due=result.nextReviewAt;
    }
    const [clock]=await f.d.query<{last_meaningful_activity_at:Date}>("select last_meaningful_activity_at from users where id=$1",[f.user]);
    assert.ok(clock!.last_meaningful_activity_at.getTime()>=futureActivity.getTime());
  } finally { await f.d.close(); }
});
