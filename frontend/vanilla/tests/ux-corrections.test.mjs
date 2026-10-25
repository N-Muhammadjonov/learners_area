import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick,ID,api} from './staff-final30/harness.mjs';
import {ApiError} from '../js/api-client.js';
import {mountRetention} from '../modules/reading/retention.js';
import {readingDictionary} from '../modules/reading/dictionary.js';
import {contextualWordPopover} from '../modules/vocabulary/contextual-popover.js';
import {tokenise} from '../js/generated/lexical-text-helpers.js';
import {programDTO} from '../modules/listening/mcq-index.js';
import {render as mcqCards} from '../js/generated/views/listening-mcq.js';
import {mount as people} from '../modules/staff-final30/people.js';
import {watchPresence} from '../js/presence.js';
import {authShell} from '../js/components/auth-shell.js';
import {mount as welcome} from '../modules/landing.js';
const originalFetch=globalThis.fetch;
function globals(h){for(const key of ['Element','MutationObserver','DOMParser','localStorage','sessionStorage'])globalThis[key]=h.dom.window[key];globalThis.innerHeight=900;globalThis.location=h.dom.window.location;}
const meta=()=>({attemptId:ID(8),level:'A2',label:'Synthetic',readStartedAt:new Date().toISOString(),readEndsAt:new Date(Date.now()+120000).toISOString(),writeStartedAt:new Date().toISOString(),writeEndsAt:new Date(Date.now()+300000).toISOString(),serverNow:new Date().toISOString()});
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});

test('welcome has the same immediate CTA and horizontal landscape at desktop sizes; login shares the image',async()=>{
 const h=setup({path:'/'});globals(h);h.dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});globalThis.matchMedia=h.dom.window.matchMedia;
 h.stub({'/api/auth/state':new ApiError(401,'unauthenticated')});
 try{await welcome(h.ctx);await tick();assert.equal(h.qa('video').length,0);assert.equal(h.q('.la-landscape img').getAttribute('src'),'/brand/welcome-landscape.jpg');assert.equal(h.q('[data-landing-cta]').getAttribute('href'),'/login');const auth=authShell(h.ctx,{title:'Login',children:document.createElement('div')});assert.equal(auth.querySelector('.la-landscape img').getAttribute('src'),'/brand/welcome-landscape.jpg');assert.equal(h.nav.length,0);}finally{globalThis.fetch=originalFetch;h.dispose();}
});

test('MCQ accepts and renders all days with learner locks after the old 24-card boundary',()=>{
 const h=setup({role:'student'});try{const days=Array.from({length:75},(_,i)=>({day:i+1,testId:ID(i+10),title:'Day '+(i+1),draft:false,questionCount:5,locked:i>0,status:{state:'not_started',total:5,completed:0}}));const data=programDTO({days,page:1,pageSize:75,hasNextPage:false,visibleDays:75,progress:{daysPublished:75,daysCompleted:0,questionsPublished:375,questionsCompleted:0}});h.ctx.root.append(mcqCards({...data,context:h.ctx,dict:h.ctx.dict,user:h.ctx.session.user}));assert.equal(h.qa('[data-listening-mcq-card]').length,75);assert.equal(h.qa('[data-listening-mcq-locked]').length,74);assert.equal(h.qa('[data-listening-mcq-open]').length,1);}finally{h.dispose();}
});

test('Retention changes into focus on start and stays focused for recall, blocks source copying and restores normal mode on exit',async()=>{
 const h=setup({path:'/app/reading/retention',role:'student'});globals(h);h.ctx.dict=await readingDictionary(h.ctx);h.dom.window.confirm=()=>true;
 const now=meta(),reading={...now,phase:'reading',bodyText:'I read a book.',wordCount:4,occurrences:[]},recall={...now,phase:'recall',recallDraft:''};
 globalThis.fetch=async()=>response({version:1,route:'/app/reading/retention',data:{initial:null,summary:{bestScore:null,completedCount:0,lastTenAverage:null,lastTenCount:0},history:{rows:[],page:1,pageCount:1,total:0}}});
 h.stub({'/api/frontend/view':{version:1,route:'/app/reading/retention',data:{initial:null,summary:{bestScore:null,completedCount:0,lastTenAverage:null,lastTenCount:0},history:{rows:[],page:1,pageCount:1,total:0}}},'/api/retention/attempts':reading,[`/api/retention/attempts/${ID(8)}/finish-reading`]:recall,'/api/vocabulary/folders':{folders:[]}});
 try{mountRetention(h.ctx);await tick(5);assert(!h.ctx.root.textContent.includes('Retention memory'));h.click(h.q('[data-retention-start]'));await tick(5);assert.equal(document.documentElement.dataset.retentionFocus,'on');assert(h.q('[data-retention-source]'));assert.equal(h.qa('[data-retention-source] [data-word]').length,4);const copy=new h.dom.window.Event('copy',{bubbles:true,cancelable:true});h.q('[data-retention-source]').dispatchEvent(copy);assert(copy.defaultPrevented);h.click(h.q('[data-retention-finish-reading]'));await tick(5);assert(h.q('[data-retention-answer]'));assert.equal(h.q('[data-retention-source]'),null);assert.equal(document.documentElement.dataset.retentionFocus,'on');const editCopy=new h.dom.window.Event('copy',{bubbles:true,cancelable:true});h.q('[data-retention-answer]').dispatchEvent(editCopy);assert.equal(editCopy.defaultPrevented,false);h.controller.abort();assert.equal(document.documentElement.dataset.retentionFocus,undefined);}finally{globalThis.fetch=originalFetch;h.dispose();}
});

test('unbound Retention word passes its exact offsets and saves the selected canonical dictionary sense',async()=>{
 const h=setup({path:'/app/reading/retention',role:'student'});globals(h);const anchor=document.createElement('span');anchor.textContent='book';h.ctx.root.append(anchor);
 const dictionary={lexemeId:ID(50),senseId:ID(51),releaseId:'rel-v1-123456789012345678901234'};
 h.stub({'/api/vocabulary/meaning':{status:'resolved',contextual:{definitionEn:'A set of written pages.',translationUz:'kitob',dictionary}},'/api/vocabulary/folders':{folders:[]},'/api/dictionary/save':{ok:true}});
 const pop=contextualWordPopover(h.ctx,{word:'book',anchor,sourceType:'retention',sourceId:ID(8),startChar:9,endChar:13});
 try{await tick(5);assert(h.calls[0].path.includes('startChar=9&endChar=13'));assert(document.body.textContent.includes('A set of written pages.'));document.body.querySelector('[data-word-save]').click();await tick(5);const saved=h.calls.find(c=>c.path==='/api/dictionary/save');assert.deepEqual(saved.body,{...dictionary,folderId:null});assert(!h.calls.some(c=>c.path==='/api/vocabulary'));}finally{pop.stop();h.dispose();}
});

test('every English token includes one-letter words',()=>{assert.deepEqual(tokenise('I have a book.').filter(t=>t.isWord).map(t=>t.clean),['I','have','a','book']);});

test('People shows online status, last activity, current visit and total time while a person is online',async()=>{
 const h=setup({path:'/app/admin/people',role:'owner'});const d=new Date().toISOString();h.stub({'/api/frontend/staff/people':{version:1,kind:'people',data:{people:[{id:ID(2),name:'Synthetic learner',email:null,role:'student',accountStatus:'active',statusReason:null,createdAt:d,lastActiveAt:d,telegramLinked:true,online:true,seenAt:d,visitSeconds:65,totalSeconds:3665}],filters:{q:'',role:null,status:null,online:false},page:1,pageSize:25,total:1,totalPages:1,onlineCount:1,actorId:ID(1),actorRole:'owner',grantableRoles:['student']}}});
 try{await people(h.ctx);const node=h.q('[data-person-presence]');assert(node.textContent.includes('Online'));assert(node.textContent.includes('Last activity'));assert(node.textContent.includes('Current visit'));assert(node.textContent.includes('1h 1m 5s'));assert(h.q('[data-people-online]').textContent.includes('1'));}finally{globalThis.fetch=originalFetch;h.dispose();}
});

test('signed-in active workspace emits a presence heartbeat and pending accounts do not',async()=>{
 const h=setup({role:'student'});let beats=0;globalThis.fetch=async path=>{assert.equal(path,'/api/presence');beats++;return new Response(null,{status:204});};
 try{watchPresence(h.ctx);await tick();assert.equal(beats,1);watchPresence({...h.ctx,session:{user:{accountStatus:'pending'}}});await tick();assert.equal(beats,1);}finally{globalThis.fetch=originalFetch;h.dispose();}
});

test('shared CSS keeps game returns visible, removes the nested dictionary input border and allows content wrapping',()=>{
 const h=setup({path:'/app/vocabulary/games/mcq'});try{const style=document.createElement('style');style.textContent=readFileSync(new URL('../css/campus.css',import.meta.url),'utf8');document.head.append(style);h.ctx.root.innerHTML='<div data-campus-shell><div data-shell-main><a class="btn-ghost" data-game-back>Back to games</a><div data-global-dictionary><input data-dictionary-search></div></div></div>';assert.notEqual(window.getComputedStyle(h.q('[data-game-back]')).display,'none');assert.equal(window.getComputedStyle(h.q('[data-dictionary-search]')).borderTopWidth,'0px');assert.equal(window.getComputedStyle(h.q('[data-game-back]')).whiteSpace,'normal');}finally{h.dispose();}
});
