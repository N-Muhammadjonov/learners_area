import {api} from '../js/api-client.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';
import {
 extractYoutubeId,
 liveEmbedUrl,
} from '../modules/live-classes/contract.js';
import {mount as mountHub} from '../modules/live-classes/page.js';
import {mountRoom} from '../modules/live-classes/room.js';

const CLASS_LIVE_ID='11111111-1111-4111-8111-111111111101';
const CLASS_UPCOMING_ID='11111111-1111-4111-8111-111111111102';
const CLASS_RECORDED_ID='11111111-1111-4111-8111-111111111103';
const TEACHER_ID='22222222-2222-4222-8222-222222222201';
const MSG_1_ID='33333333-3333-4333-8333-333333333301';
const MSG_2_ID='33333333-3333-4333-8333-333333333302';

function setupDom(fetchHandler){
 const dom=new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',{url:'https://learnersarea.uz/app/live-classes'});
 globalThis.window=dom.window;
 globalThis.document=dom.window.document;
 globalThis.HTMLElement=dom.window.HTMLElement;
 globalThis.Node=dom.window.Node;
 globalThis.Event=dom.window.Event;
 globalThis.CustomEvent=dom.window.CustomEvent;
 globalThis.MutationObserver=dom.window.MutationObserver;
 const wsInstances=[];
 class MockWebSocket{
  static OPEN=1;
  static CLOSED=3;
  constructor(url){
   this.url=url;
   this.readyState=1;
   this.sent=[];
   this.closed=false;
   this._listeners={};
   wsInstances.push(this);
  }
  addEventListener(type,fn){
   (this._listeners[type]||(this._listeners[type]=[])).push(fn);
  }
  send(data){this.sent.push(data);}
  close(){
   this.closed=true;
   this.readyState=3;
   for(const fn of this._listeners.close||[])fn({});
  }
  emitOpen(){
   for(const fn of this._listeners.open||[])fn({});
  }
  emitMessage(payload){
   const evt={data:JSON.stringify(payload)};
   for(const fn of this._listeners.message||[])fn(evt);
  }
 }
 globalThis.WebSocket=MockWebSocket;
 dom.window.WebSocket=MockWebSocket;

 const calls=[];
 const origRequest=api.request;
 api.request=async (path,options={})=>{
  const method=(options.method||'GET').toUpperCase();
  const body=options.body??null;
  calls.push({url:path,method,body});
  const res=await fetchHandler(path,method,body);
  if(res.status>=400)throw Object.assign(new Error(res.body?.error||'error'),{status:res.status,code:res.body?.error});
  return res.body;
 };

 const ac=new AbortController();
 ac.signal.addEventListener('abort',()=>{queueMicrotask(()=>{api.request=origRequest;});},{once:true});
 const navigated=[];
 const root=dom.window.document.querySelector('#root');
 const ctx={
  root,
  signal:ac.signal,
  dict:en,
  locale:'en',
  user:{id:'99999999-9999-4999-8999-999999999999',role:'student',name:'Ali Student'},
  url:new URL('https://learnersarea.uz/app/live-classes'),
  navigate:(to)=>navigated.push(to),
 };
 return {dom,root,ctx,ac,calls,wsInstances,navigated};
}

test('YouTube contract: extracts valid 11-char IDs, rejects stream keys/non-YouTube URLs, and builds compliant embed URLs',()=>{
 assert.equal(extractYoutubeId('dQw4w9WgXcQ'),'dQw4w9WgXcQ');
 assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ');
 assert.equal(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=30'),'dQw4w9WgXcQ');
 assert.equal(extractYoutubeId('https://www.youtube.com/live/M7lc1UVf-VE?feature=share'),'M7lc1UVf-VE');
 assert.equal(extractYoutubeId('https://www.youtube.com/embed/M7lc1UVf-VE'),'M7lc1UVf-VE');
 assert.equal(extractYoutubeId('https://studio.youtube.com/video/M7lc1UVf-VE/livestreaming'),'M7lc1UVf-VE');

 // Reject OBS stream keys and non-YouTube URLs
 assert.equal(extractYoutubeId('abcd-1234-efgh-5678-ijkl'),null);
 assert.equal(extractYoutubeId('https://vimeo.com/123456789'),null);
 assert.equal(extractYoutubeId('javascript:alert(1)'),null);

 // Verify official YouTube IFrame Player parameters and absence of deprecated/forbidden parameters
 const liveUrl=liveEmbedUrl('dQw4w9WgXcQ',{origin:'https://learnersarea.uz',controls:0});
 assert.ok(liveUrl.startsWith('https://www.youtube.com/embed/dQw4w9WgXcQ?'));
 assert.ok(liveUrl.includes('enablejsapi=1'));
 assert.ok(liveUrl.includes('playsinline=1'));
 assert.ok(liveUrl.includes('rel=0'));
 assert.ok(liveUrl.includes('controls=0'));
 assert.ok(liveUrl.includes(encodeURIComponent('https://learnersarea.uz')));
 assert.ok(!liveUrl.includes('modestbranding'));
 assert.ok(!liveUrl.includes('showinfo'));
 assert.ok(!liveUrl.includes('autoplay=1'));
});

test('Bilingual i18n parity: English and Uzbek liveClasses dictionaries have identical keys',()=>{
 const enKeys=Object.keys(en.liveClasses).sort();
 const uzKeys=Object.keys(uz.liveClasses).sort();
 assert.deepEqual(enKeys,uzKeys);
});

test('Live Classes Hub: renders Live Now, Upcoming Classes, and Previous Classes sections with zero Share/YouTube-redirect buttons',async()=>{
 const liveLesson={
  id:CLASS_LIVE_ID,
  title:'Live IELTS Task 2 Workshop',
  topic:'Coherence & Cohesion',
  description:'Coherence & Cohesion',
  teacherUserId:TEACHER_ID,
  scheduledAt:'2026-10-30T14:00:00Z',
  durationMinutes:120,
  status:'live',
  recordingStatus:'none',
  lifecycleStatus:'live',
  youtubeVideoId:'dQw4w9WgXcQ',
  hasYoutubeVideo:true,
  thumbnailUrl:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  meetingUrl:null,
  recordingUrl:null,
 };
 const upcomingLesson={
  id:CLASS_UPCOMING_ID,
  title:'Upcoming Speaking Part 2 Clinic',
  topic:'Cue card strategies',
  description:'Cue card strategies',
  teacherUserId:TEACHER_ID,
  scheduledAt:'2026-11-02T15:00:00Z',
  durationMinutes:90,
  status:'upcoming',
  recordingStatus:'none',
  lifecycleStatus:'scheduled',
  youtubeVideoId:null,
  hasYoutubeVideo:true,
  thumbnailUrl:'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg',
  meetingUrl:null,
  recordingUrl:null,
 };
 const recordedLesson={
  id:CLASS_RECORDED_ID,
  title:'Completed Reading Masterclass',
  topic:'True / False / Not Given',
  description:'True / False / Not Given',
  teacherUserId:TEACHER_ID,
  scheduledAt:'2026-10-20T14:00:00Z',
  durationMinutes:120,
  recordingDurationSeconds:5400,
  status:'recorded',
  recordingStatus:'ready',
  lifecycleStatus:'recording_ready',
  youtubeVideoId:'M7lc1UVf-VE',
  hasYoutubeVideo:true,
  thumbnailUrl:'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg',
  meetingUrl:null,
  recordingUrl:null,
 };

 const h=setupDom(async(url)=>{
  if(url.includes('/api/frontend/view?route=%2Fapp%2Flive-classes')){
   return {
    status:200,
    body:{
     version:1,
     route:'/app/live-classes',
     data:{
      courseAvailable:true,
      liveNow:[liveLesson],
      upcoming:[liveLesson,upcomingLesson],
      past:[recordedLesson],
      previousRecordings:[recordedLesson],
      attendance:[],
      teachers:[{id:TEACHER_ID,name:'Ms. Madina'}],
      materials:{},
     },
    },
   };
  }
  return {status:404,body:{error:'not_found'}};
 });

 await mountHub(h.ctx);
 await new Promise((r)=>setTimeout(r,20));

 const liveSection=h.root.querySelector('[data-live-now-section]');
 const upcomingSection=h.root.querySelector('[data-upcoming-classes-section]');
 const previousSection=h.root.querySelector('[data-previous-classes-section]');

 assert.ok(liveSection,'Live Now section rendered');
 assert.ok(upcomingSection,'Upcoming Classes section rendered');
 assert.ok(previousSection,'Previous Classes section rendered');

 assert.ok(liveSection.textContent.includes('Live IELTS Task 2 Workshop'));
 assert.ok(liveSection.textContent.includes('Ms. Madina'));
 assert.ok(upcomingSection.textContent.includes('Upcoming Speaking Part 2 Clinic'));
 assert.ok(previousSection.textContent.includes('Completed Reading Masterclass'));
 assert.ok(previousSection.textContent.includes('90 min'));

 const watchLink=previousSection.querySelector(`[data-watch-recording="${CLASS_RECORDED_ID}"]`);
 assert.ok(watchLink,'Watch Recording button exists');
 assert.equal(watchLink.getAttribute('href'),`/app/live-classes/${CLASS_RECORDED_ID}`);

 const fullHtml=h.root.innerHTML.toLowerCase();
 assert.ok(!fullHtml.includes('copy youtube'));
 assert.ok(!fullHtml.includes('open youtube'));
 h.ac.abort();
});

test('Viewing Room: unstarted Scheduled lesson displays waiting state and never renders a fake live stream',async()=>{
 const route=`/app/live-classes/${CLASS_UPCOMING_ID}`;
 const h=setupDom(async(url)=>{
  if(url.includes(encodeURIComponent(route))){
   return {
    status:200,
    body:{
     version:1,
     route,
     data:{
      ok:true,
      liveClass:{
       id:CLASS_UPCOMING_ID,
       title:'Upcoming Speaking Part 2 Clinic',
       description:'Cue card strategies',
       status:'upcoming',
       lifecycleStatus:'scheduled',
       recordingStatus:'none',
       scheduledAt:'2026-11-02T15:00:00Z',
       durationMinutes:90,
       teacherUserId:TEACHER_ID,
       teacherName:'Ms. Madina',
       youtubeVideoId:null,
       hasYoutubeVideo:true,
       joinState:'too_early',
       opensAt:'2026-11-02T14:45:00Z',
       chatEnabled:false,
       chatReadOnly:true,
      },
      attendance:{joined:false,joinedAt:null},
      chat:{messages:[],hasMore:false,nextBefore:null},
      materials:[],
      canModerate:false,
      embedOrigin:'https://learnersarea.uz',
     },
    },
   };
  }
  return {status:200,body:{ok:true}};
 });

 await mountRoom(h.ctx,CLASS_UPCOMING_ID);
 await new Promise((r)=>setTimeout(r,20));

 assert.ok(h.root.querySelector('[data-live-waiting-state]'),'Waiting state banner is shown');
 assert.equal(h.root.querySelector('iframe[data-live-youtube-iframe]'),null,'No fake live stream iframe is rendered');
 h.ac.abort();
});

test('Viewing Room: active Live class embeds compliant YouTube player, supports real-time chat + moderation, and cleans up on route leave',async()=>{
 const route=`/app/live-classes/${CLASS_LIVE_ID}`;
 const h=setupDom(async(url,method,body)=>{
  if(url.includes(encodeURIComponent(route))&&method==='GET'){
   return {
    status:200,
    body:{
     version:1,
     route,
     data:{
      ok:true,
      liveClass:{
       id:CLASS_LIVE_ID,
       title:'Live IELTS Task 2 Workshop',
       description:'Coherence & Cohesion',
       status:'live',
       lifecycleStatus:'live',
       recordingStatus:'none',
       scheduledAt:'2026-10-30T14:00:00Z',
       durationMinutes:120,
       teacherUserId:TEACHER_ID,
       teacherName:'Ms. Madina',
       youtubeVideoId:'dQw4w9WgXcQ',
       hasYoutubeVideo:true,
       joinState:'open',
       opensAt:'2026-10-30T13:45:00Z',
       chatEnabled:true,
       chatReadOnly:false,
      },
      attendance:{joined:true,joinedAt:'2026-10-30T14:01:00Z',estimatedDurationSeconds:60},
      chat:{
       messages:[
        {
         id:MSG_1_ID,
         classId:CLASS_LIVE_ID,
         senderId:TEACHER_ID,
         senderName:'Ms. Madina',
         senderRole:'teacher',
         body:'Welcome everyone! <script>alert(1)</script>',
         createdAt:'2026-10-30T14:01:00Z',
        },
       ],
       hasMore:false,
       nextBefore:null,
      },
      materials:[],
      canModerate:true,
      embedOrigin:'https://learnersarea.uz',
     },
    },
   };
  }
  if(url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/join`)&&method==='POST'){
   return {status:200,body:{ok:true,joined:true}};
  }
  if(url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/attendance`)&&method==='POST'){
   return {status:200,body:{ok:true,joined:true,estimatedDurationSeconds:90}};
  }
  if(url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/chat`)&&method==='POST'){
   return {
    status:200,
    body:{
     ok:true,
     message:{
      id:MSG_2_ID,
      classId:CLASS_LIVE_ID,
      senderId:'99999999-9999-4999-8999-999999999999',
      senderName:'Ali Student',
      senderRole:'student',
      body:body.body,
      createdAt:'2026-10-30T14:02:00Z',
     },
    },
   };
  }
  if(url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/chat/${MSG_1_ID}`)&&method==='DELETE'){
   return {status:200,body:{ok:true,deletedId:MSG_1_ID}};
  }
  return {status:200,body:{ok:true}};
 });

 await mountRoom(h.ctx,CLASS_LIVE_ID);
 await new Promise((r)=>setTimeout(r,20));

 const grid=h.root.querySelector('[data-live-room-grid]');
 assert.ok(grid,'Room grid exists');
 const iframe=h.root.querySelector('iframe[data-live-youtube-iframe="dQw4w9WgXcQ"]');
 assert.ok(iframe,'YouTube player iframe rendered');
 const src=iframe.getAttribute('src');
 assert.ok(src.includes('enablejsapi=1'));
 assert.ok(src.includes('playsinline=1'));
 assert.ok(!src.includes('modestbranding'));

 const msgNode1=h.root.querySelector(`[data-chat-message="${MSG_1_ID}"]`);
 assert.ok(msgNode1,'Initial chat message rendered');
 assert.equal(msgNode1.querySelectorAll('script').length,0,'XSS script tag was not injected into DOM');
 assert.ok(msgNode1.textContent.includes('<script>alert(1)</script>'));

 const input=h.root.querySelector('[data-live-chat-input]');
 const form=h.root.querySelector('[data-live-chat-form]');
 input.value='Can we use first-person pronouns in Task 2?';
 form.dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await new Promise((r)=>setTimeout(r,20));

 const msgNode2=h.root.querySelector(`[data-chat-message="${MSG_2_ID}"]`);
 assert.ok(msgNode2,'Newly posted chat message rendered in list');
 assert.ok(msgNode2.textContent.includes('Can we use first-person pronouns in Task 2?'));

 assert.equal(h.wsInstances.length,1,'One WebSocket connection opened for the class');
 const ws=h.wsInstances[0];
 ws.emitMessage({
  type:'message',
  message:{
   id:'33333333-3333-4333-8333-333333333309',
   classId:CLASS_LIVE_ID,
   senderId:TEACHER_ID,
   senderName:'Ms. Madina',
   senderRole:'teacher',
   body:'Yes, in your opinion sentence!',
   createdAt:'2026-10-30T14:03:00Z',
  },
 });
 assert.ok(h.root.querySelector('[data-chat-message="33333333-3333-4333-8333-333333333309"]'),'WebSocket message rendered immediately');

 ws.emitMessage({
  type:'message_deleted',
  classId:CLASS_LIVE_ID,
  messageId:MSG_2_ID,
 });
 assert.equal(h.root.querySelector(`[data-chat-message="${MSG_2_ID}"]`),null,'Deleted message removed from DOM on WebSocket event');

 h.ac.abort();
 assert.equal(ws.closed,true,'WebSocket closed on route leave');
 assert.equal(iframe.getAttribute('src'),null,'YouTube iframe src removed on route leave');
 assert.equal(h.root.querySelector('iframe[data-live-youtube-iframe]'),null,'YouTube iframe removed from DOM on route leave');
});

test('Fix 4: class status refresh and route re-entry never duplicate WebSockets, attendance joins, or players',async()=>{
 const route=`/app/live-classes/${CLASS_LIVE_ID}`;
 let currentStatus='upcoming';
 let currentLifecycle='scheduled';
 let currentVideoId=null;
 const h=setupDom(async(url,method)=>{
  if(url.includes(encodeURIComponent(route))&&method==='GET'){
   return {
    status:200,
    body:{
     version:1,
     route,
     data:{
      ok:true,
      liveClass:{
       id:CLASS_LIVE_ID,
       title:'Live Lifecycle Room',
       description:'Testing single-resource lifecycle',
       status:currentStatus,
       lifecycleStatus:currentLifecycle,
       recordingStatus:'none',
       scheduledAt:'2026-10-30T14:00:00Z',
       durationMinutes:120,
       teacherUserId:TEACHER_ID,
       teacherName:'Ms. Madina',
       youtubeVideoId:currentVideoId,
       hasYoutubeVideo:true,
       joinState:'open',
       opensAt:'2026-10-30T13:45:00Z',
       chatEnabled:true,
       chatReadOnly:currentStatus!=='live',
      },
      attendance:{joined:false,joinedAt:null},
      chat:{messages:[],hasMore:false,nextBefore:null},
      materials:[],
      canModerate:false,
      embedOrigin:'https://learnersarea.uz',
     },
    },
   };
  }
  return {status:200,body:{ok:true,joined:true}};
 });

 await mountRoom(h.ctx,CLASS_LIVE_ID);
 await new Promise((r)=>setTimeout(r,25));

 assert.equal(h.wsInstances.length,1,'Initial room load opens exactly 1 WebSocket');
 const ws1=h.wsInstances[0];
 assert.equal(ws1.closed,false);
 const joinCallsBefore=h.calls.filter(c=>c.url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/join`)).length;
 assert.equal(joinCallsBefore,1,'Initial room load sends 1 join request');

 currentStatus='live';
 currentLifecycle='live';
 currentVideoId='dQw4w9WgXcQ';
 ws1.emitMessage({type:'class_status',classId:CLASS_LIVE_ID,status:'live',chatReadOnly:false});
 await new Promise((r)=>setTimeout(r,35));

 assert.equal(ws1.closed,true,'Previous WebSocket was closed before replacement');
 assert.equal(h.wsInstances.length,2,'Replacement WebSocket created');
 const openSockets=h.wsInstances.filter(w=>!w.closed);
 assert.equal(openSockets.length,1,'Only 1 active WebSocket remains open');
 const joinCallsAfter=h.calls.filter(c=>c.url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/join`)).length;
 assert.equal(joinCallsAfter,1,'Refreshing class state inside the same room does not duplicate join requests');
 assert.equal(h.root.querySelectorAll('iframe[data-live-youtube-iframe]').length,1,'Exactly 1 player instance exists');

 const ws2=openSockets[0];
 ws1.emitMessage({type:'message',message:{id:MSG_1_ID,classId:CLASS_LIVE_ID,senderId:TEACHER_ID,senderName:'Ms. Madina',senderRole:'teacher',body:'From old socket',createdAt:'2026-10-30T14:05:00Z'}});
 assert.equal(h.root.querySelector(`[data-chat-message="${MSG_1_ID}"]`),null,'Disposed socket messages are ignored');

 ws2.emitMessage({type:'message',message:{id:MSG_2_ID,classId:CLASS_LIVE_ID,senderId:TEACHER_ID,senderName:'Ms. Madina',senderRole:'teacher',body:'From active socket',createdAt:'2026-10-30T14:06:00Z'}});
 assert.equal(h.root.querySelectorAll(`[data-chat-message="${MSG_2_ID}"]`).length,1,'Message rendered once without duplication');

 h.ac.abort();
 await new Promise((r)=>setTimeout(r,15));
 assert.equal(h.wsInstances.filter(w=>!w.closed).length,0,'Zero open WebSockets after route leave');
 const leaveCalls=h.calls.filter(c=>c.url.endsWith(`/api/live-classes/${CLASS_LIVE_ID}/attendance`)&&c.body?.action==='leave').length;
 assert.equal(leaveCalls,1,'Exactly 1 leave attendance event sent on route leave');
});

test('Chat microsecond ordering: messages within the same millisecond follow PostgreSQL timestamp, not UUID order',async()=>{
 const route=`/app/live-classes/${CLASS_LIVE_ID}`;
 const messages=[
  {id:'33333333-3333-4333-8333-333333333303',body:'First',createdAt:'2026-10-30T14:00:00.000101Z'},
  {id:'33333333-3333-4333-8333-333333333302',body:'Second',createdAt:'2026-10-30T14:00:00.000202Z'},
  {id:'33333333-3333-4333-8333-333333333301',body:'Third',createdAt:'2026-10-30T14:00:00.000303Z'},
 ].map(m=>({
  ...m,classId:CLASS_LIVE_ID,senderId:TEACHER_ID,senderName:'Ms. Madina',senderRole:'teacher',
 }));
 assert.equal(Date.parse(messages[0].createdAt),Date.parse(messages[2].createdAt));
 const h=setupDom(async(url,method)=>{
  if(method==='GET'&&url.includes(encodeURIComponent(route)))return {
   status:200,
   body:{version:1,route,data:{
    ok:true,
    liveClass:{
     id:CLASS_LIVE_ID,title:'Precise message order',status:'live',lifecycleStatus:'live',
     recordingStatus:'none',scheduledAt:'2026-10-30T14:00:00Z',durationMinutes:120,
     teacherUserId:TEACHER_ID,teacherName:'Ms. Madina',youtubeVideoId:null,
     joinState:'open',opensAt:'2026-10-30T13:45:00Z',chatEnabled:true,chatReadOnly:false,
    },
    attendance:{joined:true,joinedAt:'2026-10-30T14:00:00Z'},
    chat:{messages:[...messages].reverse(),hasMore:false,nextBefore:null},
    materials:[],canModerate:false,embedOrigin:'https://learnersarea.uz',
   }},
  };
  return {status:200,body:{ok:true,joined:true}};
 });
 await mountRoom(h.ctx,CLASS_LIVE_ID);
 try{
  // mountRoom starts its asynchronous view load without awaiting it.
  // Wait for the actual DOM state, not an arbitrary fixed sleep.
  for(let n=0;n<100 && h.root.querySelectorAll('[data-chat-message]').length<messages.length;n++){
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  const order=[...h.root.querySelectorAll('[data-chat-message]')].map(el=>el.getAttribute('data-chat-message'));
  assert.deepEqual(order,messages.map(m=>m.id),'Messages keep full microsecond ordering, even when UUIDs are reversed');
 }finally{
  // Ensure a failed assertion cannot leak WebSockets or attendance timers.
  h.ac.abort();
  h.dom.window.close();
 }
});

test('Task 5: reconnection / sync_required recovers 120 missed messages across 3 pages (50 + 50 + 20) in chronological order without duplicates',async()=>{
 const route=`/app/live-classes/${CLASS_LIVE_ID}`;
 const baseMs=Date.parse('2026-10-30T14:00:00.000Z');
 const initMsg={
  id:'00000000-0000-4000-8000-000000000000',
  classId:CLASS_LIVE_ID,
  senderId:TEACHER_ID,
  senderName:'Ms. Madina',
  senderRole:'teacher',
  body:'Initial message #0',
  createdAt:new Date(baseMs).toISOString(),
 };

 // Generate 120 missed messages (including several sharing the exact same millisecond timestamp to verify tie-breaker ordering)
 const missed=[];
 for(let i=1;i<=120;i++){
  const offsetMs=i>=48&&i<=53?50000:i*1000;
  const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  missed.push({
   id,
   classId:CLASS_LIVE_ID,
   senderId:TEACHER_ID,
   senderName:'Ms. Madina',
   senderRole:'teacher',
   body:`Missed message #${i}`,
   createdAt:new Date(baseMs+offsetMs).toISOString(),
  });
 }

 const pageRequests=[];
 const h=setupDom(async(url,method)=>{
  if(url.includes(encodeURIComponent(route))&&method==='GET'){
   return {
    status:200,
    body:{
     version:1,
     route,
     data:{
      ok:true,
      liveClass:{
       id:CLASS_LIVE_ID,
       title:'Pagination Room',
       description:'Testing 120-message multi-page catch-up',
       status:'live',
       lifecycleStatus:'live',
       recordingStatus:'none',
       scheduledAt:'2026-10-30T14:00:00Z',
       durationMinutes:120,
       teacherUserId:TEACHER_ID,
       teacherName:'Ms. Madina',
       youtubeVideoId:'dQw4w9WgXcQ',
       hasYoutubeVideo:true,
       joinState:'open',
       opensAt:'2026-10-30T13:45:00Z',
       chatEnabled:true,
       chatReadOnly:false,
      },
      attendance:{joined:true,joinedAt:'2026-10-30T14:00:00Z',estimatedDurationSeconds:10},
      chat:{messages:[initMsg],hasMore:false,nextBefore:null},
      materials:[],
      canModerate:false,
      embedOrigin:'https://learnersarea.uz',
     },
    },
   };
  }
  if(url.startsWith(`/api/live-classes/${CLASS_LIVE_ID}/chat?`)&&method==='GET'){
   const u=new URL(`https://learnersarea.uz${url}`);
   const afterRaw=u.searchParams.get('after')||'';
   const limit=Number(u.searchParams.get('limit')||50);
   const [afterTs,afterId]=afterRaw.split('|');
   const afterMs=Date.parse(afterTs);
   const matching=missed.filter(m=>{
    const mMs=Date.parse(m.createdAt);
    if(mMs>afterMs)return true;
    if(mMs===afterMs&&afterId)return m.id>afterId;
    return false;
   });
   const page=matching.slice(0,limit);
   const hasMore=matching.length>limit;
   const last=page[page.length-1];
   const nextAfter=last?`${last.createdAt}|${last.id}`:afterRaw;
   pageRequests.push({afterRaw,returnedCount:page.length,hasMore});
   return {
    status:200,
    body:{
     ok:true,
     chatReadOnly:false,
     messages:page,
     hasMore,
     nextAfter,
     nextCursor:hasMore?nextAfter:null,
     nextBefore:null,
    },
   };
  }
  return {status:200,body:{ok:true,joined:true}};
 });

 await mountRoom(h.ctx,CLASS_LIVE_ID);
 await new Promise((r)=>setTimeout(r,25));

 const ws=h.wsInstances[0];
 // Trigger overlapping sync_required events to verify concurrency guard + 3-page loop (50 + 50 + 20)
 ws.emitMessage({type:'sync_required',classId:CLASS_LIVE_ID});
 ws.emitMessage({type:'sync_required',classId:CLASS_LIVE_ID});
 await new Promise((r)=>setTimeout(r,50));

 assert.ok(pageRequests.length>=3,'Fetched at least 3 pages');
 assert.equal(pageRequests[0].returnedCount,50,'Page 1 returned 50 messages');
 assert.equal(pageRequests[0].hasMore,true,'Page 1 reported hasMore: true');
 assert.equal(pageRequests[1].returnedCount,50,'Page 2 returned 50 messages');
 assert.equal(pageRequests[1].hasMore,true,'Page 2 reported hasMore: true');
 assert.equal(pageRequests[2].returnedCount,20,'Page 3 returned 20 messages');
 assert.equal(pageRequests[2].hasMore,false,'Page 3 reported hasMore: false');

 const renderedNodes=[...h.root.querySelectorAll('[data-chat-message]')];
 assert.equal(renderedNodes.length,121,'All 121 messages (1 initial + 120 missed) rendered with zero duplicates');
 assert.equal(renderedNodes[0].getAttribute('data-chat-message'),initMsg.id);
 for(let i=1;i<=120;i++){
  const expectedId=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  assert.equal(renderedNodes[i].getAttribute('data-chat-message'),expectedId,`Message #${i} is in exact chronological order`);
 }
 h.ac.abort();
});

test('Previous Classes paginates beyond 40: 45 accessible recordings load 20 + 20 + 5 without duplicates',async()=>{
 const teacherId=TEACHER_ID;
 const makeRecording=i=>({
  id:`44444444-4444-4444-8444-${String(i).padStart(12,'0')}`,
  title:`Archived lesson ${i}`,
  topic:'IELTS',description:'Recorded lesson',
  status:'recorded',recordingStatus:'ready',lifecycleStatus:'recording_ready',
  teacherUserId:teacherId,scheduledAt:new Date(Date.UTC(2026,9,30)-i*60000).toISOString(),
  durationMinutes:120,recordingDurationSeconds:7200,
  youtubeVideoId:'dQw4w9WgXcQ',meetingUrl:null,recordingUrl:null,
 });
 const all=Array.from({length:45},(_,i)=>makeRecording(i+1));
 let archivePageCalls=0;
 const h=setupDom(async url=>{
  if(url.includes('/api/frontend/view?route=%2Fapp%2Flive-classes')){
   return {status:200,body:{version:1,route:'/app/live-classes',data:{courseAvailable:true,upcoming:[],past:all.slice(0,20),
    attendance:[],teachers:[{id:teacherId,name:'Teacher'}],materials:{},
    pastPagination:{hasMore:true,nextCursor:'first-cursor'}}}};
  }
  if(url.startsWith('/api/live-classes/recordings?before=')){
   archivePageCalls++;
   const start=archivePageCalls===1?20:40;
   return {status:200,body:{ok:true,past:all.slice(start,start+20),
    attendance:[],teachers:[{id:teacherId,name:'Teacher'}],materials:{},
    pastPagination:{hasMore:archivePageCalls<2,nextCursor:archivePageCalls<2?'second-cursor':null}}};
  }
  return {status:404,body:{error:'not_found'}};
 });
 await mountHub(h.ctx);
 const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
 await tick();
 const count=()=>h.root.querySelectorAll('[data-recording-card]').length;
 const button=()=>h.root.querySelector('[data-load-more-recordings]');
 assert.equal(count(),20);
 assert.ok(button());
 button().click();await tick();
 assert.equal(count(),40);
 assert.ok(button());
 button().click();await tick();
 assert.equal(count(),45);
 assert.equal(archivePageCalls,2);
 assert.equal(button(),null);
 const unique=new Set([...h.root.querySelectorAll('[data-recording-card]')].map(x=>x.getAttribute('data-recording-card')));
 assert.equal(unique.size,45);
 assert.ok(h.root.querySelector('[data-watch-recording]'));
 h.ac.abort();
});
