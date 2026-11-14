import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderObjectiveMaterial, renderObjectiveReview} from '../modules/mocks/objective-material.js';
import {renderMockPreview} from '../modules/mocks/preview.js';

const options=['A','B','C'].map(label=>({label,text:`Option ${label}`}));
const material={layout:'ielts-native-v1',passages:[
  {passageNo:1,title:'First passage',bodyText:'Actual passage text.'},
  {passageNo:2,title:'Second passage',bodyText:'Another passage.'}],
  questions:[
    {id:'1',part:1,type:'multiple_choice',questionText:'Choose a reason.',options},
    {id:'2',part:1,type:'true_false_not_given',questionText:'A statement.',options:['TRUE','FALSE','NOT GIVEN'].map(label=>({label,text:label}))},
    {id:'3',part:1,type:'matching',questionText:'Section A',options:[{label:'i'},{label:'ii'}]},
    {id:'4',part:1,type:'multiple_choice',pair:[4,5]},
    {id:'5',part:1,type:'multiple_choice',pair:[4,5]},
    {id:'6',part:1,type:'completion'},
    {id:'7',part:2,type:'completion',questionText:'Complete the final answer.'}],
  groups:[
    {id:'single',part:1,questionIds:['1','2','3']},
    {id:'pair',part:1,type:'multiple_choice_multi',title:'Questions 4–5',selectionCount:2,questionIds:['4','5'],options},
    {id:'gaps',part:1,questionIds:['6'],stimulusText:'Total: {{6}}'},
    {id:'last',part:2,questionIds:['7']}],
};

function setup(){
  const dom=new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.document=dom.window.document;globalThis.Node=dom.window.Node;
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  return dom;
}

test('native controls save IELTS answers, enforce two selections and navigate both pair numbers',()=>{
  const dom=setup(),answers={},changes=[];
  const root=renderObjectiveMaterial({material,skill:'reading',answers,onAnswer:(...args)=>changes.push(args)});
  document.body.append(root);
  root.querySelector('input[name="reading-q1"][value="B"]').click();
  root.querySelector('input[name="reading-q2"][value="NOT GIVEN"]').click();
  const select=root.querySelector('select');select.value='ii';select.dispatchEvent(new dom.window.Event('change'));
  const checks=[...root.querySelectorAll('input[type=checkbox]')];
  checks[0].click();checks[1].click();checks[2].click();
  assert.equal(checks[2].checked,false);
  assert.deepEqual([answers['4'],answers['5']],['A','B']);
  checks[1].click();checks[2].click();
  assert.deepEqual([answers['4'],answers['5']],['A','C']);
  const input=root.querySelector('input[data-native-question="6"]');
  input.value='42';input.dispatchEvent(new dom.window.Event('input'));
  assert.deepEqual(answers,{'1':'B','2':'NOT GIVEN','3':'ii','4':'A','5':'C','6':'42'});
  root.querySelector('[aria-label="Go to question 5"]').click();
  assert.equal(document.activeElement,checks[0]);
  root.querySelector('[aria-label="Go to question 7"]').click();
  assert.equal(root.querySelector('[data-native-part="1"]').hidden,true);
  assert.equal(root.querySelector('[data-native-part="2"]').hidden,false);
  assert.equal(document.activeElement.getAttribute('data-native-question'),'7');
  assert.equal(changes.at(-1)[1],'42');
});

test('native controls restore saved selections without firing autosave',()=>{
  setup();let changes=0;
  const root=renderObjectiveMaterial({material,skill:'reading',answers:{'1':'B','3':'ii','4':'A','5':'C','6':'saved'},onAnswer:()=>changes++});
  assert.equal(root.querySelector('input[name="reading-q1"][value="B"]').checked,true);
  assert.equal(root.querySelector('select').value,'ii');
  assert.equal(root.querySelector('input[data-native-question="6"]').value,'saved');
  assert.equal(root.querySelectorAll('input[type=checkbox]:checked').length,2);
  assert.equal(changes,0);
});

test('review renders rationale as text and staff preview does not invent a grade',()=>{
  setup();
  const item={questionId:'1',number:1,correctAnswer:'A',studentAnswer:'B',questionText:'Question',
    explanation:'<script>untrusted()</script>',evidenceQuote:'Exact passage evidence.'};
  const review=renderObjectiveReview([item],'uz');
  assert.equal(review.querySelector('script'),null);
  assert.match(review.textContent,/<script>untrusted/);
  assert.doesNotMatch(review.querySelector('summary').textContent,/Noto‘g‘ri/);
  assert.match(renderObjectiveReview([{...item,isCorrect:false}],'uz').textContent,/Noto‘g‘ri/);
  let closed=false;
  const preview=renderMockPreview({testId:'test-1',title:'Mock 1',materials:{reading:{...material,questions:material.questions.map(q=>({...q,explanation:'Clear reason.',correctAnswer:'A'}))}}},
    {locale:'uz',onClose:()=>{closed=true;}});
  [...preview.querySelectorAll('button')].find(b=>b.textContent==='Javob va izohlarni ko‘rish').click();
  assert.equal(preview.querySelectorAll('[data-mock-review-question]').length,7);
  assert.doesNotMatch(preview.querySelector('[data-mock-objective-review]').textContent,/Noto‘g‘ri/);
  [...preview.querySelectorAll('button')].find(b=>b.textContent==='Ko‘rishni yopish').click();
  assert.equal(closed,true);
});
