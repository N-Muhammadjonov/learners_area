import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderInteractiveBook} from '../modules/grammar/book-runtime.js';

let dom,controller,shadow;
const fixtureUnit={
  id:'check-1',title:'Group grading fixture',code:'A1',lessons:'1',
  rule:{title:'Rules',table:[['Form','Use'],['am','I']],points:[],examples:[]},
  stages:[
    {n:'1',name:'Understanding',sub:'',ex:[
      {letter:'A',kind:'mcq',instr:'Select.',items:Array.from({length:5},(_,i)=>({
        q:'Question '+i,opts:['is','am','are'],a:'am'}))},
      {letter:'B',kind:'judge',instr:'Judge.',items:[
        {q:'I am',t:true},{q:'He are',t:false,fix:'He is'}]},
      {letter:'C',kind:'match',instr:'Match.',rights:['is','am'],items:[
        {l:'I',r:'am'},{l:'He',r:'is'}]},
    ]},
    {n:'2',name:'Practice',sub:'',ex:[
      {letter:'A',kind:'bank',instr:'Fill.',bank:['am','is'],items:[
        {q:'I ___',a:['am']},{q:'He ___',a:['is']}]},
      {letter:'B',kind:'order',instr:'Order.',items:[
        {words:['I','am'],a:['I am']},{words:['He','is'],a:['He is']}]},
      {letter:'C',kind:'typed',instr:'Type.',items:[
        {q:'I ___',a:['am']},{q:'He ___',a:['is']}]},
    ]},
    {n:'3',name:'Apply',sub:'',ex:[
      {letter:'A',kind:'tr',instr:'Translate.',items:[{q:'Men',a:['I']}]},
      {letter:'B',kind:'fix',instr:'Correct.',items:[{q:'She are',a:['She is']}]},
      {letter:'C',kind:'transform',instr:'Transform.',items:[{q:'We',a:['We are']}]},
    ]},
    {n:'4',name:'Communicate',sub:'',ex:[
      {letter:'A',kind:'speak',instr:'Speak.',items:[
        {q:'Say hello',a:['Hello']},{q:'Say bye',a:['Bye']}]},
      {letter:'B',kind:'write',instr:'Write.',placeholder:'Write here',
        min:3,model:'I study grammar.'},
      {letter:'C',kind:'typed',instr:'Type.',items:[{q:'Where?',a:['Home']}]},
    ]},
  ],
};
const get=(stage,index)=>shadow.querySelectorAll('.unit .panel')[stage].querySelectorAll('.exc')[index];
const score=()=>JSON.parse(localStorage.getItem('test-grammar-groups')||'{}')['check-1']??{};
beforeEach(()=>{
  dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{
    url:'https://grammar.test/',pretendToBeVisual:true});
  for(const name of ['window','document','Node','localStorage','Option','navigator'])
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:dom.window[name]});
  window.scrollTo=()=>{};
  window.HTMLMediaElement.prototype.load=()=>{};
  window.HTMLMediaElement.prototype.pause=()=>{};
  controller=new dom.window.AbortController();
  shadow=document.getElementById('root').attachShadow({mode:'open'});
  const nav=document.createElement('nav');nav.id='nav';
  const units=document.createElement('div');units.id='units';
  shadow.append(nav,units);
  renderInteractiveBook(shadow,[fixtureUnit],controller.signal,'test-grammar-groups');
});
afterEach(()=>{controller.abort();dom.window.close();});

test('MCQ choices do not grade until all five answers and an explicit Check',()=>{
  let card=get(0,0),check=card.querySelector('[data-group-check]');
  const rows=[...card.querySelectorAll('.item')];
  rows[0].querySelectorAll('.opt')[1].click();
  assert.equal(rows[0].querySelector('.opt.picked').textContent,'am');
  assert.equal(card.querySelector('.opt.ok'),null);
  assert.equal(score()[0],undefined);
  check.click();
  assert.match(card.textContent,/barcha mashqlarni/);
  assert.equal(score()[0],undefined);
  rows.forEach((row,i)=>row.querySelectorAll('.opt')[i===2?0:1].click());
  check.click();
  assert.equal(score()[0][0],4);
  assert.equal(card.querySelectorAll('.opt.no').length,1);
  assert.equal(card.querySelectorAll('.opt.ok').length,5);
  assert.equal(card.querySelector('[data-group-retry]').hidden,false);
  card.querySelector('[data-group-retry]').click();
  card=get(0,0);
  assert.equal(card.querySelector('.opt.picked'),null);
  assert.equal(card.querySelector('.opt.ok'),null);
  assert.equal(score()[0]?.[0],undefined);
  assert.equal(card.querySelector('[data-group-check]').disabled,false);
});

test('retrying one grammar group does not clear other checked groups',()=>{
  let first=get(0,0),second=get(0,1);
  first.querySelectorAll('.item').forEach(row=>row.querySelectorAll('.opt')[0].click());
  first.querySelector('[data-group-check]').click();
  assert.equal(score()[0][0],0);
  second.querySelectorAll('.item')[0].querySelectorAll('.opt')[0].click();
  second.querySelectorAll('.item')[1].querySelectorAll('.opt')[1].click();
  second.querySelector('[data-group-check]').click();
  assert.equal(score()[0][1],2);
  first.querySelector('[data-group-retry]').click();
  assert.equal(score()[0][0],undefined);
  assert.equal(score()[0][1],2);
  assert.equal(second.querySelector('[data-group-check]').disabled,true);
});

test('match, word bank, ordering and typed groups require every row before Check',()=>{
  const match=get(0,2);
  match.querySelector('select').value='am';
  match.querySelector('[data-group-check]').click();
  assert.equal(score()[0]?.[2],undefined);
  match.querySelectorAll('select')[1].value='is';
  match.querySelector('[data-group-check]').click();
  assert.equal(score()[0][2],2);

  const bank=get(1,0);
  bank.querySelector('[data-group-check]').click();
  assert.equal(score()[1]?.[0],undefined);
  bank.querySelectorAll('.chip')[0].click();
  bank.querySelectorAll('.chip')[1].click();
  bank.querySelector('[data-group-check]').click();
  assert.equal(score()[1][0],2);

  const order=get(1,1);
  order.querySelector('[data-group-check]').click();
  assert.equal(score()[1]?.[1],undefined);
  order.querySelectorAll('.item').forEach(row=>
    [...row.querySelectorAll('.wchip')].forEach(chip=>chip.click()));
  order.querySelector('[data-group-check]').click();
  assert.equal(score()[1][1],2);

  const typed=get(1,2);
  typed.querySelector('input').value='am';
  typed.querySelector('[data-group-check]').click();
  assert.equal(score()[1]?.[2],undefined);
  typed.querySelectorAll('input')[1].value='is';
  typed.querySelector('[data-group-check]').click();
  assert.equal(score()[1][2],2);
});

test('Speaking and Writing grammar use exactly the same Check/Retry semantics',()=>{
  const speech=get(3,0);
  speech.querySelector('.item button.btn').click();
  assert.equal(score()[3]?.[0],undefined);
  speech.querySelector('[data-group-check]').click();
  assert.equal(score()[3]?.[0],undefined);
  speech.querySelectorAll('.item')[1].querySelector('button.btn').click();
  assert.equal(score()[3]?.[0],undefined);
  speech.querySelector('[data-group-check]').click();
  assert.equal(score()[3][0],2);
  assert.equal(speech.querySelector('[data-group-retry]').hidden,false);
  speech.querySelector('[data-group-retry]').click();
  assert.equal(score()[3]?.[0],undefined);
  const writing=get(3,1),textarea=writing.querySelector('textarea');
  textarea.value='one two';
  writing.querySelector('[data-group-check]').click();
  assert.equal(score()[3]?.[1],undefined);
  textarea.value='one two three';
  writing.querySelector('[data-group-check]').click();
  assert.equal(score()[3][1],1);
  writing.querySelector('[data-group-retry]').click();
  assert.equal(get(3,1).querySelector('textarea').value,'');
});

test('typing a wrong response can retry only its own sub-exercise set',()=>{
  let card=get(2,1);
  card.querySelector('input').value='wrong';
  card.querySelector('[data-group-check]').click();
  assert.equal(score()[2][1],0);
  assert.equal(card.querySelector('[data-group-retry]').hidden,false);
  card.querySelector('[data-group-retry]').click();
  card=get(2,1);
  assert.equal(score()[2]?.[1],undefined);
  assert.equal(card.querySelector('input').readOnly,false);
});
