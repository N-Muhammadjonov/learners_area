#!/usr/bin/env node
/** Built-server complement to TED-MIC DOM tests: written persistence and both native surfaces.
 * This cannot record microphone hardware or prove audible playback; those remain browser QA.
 * All rows are isolated QA2 fixtures and are removed in finally. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {SignJWT} from 'jose';
import {assertIsolatedTarget} from './qa2-seed-fixtures.mjs';
const DB=process.env.DATABASE_URL, BASE=process.env.BASE_URL ?? 'http://127.0.0.1:3100', SECRET=process.env.AUTH_SECRET;
assertIsolatedTarget(DB);assert.ok(SECRET?.length>=16,'server AUTH_SECRET required');
const c=new pg.Client({connectionString:DB});await c.connect();
const marker=`qa2-voice-${randomUUID().slice(0,8)}`, ids=[], videos=[];
let pass=0,fail=0;
const check=(name,ok)=>{console.log(`${ok?'ok':'not ok'} - ${name}`);ok?pass++:fail++;};
const q=async(sql,args=[]) => (await c.query(sql,args)).rows;
const cookie=async(id)=>`la_session=${await new SignJWT({sub:id,role:'student',name:'QA only',locale:'en',onboarded:true}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}; la_locale=en`;
const get=async(path,token)=>{const r=await fetch(BASE+path,{headers:{cookie:token},redirect:'manual'});return {status:r.status,text:await r.text()};};
try{
 for(const suffix of ['a','b']){const [u]=await q(`insert into users(name,email,role,account_status) values($1,$2,'student','active') returning id`,[marker,`${marker}-${suffix}@learners-qa.invalid`]);ids.push(u.id);}
 const a=await cookie(ids[0]),b=await cookie(ids[1]);
 const pack=JSON.parse(readFileSync('src/lib/video/ted-study-pack.json','utf8'))[0];
 for(const [index,title] of [`${marker} generic`,pack.title].entries()){
  const [v]=await q(`insert into video_lessons(title,provider,video_id,source_ref,publication_state,publish_at) values($1,'youtube',$2,$3,'published',now()) returning id`,[title,`QA2VOICE00${index}`,`${marker}-${index}`]);videos.push(v.id);
  const initial=await get(`/app/video-lessons/${v.id}`,a);
  check(`${index} native lesson opens`,initial.status===200&&initial.text.includes('data-video-standalone'));
  check(`${index} local recorder component is mounted`,initial.text.includes('data-local-reflection'));
  check(`${index} privacy statement explains no saving`,initial.text.includes('Audio is not saved'));
  check(`${index} no voice playback is restored`,!initial.text.includes('src="blob:'));
  const writing=`${marker} PRIVATE WRITTEN SUMMARY ${index}`;
  const payload=index===0?{summaryText:writing}:{responseText:JSON.stringify({kind:'ted-study-pack-v1',answers:{H:writing}})};
  const saved=await fetch(`${BASE}/api/video-lessons/${v.id}/response`,{method:'POST',headers:{cookie:a,'content-type':'application/json'},body:JSON.stringify(payload)});
  check(`${index} written response uses existing endpoint`,saved.status===200);
  const [progress]=await q(`select response_text,summary_text from video_lesson_progress where user_id=$1 and video_lesson_id=$2`,[ids[0],v.id]);
  check(`${index} writing persisted in existing column`,index===0?progress?.summary_text===writing:progress?.response_text===payload.responseText);
  const reopened=await get(`/app/video-lessons/${v.id}`,a);
  check(`${index} new request restores writing`,reopened.text.includes(writing));
  check(`${index} new request has no temporary voice`,!reopened.text.includes('src="blob:'));
  const other=await get(`/app/video-lessons/${v.id}`,b);check(`${index} another learner does not receive this writing`,!other.text.includes(writing));
 }
 check('no voice persistence columns',!(await q(`select column_name from information_schema.columns where table_name='video_lesson_progress' and column_name ~ '(audio|voice|object_key)'`)).length);
}finally{
 await q(`delete from video_lesson_progress where video_lesson_id=any($1::uuid[])`,[videos]);
 await q(`delete from video_lessons where id=any($1::uuid[])`,[videos]);
 await q(`delete from users where id=any($1::uuid[])`,[ids]);
 check('fixture lessons removed',(await q(`select count(*)::int n from video_lessons where source_ref like $1`,[`${marker}%`]))[0].n===0);
 check('fixture identities removed',(await q(`select count(*)::int n from users where id=any($1::uuid[])`,[ids]))[0].n===0);
 check('fixture writing removed',(await q(`select count(*)::int n from video_lesson_progress where video_lesson_id=any($1::uuid[])`,[videos]))[0].n===0);
 await c.end();
}
console.log(`${fail?'FAIL':'PASS'} — ${pass}/${pass+fail} checks`);if(fail)process.exitCode=1;
