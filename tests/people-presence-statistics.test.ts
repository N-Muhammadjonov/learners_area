import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {listPeople} from '../src/lib/data/people';
import {heartbeat} from '../src/lib/services/presence';
import {learningSummary,resultHistory,retentionSummary,centreStatistics} from '../src/lib/data/management-statistics';
test('People excludes rejected by default, searches current verified contacts, masks owner-only phone and sorts staff before recently active students',async()=>{
 const e=await createTestDatabase();try{
 const people=await e.query<{id:string;role:string;name:string}>("insert into users(name,role,account_status,telegram_id) values('Student','student','active','11111'),('Owner','owner','active',null),('Rejected','student','rejected',null),('Teacher','teacher','active',null) returning id,role,name");
 const student=people.find(r=>r.name==='Student')!;
 await e.query("insert into telegram_contacts(telegram_user_id,chat_id,username,phone_number,phone_verified_at,linked_user_id) values('11111','11111','first_name','+998901234567',now(),$1)",[student.id]);
 let rows=await listPeople({},e.db,true);assert.deepEqual(rows.people.map(r=>r.name),['Owner','Teacher','Student']);assert.equal(rows.people.at(-1)?.phoneNumber,'+998901234567');
 assert.equal((await listPeople({},e.db,false)).people.at(-1)?.phoneNumber,null);
 assert.equal((await listPeople({status:'rejected'},e.db)).total,1);
 assert.equal((await listPeople({q:'@first_name'},e.db)).total,1);
 assert.equal((await listPeople({q:'+998 90 123 45 67'},e.db,true)).total,1);
 await e.query("update telegram_contacts set username='new_name' where linked_user_id=$1",[student.id]);assert.equal((await listPeople({q:'@first_name'},e.db)).total,0);assert.equal((await listPeople({q:'new_name'},e.db)).total,1);
 await e.query("insert into users(name,account_status) values('Offline student','active')");
 await heartbeat(student.id,e.db);assert.equal((await listPeople({role:'student'},e.db)).people[0]?.name,'Student','online students precede untracked students');rows=await listPeople({online:true},e.db);assert.equal(rows.total,1);assert.equal(rows.onlineCount,1);assert.equal(rows.people[0]?.name,'Student');
 }finally{await e.close();}
});
test('Presence credits only server-observed time once across tabs, does not credit offline gaps or change study activity',async()=>{
 const e=await createTestDatabase();try{
 const [u]=await e.query<{id:string}>("insert into users(name,account_status) values('Presence fixture','active') returning id");
 await heartbeat(u!.id,e.db);await heartbeat(u!.id,e.db);
 let [p]=await e.query<{payload:{totalSeconds:number;visitSeconds:number}}>("select payload from activity_events where user_id=$1",[u!.id]);assert.equal(p!.payload.totalSeconds,0);
 await e.query("update activity_events set created_at=now()-interval '30 seconds' where user_id=$1",[u!.id]);await heartbeat(u!.id,e.db);
 [p]=await e.query("select payload from activity_events where user_id=$1",[u!.id]);assert.ok(p!.payload.totalSeconds>=29&&p!.payload.totalSeconds<=31);
 await e.query("update activity_events set created_at=now()-interval '3 hours' where user_id=$1",[u!.id]);await heartbeat(u!.id,e.db);
 const [after]=await e.query<{payload:{totalSeconds:number;visitSeconds:number}}>("select payload from activity_events where user_id=$1",[u!.id]);assert.equal(after!.payload.totalSeconds,p!.payload.totalSeconds);assert.equal(after!.payload.visitSeconds,0);
 const [user]=await e.query<{last_meaningful_activity_at:null}>("select last_meaningful_activity_at from users where id=$1",[u!.id]);assert.equal(user!.last_meaningful_activity_at,null);
 assert.equal((await e.query("select id from activity_events where user_id=$1",[u!.id])).length,1,'constant storage per user');
 }finally{await e.close();}
});
test('All result modules query real schema; typing results remain user-scoped, averages and complete history pagination use saved values',async()=>{
 const e=await createTestDatabase();try{
 const [a,b]=await e.query<{id:string}>("insert into users(name) values('A'),('B') returning id");
 await e.query("insert into typing_runs(user_id,target_chars,typed_chars,duration_ms,wpm,accuracy) select $1,100,100,60000,30,80 from generate_series(1,27)",[a!.id]);
 await e.query("insert into typing_runs(user_id,target_chars,typed_chars,duration_ms,wpm,accuracy) values($1,100,100,60000,40,100)",[b!.id]);
 const summaries=await learningSummary(a!.id,e.db),writing=summaries.find(r=>r.module==='writing')!;assert.equal(writing.started,27);assert.equal(writing.completed,27);assert.equal(writing.accuracy,80);assert.equal(summaries.length,11);
 const page=await resultHistory(a!.id,'writing',2,e.db);assert.equal(page.total,27);assert.equal(page.rows.length,2);assert.equal(page.pages,2);assert.equal(page.rows[0]!.score,80);
 assert.deepEqual(await retentionSummary(a!.id,e.db),[]);
 const centre=await centreStatistics("writing",e.db);assert.equal(centre.summary.find(r=>r.module==="writing")?.completed,28);assert.equal(centre.students.length,2);assert.equal(centre.daily.reduce((n,r)=>n+r.count,0),28);
 }finally{await e.close();}
});
