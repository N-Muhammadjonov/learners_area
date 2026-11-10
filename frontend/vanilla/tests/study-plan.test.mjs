import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'https://learners.invalid/app/study-plan'});
Object.assign(globalThis,{document:dom.window.document,window:dom.window,Node:dom.window.Node,location:dom.window.location});
const week = Array.from({length:7},(_,i)=>({date:'2026-11-'+(10+i),tasks:[]}));
const goal = {configured:true,target:8,examDate:'2027-01-10',minutes:120,timezone:'Asia/Tashkent',
  weekdays:[0,1,2,3,4,5],preferredTime:'18:00',focusSkills:['reading'],skillTargets:{reading:8.5}};
const task = {key:'reading:example',skill:'reading',title:'<Reading assessment>',href:'/app/reading/academic/example',
  reason:'reading:matching_headings',status:'planned',minutes:60,date:week[0].date,originalDate:week[0].date};
week[0].tasks.push(task);
const summary = {goals:goal,today:week[0].date,days:week,latest:{},history:[],streak:2,weaknesses:[]};
let requests=[];
let payload=summary;
globalThis.fetch = async (path,options) => {
  requests.push([path,options]);
  return Response.json(payload);
};
const {mount}=await import('../modules/study-plan/page.js');
const {mountToday,dayTotals}=await import('../modules/study-plan/view.js');

const dict = {common:{back:'Back',loading:'Loading'},errorPage:{retry:'Retry'},errors:{unknown:'Error'}};
const flush = () => new Promise(resolve=>setTimeout(resolve,10));
function context() {
  const root=document.querySelector('#root');
  root.replaceChildren();
  const controller=new dom.window.AbortController();
  return {root,url:new URL(location.href),signal:controller.signal,locale:'en',dict,session:{user:{role:'student'}}};
}

test('calendar renders seven days, excludes fabricated bands and uses the actual task route',async()=>{
  const ctx=context();
  payload=summary;
  mount(ctx);
  await flush();
  assert.equal(ctx.root.querySelectorAll('[data-day]').length,7);
  assert.match(ctx.root.textContent,/More assessments are needed/);
  assert.equal(ctx.root.querySelector('[data-study-task] a').getAttribute('href'),task.href);
  assert.match(ctx.root.textContent,/<Reading assessment>/);
  assert.equal(ctx.root.querySelector('reading'),null);
  ctx.root.querySelectorAll('[data-day]')[1].click();
  assert.match(ctx.root.textContent,/Nothing is scheduled/);
  assert.equal(ctx.root.querySelector('[data-study-task]'),null);
});

test('onboarding pre-fills an existing profile and saves the selected weekdays through the API',async()=>{
  const ctx=context();
  payload={...summary,goals:{...goal,configured:false}};
  requests=[];
  mount(ctx);
  await flush();
  const form=ctx.root.querySelector('form');
  assert.equal(form.querySelector('input[type="number"]').value,'8');
  assert.equal(form.querySelector('input[type="time"]').value,'18:00');
  payload=summary;
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await flush();
  const request=requests.find(([url])=>url.endsWith('/preferences'));
  assert.equal(request[1].method,'PUT');
  assert.deepEqual(JSON.parse(request[1].body).weekdays,goal.weekdays);
  assert.equal(ctx.root.querySelectorAll('[data-day]').length,7);
});

test('dashboard totals come from server completion, and completed tasks have no start link',async()=>{
  const ctx=context();
  const day={...week[0],tasks:[{...task,status:'completed'}]};
  payload={...summary,days:[day]};
  mountToday(ctx,ctx.root);
  await flush();
  assert.deepEqual(dayTotals(day),{planned:1,completed:1,minutes:60,completedMinutes:60});
  assert.equal(ctx.root.querySelector('progress').value,1);
  assert.equal(ctx.root.querySelector('[data-study-task-status="completed"] a'),null);
});

test('the monthly diagnostic loads on opt-in and sends four sections before showing a 30-day plan',async()=>{
  const ctx=context();
  requests=[];
  payload=summary;
  mount(ctx);
  await flush();
  assert.equal(requests.some(([url])=>url.includes('/monthly')),false);
  const buttonByText=label=>[...ctx.root.querySelectorAll('button')].find(button=>button.textContent===label);
  payload={state:'available'};
  buttonByText('30-day plan').click();
  await flush();
  assert.equal(buttonByText('30-day plan').getAttribute('aria-pressed'),'true');
  const skills=['listening','reading','writing','grammar'];
  const form={id:'attempt-1',version:'monthly-v1',sections:skills.map(skill=>({
    skill,audio:skill==='listening'?'/sample.wav':null,
    sample:skill==='writing'?'Write a paragraph.':null,
    questions:[{id:skill+'-1',prompt:'Select an answer',options:['A','B']}],
  }))};
  payload={state:'assessment',form};
  buttonByText('Start the mini-test').click();
  await flush();
  const assessment=[...ctx.root.querySelectorAll('form')].find(element=>element.querySelector('audio'));
  assert.equal(assessment.querySelector('audio').getAttribute('src'),'/sample.wav');
  assert.equal(assessment.querySelectorAll('fieldset').length,4);
  for(const skill of skills) assessment.querySelector('input[name="'+skill+'-1"]').checked=true;
  assessment.querySelector('textarea').value='The library should stay open later so people who work can visit it. For example, a nurse finishing at six could collect reserved books on the way home. The library could test two late evenings first and use the results to decide whether to expand the hours.';
  const days=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,10,10+i)).toISOString().slice(0,10),phase:'foundation',tasks:[]}));
  days[0].tasks.push({skill:'grammar',topic:'articles',phase:'foundation',minutes:20,href:'/app/grammar',status:'planned'});
  payload={state:'active',today:days[0].date,from:days[0].date,through:days.at(-1).date,days,
    diagnosis:Object.fromEntries(skills.map(skill=>[skill,{correct:1,total:1,topics:{}}]))};
  assessment.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await flush();
  const [,submission]=requests.find(([url])=>url.endsWith('/monthly/assessment'));
  assert.deepEqual(Object.keys(JSON.parse(submission.body).answers),skills.map(skill=>skill+'-1'));
  assert.equal(ctx.root.querySelectorAll('[data-month-day]').length,7);
  buttonByText('Final days').click();
  assert.equal(ctx.root.querySelectorAll('[data-month-day]').length,2);
  buttonByText('7-day plan').click();
  assert.equal(ctx.root.querySelectorAll('[data-day]').length,7);
});
