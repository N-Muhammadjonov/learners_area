import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {deleteMaterialIn,materialDeleted} from '../src/lib/content/delete-material';
import {notDeleted} from '../src/lib/content/deletion-filter';
import {liveWhere} from '../src/lib/services/cms/publication';
import {readingPassages,videoLessons} from '../src/db/schema';
import {listLearningLibrary} from '../src/lib/data/reading-library';
import {saveGeneralProgress} from '../src/lib/data/general-reading';

test('Delete removes material, not learner history; ownership and transaction rollback are enforced',async()=>{
 const e=await createTestDatabase();try{
 const [owner,teacher,learner]=await e.query<{id:string}>("insert into users(name,role,account_status) values('Owner','owner','active'),('Teacher','teacher','active'),('Learner','student','active') returning id");
 const [reading]=await e.query<{id:string}>("insert into reading_passages(title,body_text) values('Reading source','Source text') returning id");
 const [attempt]=await e.query<{id:string}>("insert into reading_attempts(user_id,passage_id,status,score) values($1,$2,'completed',7) returning id",[learner!.id,reading!.id]);
 const [video]=await e.query<{id:string}>("insert into video_lessons(title,video_id,created_by_user_id) values('Video source','01234567890',$1) returning id",[owner!.id]);
 await e.query("insert into video_lesson_progress(user_id,video_lesson_id) values($1,$2)",[learner!.id,video!.id]);
 const [listening]=await e.query<{id:string}>("insert into listening_tests(title,audio_url,audio_type,created_by_user_id) values('Audio source','/fixture.mp3','audio',$1) returning id",[owner!.id]);
 await e.query("insert into listening_attempts(user_id,test_id,status,score) values($1,$2,'completed',8)",[learner!.id,listening!.id]);
 const [writing]=await e.query<{id:string}>("insert into writing_prompts(task_type,category,prompt,target_word_count) values('task2','Essay','Writing source',250) returning id");
 const [speaking]=await e.query<{id:string}>("insert into speaking_prompts(category,prompt_text,part) values('part1','Speaking source','part1') returning id");
 const before=await e.query("select (select jsonb_agg(to_jsonb(r) order by id) from reading_attempts r) reading,(select jsonb_agg(to_jsonb(r) order by id) from listening_attempts r) listening,(select jsonb_agg(to_jsonb(r) order by id) from video_lesson_progress r) video");
 assert.equal(await e.db.transaction(tx=>deleteMaterialIn(tx,{id:learner!.id,role:'student'},'reading',reading!.id)),'forbidden');
 assert.equal(await e.db.transaction(tx=>deleteMaterialIn(tx,{id:teacher!.id,role:'teacher'},'video',video!.id)),'forbidden');
 await assert.rejects(e.db.transaction(async tx=>{await deleteMaterialIn(tx,{id:owner!.id,role:'owner'},'reading',reading!.id);throw Error('rollback');}));
 assert.equal(await materialDeleted(reading!.id,e.db),false);
 for(const [kind,id] of [['reading',reading!.id],['listening',listening!.id],['writing',writing!.id],['speaking-prompt',speaking!.id],['video',video!.id]] as const){
   assert.equal(await e.db.transaction(tx=>deleteMaterialIn(tx,{id:owner!.id,role:'owner'},kind,id)),'deleted');
   assert.equal(await materialDeleted(id,e.db),true);
 }
 assert.deepEqual(await e.query("select (select jsonb_agg(to_jsonb(r) order by id) from reading_attempts r) reading,(select jsonb_agg(to_jsonb(r) order by id) from listening_attempts r) listening,(select jsonb_agg(to_jsonb(r) order by id) from video_lesson_progress r) video"),before);
 assert.equal((await e.db.select().from(readingPassages).where(notDeleted(readingPassages.id))).length,0);
 assert.equal((await e.db.query.videoLessons.findMany({where:liveWhere(videoLessons)})).length,0,'relational alias resolves the real id column');
 assert.equal((await e.query<{status:string}>('select status from reading_attempts where id=$1',[attempt!.id]))[0]!.status,'completed');
 await e.db.transaction(tx=>deleteMaterialIn(tx,{id:owner!.id,role:'owner'},'reading',reading!.id));
 assert.equal((await e.query<{n:number}>("select count(*)::int n from activity_events where type='CONTENT_DELETED'"))[0]!.n,5,'deleting twice is idempotent');
 }finally{await e.close();}
});

test('General catalogue status follows open, partial draft, Check and reopen without altering another learner',async()=>{
 const e=await createTestDatabase();try{
 const [a,b]=await e.query<{id:string}>("insert into users(name) values('A'),('B') returning id");
 const [s]=await e.query<{id:string}>("insert into general_reading_sets(title) values('Set') returning id");
 const [p]=await e.query<{id:string}>("insert into reading_passages(title,body_text) values('Passage','Text') returning id");
 await e.query('insert into general_reading_passages(set_id,passage_id,passage_no) values($1,$2,1)',[s!.id,p!.id]);
 const [q]=await e.query<{id:string}>(`insert into reading_questions(passage_id,"order",type,question_text,correct_answer,explanation) values($1,1,'short_answer','Question','answer','Explanation') returning id`,[p!.id]);
 const status=async(userId:string)=>(await listLearningLibrary(userId,{},e.db)).items[0]!.status;
 const input={userId:a!.id,role:'student' as const,passageId:p!.id,answers:{},check:false,start:true};
 assert.equal(await status(a!.id),'not_started');
 await saveGeneralProgress(input,e.db);assert.equal(await status(a!.id),'in_progress');
 await saveGeneralProgress({...input,start:false,answers:{[q!.id]:'answer'}},e.db);assert.equal(await status(a!.id),'in_progress');
 await saveGeneralProgress({...input,start:false,answers:{[q!.id]:'answer'},check:true},e.db);assert.equal(await status(a!.id),'completed');
 const opened=await saveGeneralProgress(input,e.db);assert.equal(opened!.progress.score,1);assert.deepEqual(opened!.progress.answers,{[q!.id]:'answer'});
 assert.equal(await status(a!.id),'completed');assert.equal(await status(b!.id),'not_started');
 }finally{await e.close();}
});
