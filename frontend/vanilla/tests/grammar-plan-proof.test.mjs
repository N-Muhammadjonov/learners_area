import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {adaptSkillUnit} from '../modules/grammar/book-skill-adapter.js';
import {renderInteractiveBook} from '../modules/grammar/book-runtime.js';

test('Grammar plan proof preserves actual incorrect choices and all three first-stage groups',()=>{
 const dom=new JSDOM('<!doctype html><div id="host"></div>',{
  url:'https://fixture.invalid/app/grammar?tab=speaking&book=spk-64',
  pretendToBeVisual:true,
 });
 const globals=['window','document','Node','localStorage','Option'];
 const old=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
 try{
  for(const key of globals)globalThis[key]=dom.window[key];
  dom.window.scrollTo=()=>{};
  const source=JSON.parse(readFileSync(new URL(
   '../modules/grammar/book-skill-source-speaking-upper.json',import.meta.url),'utf8'));
  const unit=adaptSkillUnit(source.units[0]);
  const host=document.querySelector('#host'),shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<div id="nav"></div><div id="units"></div>';
  const sent=[];
  renderInteractiveBook(shadow,[unit],new AbortController().signal,
    'test:grammar:proof',null,evidence=>sent.push(evidence));
  const groups=[...shadow.querySelectorAll('.unit .panel')][0].querySelectorAll('.exc');
  assert.equal(groups.length,3);
  assert.deepEqual(unit.stages[0].ex.map(ex=>ex.kind),['mcq','judge','match']);

  const mcq=groups[0];
  const first=unit.stages[0].ex[0].items[0];
  const deliberatelyWrong=first.opts.find(option=>option!==first.a);
  const mcqRows=mcq.querySelectorAll('.item');
  for(let i=0;i<mcqRows.length;i++){
   const choice=i===0?deliberatelyWrong:unit.stages[0].ex[0].items[i].a;
   const button=[...mcqRows[i].querySelectorAll('button.opt')].find(b=>b.textContent===choice);
   assert(button,'MCQ option exists');button.click();
  }
  assert.equal(sent.length,0,'selection alone is never graded');
  mcq.querySelector('[data-group-check]').click();
  assert.equal(sent.length,0,'one checked block never completes a stage');

  const judge=groups[1];
  for(const row of judge.querySelectorAll('.item')){
   const button=[...row.querySelectorAll('button.opt')].find(b=>b.textContent==="Noto'g'ri");
   assert(button);button.click();
  }
  judge.querySelector('[data-group-check]').click();
  assert.equal(sent.length,0,'two checked blocks never complete a stage');

  const match=groups[2],matches=unit.stages[0].ex[2];
  for(const [i,row] of [...match.querySelectorAll('.item')].entries()){
   const selected=row.querySelector('select');
   selected.value=matches.items[i].r;
  }
  [...match.querySelectorAll('button')].find(button=>button.textContent==='Tekshirish').click();
  assert.equal(sent.length,1);
  assert.equal(sent[0].unitId,unit.id);
  assert.equal(sent[0].stage,0);
  assert.equal(sent[0].answers.length,3);
  assert.equal(sent[0].answers[0][0],deliberatelyWrong,
   'incorrect selected answer must not be replaced by highlighted correct option');
  assert.equal(sent[0].answers[1][0],'Xato',
   'Judge option uses the original content-bank answer vocabulary');
  assert.equal(sent[0].answers[2][0],matches.items[0].r);
 }finally{
  dom.window.close();
  for(const key of globals){
   if(old[key]===undefined)delete globalThis[key];
   else globalThis[key]=old[key];
  }
 }
});
