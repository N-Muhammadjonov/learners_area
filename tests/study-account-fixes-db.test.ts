import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {db} from '../src/db/client';
import {prepareIntentExchange,replaceTelegramForIntent} from '../src/lib/auth/telegram-exchange';
import {hashToken} from '../src/lib/auth/telegram-intent';
import {validateSessionAuthority} from '../src/lib/auth/session-authority';
import {saveStudyProfile} from '../src/lib/data/study-profile';
import {ingestVideoOccurrences} from '../src/lib/services/lexical/reading-occurrences';
import {onboardingSchema} from '../src/lib/validation/onboarding';
import {registrationFullNameSchema} from '../src/lib/validation/auth';
import {getStanding} from '../src/lib/services/vocabulary/engine';

test('verified Telegram replacement preserves the student UUID/results and revokes old sessions; conflicts fail closed',async()=>{
 const e=await createTestDatabase();mock.method(db,'transaction',e.db.transaction.bind(e.db));mock.method(db.query.telegramLoginIntents,'findFirst',e.db.query.telegramLoginIntents.findFirst.bind(e.db.query.telegramLoginIntents));mock.method(db.query.users,'findFirst',e.db.query.users.findFirst.bind(e.db.query.users));mock.method(db,'select',e.db.select.bind(e.db));mock.method(db,'insert',e.db.insert.bind(e.db));mock.method(db,'update',e.db.update.bind(e.db));mock.method(db,'execute',e.db.execute.bind(e.db));mock.method(db.query.accessRequests,'findFirst',e.db.query.accessRequests.findFirst.bind(e.db.query.accessRequests));mock.method(db.query.telegramContacts,'findFirst',e.db.query.telegramContacts.findFirst.bind(e.db.query.telegramContacts));
 try{
 const [student,other,owner]=await e.query<{id:string;auth_version:number}>("insert into users(name,role,account_status,telegram_id) values('Student Own Name','student','active','71001'),('Other Student','student','active','71003'),('Owner Name','owner','active','71004') returning id,auth_version");
 await e.query("insert into telegram_contacts(telegram_user_id,chat_id,linked_user_id,phone_number,phone_verified_at) values('71001','71001',$1,'+998000000001',now()),('71002','71002',null,'+998000000002',now()),('71003','71003',$2,'+998000000003',now()),('71005','71005',null,null,null)",[student!.id,other!.id]);
 const [p]=await e.query<{id:string}>("insert into reading_passages(title,body_text) values('Fixture','Text') returning id");
 await e.query("insert into reading_attempts(user_id,passage_id,status,score) values($1,$2,'completed',8)",[student!.id,p!.id]);
 const before=await e.query('select to_jsonb(a) row from reading_attempts a order by id');
 const [intent]=await e.query<{id:string}>("insert into telegram_login_intents(token_hash,browser_nonce_hash,purpose,user_id,telegram_user_id,status,expires_at) values($1,$2,'replace',$3,'71002','confirmed',now()+interval '5 minutes') returning id",[hashToken('own-token'),hashToken('own-nonce'),student!.id]);
 const actor={id:student!.id,authVersion:student!.auth_version};
 assert.equal((await prepareIntentExchange(intent!.id,'wrong-nonce',undefined,undefined,actor)).ok,false);
 const changed=await prepareIntentExchange(intent!.id,'own-nonce',undefined,undefined,actor);assert.equal(changed.ok,true);if(!changed.ok)throw Error('replacement_failed');
 assert.equal(changed.user.id,student!.id);assert.equal(changed.user.name,'Student Own Name');assert.equal(changed.user.telegramId,'71002');assert.equal(changed.user.authVersion,actor.authVersion+1);
 assert.deepEqual(await e.query('select to_jsonb(a) row from reading_attempts a order by id'),before);
 assert.equal(await validateSessionAuthority({userId:student!.id,authVersion:actor.authVersion,sessionKey:'a'.repeat(64),expiresAt:Math.floor(Date.now()/1000)+600},e.db),null);
 assert.equal((await e.query<{linked_user_id:string|null}>("select linked_user_id from telegram_contacts where telegram_user_id='71001'"))[0]!.linked_user_id,null);
 assert.equal((await prepareIntentExchange(intent!.id,'own-nonce',undefined,undefined,actor)).ok,false,'stale authority cannot replay a replacement');
 const fresh={...actor,authVersion:actor.authVersion+1};
 assert.deepEqual(await e.db.transaction(tx=>replaceTelegramForIntent(tx,student!.id,'71003',fresh)),{ok:false,error:'conflict'});
 assert.deepEqual(await e.db.transaction(tx=>replaceTelegramForIntent(tx,student!.id,'71005',fresh)),{ok:false,error:'phone_required'});
 assert.deepEqual(await e.db.transaction(tx=>replaceTelegramForIntent(tx,owner!.id,'71002',{id:owner!.id,authVersion:owner!.auth_version})),{ok:false,error:'change_not_available'});
 assert.equal((await e.query<{telegram_id:string}>('select telegram_id from users where id=$1',[student!.id]))[0]!.telegram_id,'71002');
 }finally{mock.restoreAll();await e.close();}
});

test('registration uses the supplied full name, and study-profile edits cannot change authority or history',async()=>{
 const e=await createTestDatabase();mock.method(db,'transaction',e.db.transaction.bind(e.db));mock.method(db.query.telegramLoginIntents,'findFirst',e.db.query.telegramLoginIntents.findFirst.bind(e.db.query.telegramLoginIntents));mock.method(db.query.users,'findFirst',e.db.query.users.findFirst.bind(e.db.query.users));mock.method(db,'select',e.db.select.bind(e.db));mock.method(db,'insert',e.db.insert.bind(e.db));mock.method(db,'update',e.db.update.bind(e.db));mock.method(db,'execute',e.db.execute.bind(e.db));mock.method(db.query.accessRequests,'findFirst',e.db.query.accessRequests.findFirst.bind(e.db.query.accessRequests));mock.method(db.query.telegramContacts,'findFirst',e.db.query.telegramContacts.findFirst.bind(e.db.query.telegramContacts));
 try{
 const [intent]=await e.query<{id:string}>("insert into telegram_login_intents(token_hash,browser_nonce_hash,purpose,telegram_user_id,display_name,status,expires_at) values($1,$2,'register','72001','Telegram Alias','confirmed',now()+interval '5 minutes') returning id",[hashToken('register-token'),hashToken('register-nonce')]);
 assert.equal((await prepareIntentExchange(intent!.id,'register-nonce','female','Single')).ok,false);
 const created=await prepareIntentExchange(intent!.id,'register-nonce','female','Own Firstname Lastname');assert.equal(created.ok,true);if(!created.ok)throw Error('registration_failed');
 assert.equal(created.user.name,'Own Firstname Lastname');assert.equal(created.user.role,'student');assert.equal(created.user.accountStatus,'pending');
 const profile=onboardingSchema.parse({preferredLanguage:'en',currentLevel:'B2',currentBand:6.5,targetBand:7.5,examDate:'2028-02-29',dailyStudyMinutes:90,strongestSkill:'reading',weakestSkill:'speaking'});
 await saveStudyProfile(created.user.id,profile,e.db);
 const [saved]=await e.query<{name:string;role:string;account_status:string;current_band:number;exam_date:Date}>("select u.name,u.role,u.account_status,p.current_band,p.exam_date from users u join onboarding_profiles p on p.user_id=u.id where u.id=$1",[created.user.id]);
 assert.equal(saved!.name,'Own Firstname Lastname');assert.equal(saved!.role,'student');assert.equal(saved!.account_status,'pending');assert.equal(saved!.current_band,6.5);assert.equal(new Date(saved!.exam_date).toISOString().slice(0,10),'2028-02-29');
 assert.equal(onboardingSchema.safeParse({...profile,examDate:'2027-02-29'}).success,false);assert.equal(onboardingSchema.safeParse({...profile,role:'owner'}).success,false);assert.equal(registrationFullNameSchema.safeParse('Firstname').success,false);
 }finally{mock.restoreAll();await e.close();}
});

test('teacher video vocabulary can be outside the transcript and keeps two exact senses distinct',async()=>{
 const e=await createTestDatabase();try{
 const [video]=await e.query<{id:string}>("insert into video_lessons(title,video_id) values('TED fixture','dQw4w9WgXcQ') returning id");
 await e.db.transaction(tx=>ingestVideoOccurrences(tx,video!.id,'A transcript without these authored words.',[{word:'bank',pos:'noun',def:'A financial institution',uz:'bank',ex:'The bank lent us money.'},{word:'bank',pos:'noun',def:'Land beside a river',uz:'qirg‘oq',ex:''}]));
 const rows=await e.query<{lexeme_id:string;segment_key:string;surface_form:string;resolution_status:string}>("select lexeme_id,segment_key,surface_form,resolution_status from lexical_occurrences where video_lesson_id=$1",[video!.id]);
 assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.lexeme_id)).size,2);assert.ok(rows.every(r=>r.segment_key===`v:${r.lexeme_id}`&&r.surface_form==='bank'&&r.resolution_status==='resolved'));
 }finally{await e.close();}
});

test('Vocabulary standing shows the first 15 and the caller rank/profile outside that group',async()=>{
 const e=await createTestDatabase();mock.method(db,'select',e.db.select.bind(e.db));mock.method(db,'with',e.db.with.bind(e.db));try{
 const users=await e.query<{id:string;name:string}>("insert into users(name,role,account_status) select 'Learner '||lpad(n::text,2,'0'),'student','active' from generate_series(1,18) n returning id,name");
 for(const u of users){const n=Number(u.name.slice(-2));await e.query("insert into vocab_point_events(user_id,kind,points,dedupe_key,created_at) select $1,'revision',5,$2||g::text,now() from generate_series(1,$3::int) g",[u.id,u.name,19-n]);}
 await e.query("insert into onboarding_profiles(user_id,current_level) values($1,'B2')",[users[17]!.id]);
 const standing=await getStanding(users[17]!.id);assert.equal(standing.top.length,15);assert.equal(standing.rank,18);assert.equal(standing.name,'Learner 18');assert.equal(standing.level,'B2');assert.ok(!standing.top.some(r=>r.isMe));assert.ok(standing.top.every((r,i)=>i===0||r.points<=standing.top[i-1]!.points));
 }finally{mock.restoreAll();await e.close();}
});
