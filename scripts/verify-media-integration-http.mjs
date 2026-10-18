import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {serveMedia} from '../workers/learnersarea-media/index.ts';
import {createMediaCapability,mediaCapabilityUrl,verifyMediaCapability} from '../src/lib/media/protocol.ts';

// Real native PostgreSQL and a production-build HTTP server. The R2 transport
// below is an instrumented fixture, never evidence of live Cloudflare playback.
const database=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
assert.ok(['127.0.0.1','localhost'].includes(database.hostname)&&database.pathname==='/learners_telegram_ci',
  'Only the explicitly named disposable loopback CI database is allowed');
const pool=new pg.Pool({connectionString:database.toString()});
const base='http://127.0.0.1:3118',workerBase='https://learnersarea-media.owneruchunla.workers.dev';
const secret='fixture-only-media-secret-no-production-access',password='fixture-only-password';
const ids=[randomUUID(),randomUUID(),randomUUID()],suffix=randomUUID();
const emails=ids.map((_,i)=>`media-${i}-${suffix}@fixture.invalid`);
const key=`speaking/attempts/${randomUUID()}/fixture.mp3`,draftKey=`resources/${randomUUID()}/draft.mp3`;
const payload=Uint8Array.from({length:256},(_,i)=>i);
const tokens=[],cookies=[],cases=[];
let child,output='',bucketReads=0,callbackReads=0;
const request=(path,body,cookie)=>fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'manual',
  signal:AbortSignal.timeout(20000),headers:{Origin:base,'Content-Type':'application/json',...(cookie?{cookie}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
async function login(index){
  const r=await request('/api/auth/login',{email:emails[index],password});assert.equal(r.status,200,'fixture login');
  const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);cookies.push(cookie);return cookie;
}
async function capability(cookie,resource=key){
  const r=await request('/api/resources/'+resource+'?capability=1',undefined,cookie);assert.equal(r.status,200);
  const value=await r.json();assert.ok(value.expiresAt>Date.now());assert.equal(new URL(value.url).origin,workerBase);
  const token=new URL(value.url).searchParams.get('token');assert.ok(token);tokens.push(token);return value.url;
}
const object={size:payload.length,httpEtag:'"fixture-v1"',uploaded:new Date('2026-01-01T00:00:00Z'),
  httpMetadata:{contentType:'audio/mpeg'},writeHttpMetadata(headers){headers.set('Content-Type','audio/mpeg');}};
const env={MEDIA_SIGNING_SECRET:secret,MEDIA_BUCKET:{
  async head(resource){bucketReads++;assert.ok([key,draftKey].includes(resource));return object;},
  async get(resource,options){bucketReads++;assert.ok([key,draftKey].includes(resource));
    assert.equal(options.onlyIf.get('If-Match'),object.httpEtag);
    const bytes=options.range?payload.slice(options.range.offset,options.range.offset+options.range.length):payload;
    return {...object,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};
  },
}};
async function callback(url,init){
  assert.equal(url,'https://learnersarea.uz/api/media/authorize');callbackReads++;
  return fetch(base+'/api/media/authorize',{...init,signal:AbortSignal.timeout(15000)});
}
async function read(url,method='GET',headers={}){
  return serveMedia(new Request(url,{method,headers:{Origin:'https://learnersarea.uz',...headers}}),env,callback);
}
async function denyAllReads(url,label){
  const before=bucketReads;
  for(const [method,headers] of [['GET',{}],['HEAD',{}],['GET',{Range:'bytes=0-3'}]]){
    assert.equal((await read(url,method,headers)).status,403,`${label}: ${method}`);
  }
  assert.equal(bucketReads,before,`${label}: denied authority cannot touch R2`);cases.push(label);
}
try{
  assert.equal((await pool.query("select exists(select 1 from information_schema.columns where table_name='users' and column_name='auth_version') as ready")).rows[0].ready,true,
    'Run the native PostgreSQL migration/Telegram fixture first');
  const hash=await bcrypt.hash(password,4);
  for(let i=0;i<ids.length;i++)await pool.query("insert into users(id,name,email,password_hash,role,account_status,locale,onboarding_completed_at) values($1,'Media fixture',$2,$3,$4,'active','en',now())",[ids[i],emails[i],hash,i===2?'admin':'student']);
  await pool.query("insert into speaking_attempts(user_id,part,recording_object_key,recording_mime_type) values($1,'part1',$2,'audio/mpeg')",[ids[0],key]);
  await pool.query("insert into speaking_materials(created_by_user_id,category,title,primary_type,primary_object_key,is_active,publication_state) values($1,'part1','Private media fixture','audio',$2,false,'draft')",[ids[2],draftKey]);
  const serverEnv={...process.env,NODE_ENV:'production',DATABASE_URL:database.toString(),AUTH_EVENTS_DATABASE_URL:database.toString(),
    PUBLIC_BASE_URL:base,AUTH_SECRET:'fixture-only-auth-secret-no-production-access',PUBLIC_AUTH_MODE:'standard',MEDIA_WORKER_URL:workerBase,MEDIA_SIGNING_SECRET:secret};
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3118'],{env:serverEnv,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',c=>{output+=c;});child.stderr.on('data',c=>{output+=c;});
  const deadline=Date.now()+45000;
  for(;;){try{if((await request('/api/version')).ok)break;}catch{/* startup */}
    assert.equal(child.exitCode,null);assert.ok(Date.now()<deadline,'server startup');await delay(150);}
  assert.equal((await request('/api/resources/'+key+'?capability=1')).status,401);cases.push('anonymous_denied');
  const first=await login(0),secondDevice=await login(0),other=await login(1),admin=await login(2);
  assert.notEqual(first,secondDevice);assert.equal((await request('/api/resources/'+key+'?capability=1',undefined,other)).status,403);cases.push('cross_student_denied');
  const url=await capability(first),otherDeviceUrl=await capability(secondDevice);
  let response=await read(url);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),payload);
  response=await read(url,'HEAD',{Range:'bytes=1-3'});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),'256');assert.equal((await response.arrayBuffer()).byteLength,0);
  response=await read(url,'GET',{Range:'bytes=2-4'});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-4/256');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),payload.slice(2,5));
  response=await read(url,'GET',{Range:'bytes=-3'});assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),payload.slice(-3));
  response=await read(url,'GET',{Range:'bytes=999-'});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */256');
  response=await read(url,'GET',{Range:'bytes=2-4','If-Range':'"old"'});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,256);
  assert.equal(callbackReads,6,'every GET/HEAD/Range has its own authoritative HTTP check');cases.push('authorized_stream_head_ranges_if_range');
  assert.equal((await request('/api/auth/logout',{},first)).status,200);
  assert.equal((await request('/api/auth/state',undefined,first)).status,401);await denyAllReads(url,'logout_replay_denied');
  assert.equal((await read(otherDeviceUrl)).status,200);cases.push('other_device_survives_logout');
  const fresh=await login(0),freshUrl=await capability(fresh);assert.equal((await read(freshUrl)).status,200);cases.push('fresh_login_survives_logout');
  // Real PostgreSQL NOTIFY must reach the authenticated SSE, not just a mock.
  const abort=new AbortController();const stream=await fetch(base+'/api/auth/changes',{headers:{cookie:fresh},signal:abort.signal});
  assert.equal(stream.status,200);const reader=stream.body.getReader(),decoder=new TextDecoder();let sse='';
  const nextEvent=async()=>{const limit=Date.now()+12000;for(;;){if(sse.includes('event: access-changed')){sse=sse.slice(sse.indexOf('event: access-changed')+21);return;}
    const part=await Promise.race([reader.read(),delay(Math.max(1,limit-Date.now())).then(()=>{throw Error('native_NOTIFY_timeout');})]);assert.equal(part.done,false);sse+=decoder.decode(part.value);}};
  try{await nextEvent();await pool.query("update users set account_status='suspended' where id=$1",[ids[0]]);await nextEvent();}
  finally{abort.abort();await reader.cancel().catch(()=>{});}cases.push('native_notify_reaches_sse');
  await denyAllReads(freshUrl,'suspended_session_denied');
  await pool.query("update users set account_status='active' where id=$1",[ids[0]]);await denyAllReads(freshUrl,'reactivation_does_not_revive_session');
  const reactivated=await capability(await login(0));assert.equal((await read(reactivated)).status,200);cases.push('reactivated_fresh_session_allowed');
  const privileged=await capability(admin,draftKey);assert.equal((await read(privileged)).status,200);
  await pool.query("update users set role='student' where id=$1",[ids[2]]);await denyAllReads(privileged,'downgraded_session_denied');
  const downgraded=await login(2);assert.equal((await request('/api/resources/'+draftKey+'?capability=1',undefined,downgraded)).status,403);cases.push('fresh_downgraded_role_has_no_draft_access');
  const claims=await verifyMediaCapability(secret,new URL(reactivated).searchParams.get('token'),key);assert.ok(claims);
  const expired=await createMediaCapability(secret,claims,{now:Math.floor(Date.now()/1000)-200});
  await denyAllReads(mediaCapabilityUrl(workerBase,key,expired.token),'expired_media_denied');
  for(const sensitive of [secret,serverEnv.AUTH_SECRET,...tokens,...cookies.map(c=>c.slice(c.indexOf('=')+1))])assert.equal(output.includes(sensitive),false,'server output must not expose tokens or secrets');
  console.log(JSON.stringify({pass:true,scope:'native PostgreSQL + built Next HTTP + Worker function with instrumented R2; not live Cloudflare playback',cases,callbackReads,secretOrTokenInServerOutput:false},null,2));
}finally{
  if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}
  // Only this script's randomly identified disposable loopback fixtures.
  await pool.query('delete from users where id=any($1::uuid[])',[ids]);await pool.end();
}
