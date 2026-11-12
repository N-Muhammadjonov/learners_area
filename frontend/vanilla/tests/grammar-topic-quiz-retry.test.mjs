import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {GrammarQuiz} from '../modules/grammar/quiz.js';

test('classic Grammar topic waits for every selection, then retries only this quiz after mistakes',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{
  url:'https://fixture.invalid/app/grammar/topic',pretendToBeVisual:true});
 const previous={};
 for(const key of ['window','document','Node','navigator']){
  previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]});
 }
 const original=api.request,controller=new dom.window.AbortController();
 try{
  const exercises=[
   {id:'10000000-0000-4000-8000-000000000001',order:1,
    promptText:'I ___ happy',options:['is','am'],fromEssay:false},
   {id:'10000000-0000-4000-8000-000000000002',order:2,
    promptText:'They ___ ready',options:['are','am'],fromEssay:false},
  ];
  const dict={
   common:{loading:'Loading',saving:'Saving',retry:'Qayta urinish'},
   grammar:{pickCorrect:'Choose',fromYourEssay:'Essay',writeYourOwn:'Write your own',
    submit:'Tekshirish',correct:'Correct',incorrect:'Incorrect',
    checkMine:'Check mine',sampleAnswer:'Sample'},
   coach:{verdicts:{correct:'Correct'},checkedBy:'Checked by'},
   apiErrors:{generic:'Error'},
  };
  let submissions=0;
  api.request=async(path,options)=>{
   submissions++;
   assert.equal(path,'/api/grammar/topics/topic/submit');
   assert.equal(options.body.answers.length,2);
   return {results:[
    {exerciseId:exercises[0].id,isCorrect:false,correctOption:'am',explanation:'Use am'},
    {exerciseId:exercises[1].id,isCorrect:true,correctOption:'are',explanation:'Use are'},
   ]};
  };
  const node=GrammarQuiz({context:{signal:controller.signal},dict,topicId:'topic',exercises});
  document.body.append(node);
  const actions=node.querySelector('[data-grammar-quiz-actions]'),check=actions.querySelector('button'),
    retry=actions.querySelector('[data-grammar-group-retry]');
  assert(check.disabled);
  assert.equal(retry.style.display,'none');
  node.querySelectorAll('input[type="radio"]')[0].click();
  assert(check.disabled);
  assert.equal(submissions,0);
  node.querySelectorAll('input[type="radio"]')[2].click();
  assert(!check.disabled);
  check.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(submissions,1);
  assert.equal(check.style.display,'none');
  assert.equal(retry.style.display,'');
  retry.click();
  assert.equal(check.style.display,'');
  assert(check.disabled);
  assert.equal(retry.style.display,'none');
  assert([...node.querySelectorAll('input[type="radio"]')].every(r=>!r.checked));
  assert.equal(submissions,1,'retry does not silently submit');
 }finally{
  controller.abort();api.request=original;dom.window.close();
  for(const [key,value] of Object.entries(previous))
   if(value)Object.defineProperty(globalThis,key,value);
   else delete globalThis[key];
 }
});
