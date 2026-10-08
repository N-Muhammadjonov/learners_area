import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import { questionTypesFor } from "../../src/lib/content/question-types";
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/reading'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','navigator'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');Object.assign(globalThis,{React});
const {act}=React;const {createRoot}=await import('react-dom/client');
const {QuestionCard,GroupQuestions}=await import('../../src/components/reading/ReadingExam');
for(const type of questionTypesFor('reading'))test(`R-V4 renderer uses registry answer model: ${type.id}`,async()=>{
 document.body.innerHTML='<div id="root"></div>';
 const root=createRoot(document.querySelector('#root')!);const changes:string[]=[];
 function Harness(){const [value,setValue]=React.useState('');return <QuestionCard dict={en} question={{id:'q',order:1,questionNo:1,type:'short_answer',typeCode:type.id,questionText:'Authored prompt',groupId:null,renderMode:null,answerConstraint:null,options:['A) first','B) second','C) third']}} group={null} value={value} inputId="answer-q" onChange={next=>{changes.push(next);setValue(next);}}/>;}
 try{
  await act(async()=>root.render(<Harness/>));
  assert.equal(document.querySelector('[data-reading-type]')?.getAttribute('data-reading-type'),type.id);
  if(type.answerModel.kind==='ternary'){
   const controls=document.querySelectorAll('[role=radio]');assert.equal(controls.length,3);
   await act(async()=>(controls[0] as HTMLButtonElement).click());assert.ok(changes.length);
  }else if(type.answerModel.kind==='choice_multi'){
   const controls=document.querySelectorAll('input[type=checkbox]');assert.equal(controls.length,3);
   await act(async()=>(controls[0] as HTMLInputElement).click());await act(async()=>(controls[1] as HTMLInputElement).click());assert.equal(changes.at(-1),'A, B');
  }else if(type.answerModel.kind==='text'){
   assert.equal(document.querySelectorAll('input:not([type=radio]):not([type=checkbox])').length,1);
   assert.equal(document.querySelector('input')?.getAttribute('aria-label'),`${en.reading.yourAnswer} 1`);
  }else{
   const control=document.querySelector('input[type=radio]') as HTMLInputElement;assert.ok(control);
   await act(async()=>control.click());assert.equal(changes.at(-1),'A) first');
  }
 }finally{await act(async()=>root.unmount());}
});
test('shared authored stimulus renders once with both reachable blanks in the reused group renderer',async()=>{
 document.body.innerHTML='<div id="root"></div>';const root=createRoot(document.querySelector('#root')!);
 const group={id:'g',position:1,typeCode:'NOTE',displayTitle:'Authored notes',instructionsText:'One word only',fromQuestionNo:1,toQuestionNo:2,sharedChoices:[]};
 const questions=[1,2].map(n=>({id:`q${n}`,order:n,questionNo:n,type:'short_answer' as const,typeCode:'note_completion',questionText:'The museum opens at 1 ____ and closes at 2 ____.',groupId:'g',renderMode:'shared_stimulus_slot',answerConstraint:null,options:null}));
 try{await act(async()=>root.render(<GroupQuestions dict={en} group={group} questions={questions} answers={{}} onChange={()=>{}}/>));
 assert.equal(document.querySelectorAll('input').length,2);assert.equal(document.body.textContent?.split('The museum opens').length,2);
 }finally{await act(async()=>root.unmount());}
});
