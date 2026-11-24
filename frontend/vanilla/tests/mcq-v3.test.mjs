/** Synthetic MCQ state fixtures, never answer keys/curriculum or live grading. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {mcqPayload,mcqDay,canAdvance} from '../js/adapters/mcq.js';import {mcqMastery} from '../modules/listening/mcq.js';import {api} from '../js/api-client.js';import dict from '../js/i18n/en.js';import {viewFixture} from './fixtures.mjs';
import {render as renderDay} from '../js/generated/ListeningMcqDayPage.js';
const request=api.request;let dom,controller;afterEach(()=>{controller?.abort();api.request=request;dom?.window.close();});const tick=()=>new Promise(r=>setTimeout(r,0));
const options=['A. Synthetic','B. Synthetic','C. Synthetic','D. Synthetic','E. Synthetic'];
const p=(stage='revealed')=>({session:{id:'synthetic-session',stage},question:{id:'synthetic-question'},options:stage==='listen'?null:options,multiple:true,correctAnswer:null,explanation:null,outcome:null,next:{to:'chosen',field:'chosenAnswer',minLength:1}});
function setup(){dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/app/listening/mcq',pretendToBeVisual:true});for(const k of ['window','document','Node'])globalThis[k]=dom.window[k];controller=new dom.window.AbortController();return {dict,signal:controller.signal,navigate:()=>{}};}
function host(ctx,qs=[{id:'synthetic-question',order:1,questionText:'Synthetic fixture',stage:'listen'}]){const n=mcqMastery(ctx,{questions:qs});document.body.append(n);return n;}
test('server outcomes/choices accepted without client grading; exact question/session binding enforced',()=>{assert.equal(mcqPayload(p(),'synthetic-question').session.id,'synthetic-session');assert.throws(()=>mcqPayload(p(),'other-question'));assert.throws(()=>mcqPayload(p(),'synthetic-question','other-session'));});
test('pre-reveal options and pre-choice grading/explanations are refused rather than displayed',()=>{assert.throws(()=>mcqPayload({...p('listen'),options},'synthetic-question'));assert.throws(()=>mcqPayload({...p(),outcome:'correct'},'synthetic-question'));assert.throws(()=>mcqPayload({...p(),explanation:'Must not reveal yet'},'synthetic-question'));assert.throws(()=>mcqPayload({...p(),options:['A','A']},'synthetic-question'));assert.throws(()=>mcqPayload({...p(),multiple:'false'},'synthetic-question'));});
test('empty arrays/foreign/duplicate choices cannot advance; A and E are real string choices, no cap',()=>{for(const text of ['', '[]','["unknown"]','["A. Synthetic","A. Synthetic"]'])assert(!canAdvance(p(),text));assert(canAdvance(p(),JSON.stringify([options[0],options[4]])));assert(canAdvance(p(),JSON.stringify(options)));assert(canAdvance({...p(),multiple:false},options[4]));assert(!canAdvance({...p(),multiple:false},'E'));});
test('notes/reasoning source minima and field-less reveal retain their distinct validation',()=>{assert(!canAdvance({...p('listen'),next:{to:'notes',field:'notes',minLength:3}},' a '));assert(canAdvance({...p('listen'),next:{to:'notes',field:'notes',minLength:3}},' abc '));assert(canAdvance({...p('committed'),next:{to:'revealed',field:null,minLength:0}},''));assert(!canAdvance({...p('chosen'),next:{to:'reasoned',field:'reasoning',minLength:10}},'short'));});
test('Day contract validates ordinal/role/progress; does not impose a maximum day count',()=>{const d=viewFixture('/app/listening/mcq/day/8').day;assert.equal(mcqDay(d,8,'student').day,8);assert.throws(()=>mcqDay(d,9,'student'));assert.equal(mcqDay({...d,day:1000},1000,'student').day,1000);assert.throws(()=>mcqDay({...d,draft:true},8,'student'));assert.equal(mcqDay({...d,draft:true},8,'teacher').draft,true);assert.throws(()=>mcqDay({...d,status:{...d.status,completed:6}},8,'student'));});
test('initial drill POST failure is visible, redacted and retryable before any question opens',async()=>{const ctx=setup();let calls=0;api.request=async()=>{if(++calls===1)throw Error('PRIVATE_DATABASE_TRACE');return p();};const n=host(ctx);n.querySelector('[data-mcq-open]').click();await tick();assert.equal(n.querySelector('[role=alert]').textContent,dict.common.error);assert(!n.textContent.includes('PRIVATE_DATABASE'));n.querySelector('[data-mcq-open]').click();await tick();assert(n.querySelector('[data-mcq-options]'));assert.equal(calls,2);});
test('native multi-select preserves nodes/focus, deselect-all disables submit and retry retains draft',async()=>{const ctx=setup();let patches=0,captured;api.request=async(path,o)=>{if(o.method==='POST')return p();patches++;captured=o.body;if(patches===1)throw Error('transient');return {...p('chosen'),outcome:'correct',session:{...p('chosen').session,chosenAnswer:captured.text},next:{to:'reasoned',field:'reasoning',minLength:10}};};const n=host(ctx);n.querySelector('[data-mcq-open]').click();await tick();const inputs=[...n.querySelectorAll('input')],click=i=>{inputs[i].click();};click(0);click(4);assert.equal(n.querySelectorAll('input:checked').length,2);assert.equal(n.querySelectorAll('input')[0],inputs[0]);click(0);click(4);assert(n.querySelector('[data-mcq-advance]').disabled);click(0);click(4);n.querySelector('[data-mcq-advance]').click();await tick();assert.equal(n.querySelectorAll('input:checked').length,2);assert(n.querySelector('[role=alert]'));n.querySelector('[data-mcq-advance]').click();await tick();assert.deepEqual(JSON.parse(captured.text),[options[0],options[4]]);assert.equal(n.querySelector('[data-mcq-outcome]').getAttribute('data-mcq-outcome'),'correct');assert.equal(patches,2);});
test('stale drill response after abort cannot refill old private DOM',async()=>{const ctx=setup();let resolve;api.request=()=>new Promise(r=>resolve=r);const n=host(ctx);n.querySelector('[data-mcq-open]').click();controller.abort();resolve(p());await tick();assert.equal(n.childNodes.length,0);});
test('source truthful empty question state is present, no drill buttons or fabricated questions',()=>{const n=host(setup(),[]);assert(n.textContent.includes(dict.listening.mcqEmpty));assert.equal(n.querySelectorAll('[data-mcq-open]').length,0);});
test('standalone practice enters the active question directly without an inline Start click',async()=>{const ctx=setup();let calls=0;api.request=async(path,o)=>{calls++;assert.equal(path,'/api/listening/mcq');assert.equal(o.body.questionId,'synthetic-question');return p();};const n=mcqMastery(ctx,{questions:[{id:'synthetic-question',order:1,questionText:'Synthetic',stage:'listen'}],autoOpen:true,practice:true});document.body.append(n);await tick();assert(n.hasAttribute('data-mcq-practice'));assert(n.querySelector('[data-mcq-options]'));assert.equal(n.querySelector('[data-mcq-open]'),null);assert.equal(calls,1);});

test('the question player receives its own resource instead of the first clip',()=>{
 const ctx=setup(),day=viewFixture('/app/listening/mcq/day/8').day;
 const first={...day.questions[0],audioUrl:'/api/resources/listening/mcq/day-08/question-01.mp3'};
 const second={...day.questions[1],audioUrl:'/api/resources/listening/mcq/day-08/question-02.mp3'};
 let resource;
 const renderQuestion=active=>renderDay({day:{...day,audioUrl:first.audioUrl},dict:ctx.dict,t:ctx.dict.listening.mcqProgram,
  questions:[first,second],activeIndex:1,active,MCQ_FINAL_STAGE:'reasoned',McqMastery:props=>{
   resource=props.audioUrl;
   return document.createElement('div');
  }});
 renderQuestion(second);
 assert.equal(resource,second.audioUrl);
 renderQuestion({...second,audioUrl:null});
 assert.equal(resource,null);
});

test('one written answer reveals options and one explanation saves and advances',async()=>{
 const ctx=setup(),navigations=[],submissions=[];
 const nextHref='/app/listening/mcq/day/1?q=2';
 ctx.navigate=href=>navigations.push(href);
 api.request=async(path,request)=>{
  if(request.method==='POST')return {...p('listen'),next:{to:'revealed',field:'ownAnswer',minLength:1}};
  submissions.push(request.body);
  if(request.body.step==='revealed')return p();
  if(request.body.step==='chosen')return {...p('chosen'),outcome:'correct',next:{to:'reasoned',field:'reasoning',minLength:10}};
  return {...p('reasoned'),next:null};
 };
 const drill=mcqMastery(ctx,{questions:[{id:'synthetic-question',order:1,questionText:'Synthetic question',stage:'listen'}],
  autoOpen:true,practice:true,dayNavigation:{nextHref}});
 document.body.append(drill);
 await tick();
 assert.equal(drill.querySelector('[data-mcq-options]'),null);
 function write(text){
  const area=drill.querySelector('[data-mcq-input]');
  area.value=text;
  area.dispatchEvent(new window.Event('input',{bubbles:true}));
 }
 write('A plausible answer');
 drill.querySelector('[data-mcq-advance]').click();
 await tick();
 assert(drill.querySelector('[data-mcq-options]'));
 assert.equal(drill.querySelector('[data-mcq-input]'),null);
 drill.querySelector('[data-mcq-option]').click();
 drill.querySelector('[data-mcq-advance]').click();
 await tick();
 write('The recording supports the first option.');
 const complete=drill.querySelector('[data-mcq-advance]');
 complete.click();
 complete.click();
 await tick();
 assert.deepEqual(submissions.map(item=>item.step),['revealed','chosen','reasoned']);
 assert.deepEqual(navigations,[nextHref]);
});
