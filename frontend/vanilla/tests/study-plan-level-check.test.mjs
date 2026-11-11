/** Standalone tests: landing-equivalent level check, choice flow and profile fallback. */
import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {mount as levelCheck,validateLevelForm} from '../modules/study-plan/level-check.js';
import {profileLevel} from '../modules/profile/level-select.js';
import {returnPolicy} from '../modules/campus/return-policy.js';

const LEVELS=['A1','A2','B1','B2','C1','C2'];
const SKILLS=['grammar','vocabulary','reading','listening','use'];
const API='/api/study-plan/monthly/sequence/level';
let dom,controller,root,oldRequest,navigated;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function ctx(path='/app/plan/level-check'){
 return {root,signal:controller.signal,locale:'uz',
  dict:{common:{loading:'Yuklanmoqda'}},
  url:new URL('https://fixture.invalid'+path),
  session:{user:{role:'student',id:'fixture-user'}},
  navigate:href=>{navigated=href;},
 };
}
function questions(){
 return Array.from({length:15},(_,i)=>({
  id:'test-'+i,skill:SKILLS[i%5],q:'Question '+(i+1),
  options:['A','B','C','D'],...(i%5===3?{audio:'Listen to the sentence.'}:{}),
  ...(i%5===2?{passage:'Text to read.'}:{}),
 }));
}
const quiz=()=>({state:'quiz',attemptId:'fixture-attempt',level:'B2',total:15,questions:questions()});
const scored=()=>({state:'result',level:'B2',correct:14,total:15,passed:true,
 savedLevel:'B2',label:'strong',suggestedLevel:'B2',nextLevel:null,
 skills:Object.fromEntries(SKILLS.map(s=>[s,{correct:3,total:3}])),
 review:questions().map(q=>({id:q.id,correct:true,selected:'A',answer:'A',explanation:'Reason'})),
 qualification:'study_guidance_not_cefr_certificate'});
beforeEach(()=>{
 dom=new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  {url:'https://fixture.invalid/app/plan/level-check',pretendToBeVisual:true});
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 globalThis.Node=dom.window.Node;globalThis.HTMLElement=dom.window.HTMLElement;
 root=document.querySelector('#root');controller=new dom.window.AbortController();
 oldRequest=api.request;navigated=null;
});
afterEach(()=>{controller.abort();api.request=oldRequest;dom.window.close();});

test('level quiz validates 15 questions, 5 skills, and forbids leaked answer keys',()=>{
 assert.equal(validateLevelForm(quiz()).state,'quiz');
 const invalid=quiz();invalid.questions[0].options[2]=false;
 assert.throws(()=>validateLevelForm(invalid),/invalid_level_question/);
 assert.throws(()=>validateLevelForm({...quiz(),questions:questions().slice(1)}),
  /invalid_level_quiz/);
 assert.throws(()=>validateLevelForm({state:'select',levels:['A1']}),
  /invalid_level_choices/);
});

test('30-day level check renders separate page and launches selected B2 test',async()=>{
 const calls=[];
 api.request=async(path,options={})=>{
  calls.push({path,method:options.method??'GET',body:options.body});
  return path===API?{state:'select',levels:LEVELS,currentLevel:null}:quiz();
 };
 levelCheck(ctx());await tick();
 assert.equal(root.querySelectorAll('[data-level-select]').length,6);
 root.querySelector('[data-level-select="B2"]').click();
 root.querySelector('[data-level-begin]').click();await tick();
 assert.deepEqual(calls[1],{path:API+'/start',method:'POST',body:{level:'B2'}});
 assert.equal(root.querySelectorAll('[data-level-step]').length,15);
 assert.equal(root.querySelectorAll('[data-level-answer]').length,4);
 assert.match(root.textContent,/Question 1/);
 assert.match(root.textContent,/Assignments/);
});

test('selected answers navigate back without losing progress and only submit when complete',async()=>{
 const calls=[];
 api.request=async(path,options={})=>{
  calls.push({path,method:options.method??'GET',body:options.body});
  return path===API?quiz():scored();
 };
 levelCheck(ctx());await tick();
 for(let i=0;i<15;i++){
  root.querySelector('[data-level-answer="0"]').click();
  root.querySelector('[data-level-next]').click();
 }
 await tick();
 const submit=calls.filter(row=>row.path===API+'/submit');
 assert.equal(submit.length,1);
 assert.equal(submit[0].method,'POST');
 assert.equal(submit[0].body.answers.length,15);
 assert(submit[0].body.answers.every(v=>v===0));
 assert.equal(root.querySelector('[data-level-check-result]')!=null,true);
 assert.match(root.textContent,/14\/15/);
});

test('passed assessment creates actual 30-day plan then navigates to Assignments',async()=>{
 const calls=[];
 api.request=async(path,options={})=>{
  calls.push(path);
  if(path===API)return quiz();
  if(path===API+'/submit')return scored();
  if(path.endsWith('/start'))return {state:'active'};
  throw Error('unexpected '+path);
 };
 levelCheck(ctx());await tick();
 for(let i=0;i<15;i++){
  root.querySelector('[data-level-answer="1"]').click();
  root.querySelector('[data-level-next]').click();
 }
 await tick();
 root.querySelector('[data-level-create-plan]').click();await tick();
 assert(calls.includes('/api/study-plan/monthly/sequence/start'));
 assert.equal(navigated,'/app/assignments#study-plan-30');
});

test('manual profile level change writes only currentLevel, never overwrites study fields',async()=>{
 const calls=[];
 api.request=async(path,options={})=>{
  calls.push([path,options]);
  if(path===API)return {state:'select',levels:LEVELS,currentLevel:null};
  return {state:'saved',level:options.body.level,source:'self_reported'};
 };
 root.append(profileLevel(ctx('/app/profile?edit=level')));await tick();
 const select=root.querySelector('[data-profile-level-select]');
 assert.equal(select.value,'');
 select.value='C1';select.dispatchEvent(new dom.window.Event('change'));
 const form=root.querySelector('form');
 form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();
 assert.deepEqual(calls[1],[API+'/manual',{method:'POST',body:{level:'C1'},
   signal:controller.signal}]);
 assert.match(root.textContent,/saqlandi/);
});

test('dedicated test Back returns to the 30-day plan',()=>{
 const page=new URL('https://fixture.invalid/app/plan/level-check');
 assert.deepEqual(returnPolicy(page),{mode:'back',href:'/app/assignments#study-plan-30'});
});
