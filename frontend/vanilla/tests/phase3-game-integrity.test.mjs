import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {classicGame,matchingGame} from '../modules/vocabulary/game-classic.js';
import {choiceOptions} from '../modules/vocabulary/game-content.js';

const word=(id,term,definitionEn,exampleSentence)=>({id,term,definitionEn,exampleSentence});
function fixture(id,words,answer){
 const h=setup({path:'/app/vocabulary/games/'+id+'?set=all',role:'student'});
 const pending=new Map();let serial=0;
 h.ctx.gameSetTimeout=(fn,ms)=>{pending.set(++serial,{fn,ms});return serial;};
 h.ctx.gameClearTimeout=id=>pending.delete(id);
 return Object.assign(h,{words,answer,pending});
}
test('gap holds words whose source sentence has no removable target',()=>{
 const h=fixture('gap',[word('a','staple food','A basic food.','Rice is eaten daily.')],async()=>({verified:true,correct:true}));
 try{classicGame(h.ctx,h.ctx.root,{id:'gap',words:h.words,answer:h.answer});assert.equal(h.q('[data-gap-sentence]'),null);assert.equal(h.q('input'),null);assert(h.ctx.root.textContent.includes(h.ctx.dict.vocabulary.games.noEligible));}finally{h.dispose();}
});
test('gap replaces a full phrase without deleting a longer unrelated word',()=>{
 const h=fixture('gap',[word('a','art','Creative expression.','The artist studies art.')],async()=>({verified:true,correct:true}));
 try{classicGame(h.ctx,h.ctx.root,{id:'gap',words:h.words,answer:h.answer});assert.equal(h.q('[data-gap-sentence]').textContent,'The artist studies ______.');}finally{h.dispose();}
});
test('choice offers distinct normalized terms and meanings',()=>{
 assert.deepEqual(choiceOptions({term:'run',definitionEn:'Move quickly.',acceptedTranslations:['sprint']},[{term:'sprint',definitionEn:'Move fast.'},{term:'sleep',definitionEn:'Rest.'}]),['run','sleep']);
 const rows=[word('a','co-operate','Work together.'),word('b','co operate','Work together.'),word('c','rest','Stop working.'),word('d','REST','Stop working.'),word('e','travel','Go somewhere.')];
 const h=fixture('choice',rows,async()=>({verified:true,correct:true}));
 try{classicGame(h.ctx,h.ctx.root,{id:'choice',words:h.words,answer:h.answer});const options=h.qa('[data-option]').map(n=>n.dataset.option.toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim());assert.equal(new Set(options).size,options.length);assert(options.length>=2);}finally{h.dispose();}
});
test('a server rejection overrides the local choice verdict',async()=>{
 const h=fixture('choice',[word('a','run','Move quickly.'),word('b','sleep','Rest at night.')],async()=>({verified:true,correct:false,awarded:0}));
 try{classicGame(h.ctx,h.ctx.root,{id:'choice',words:h.words,answer:h.answer});const target=h.q('[data-mcq-prompt]').textContent==='Move quickly.'?'run':'sleep';h.click(h.q('[data-option="'+target+'"]'));await tick();assert(h.q('[data-mcq-feedback]').textContent.startsWith(h.ctx.dict.vocabulary.games.wrongAnswer));}finally{h.dispose();}
});
test('a failed save keeps an unverified answer available for retry',async()=>{
 let resolve,calls=0;const response=new Promise(r=>resolve=r);
 const h=fixture('translation',[{...word('a','run','Move quickly.','We run daily.'),translationUz:'yugurmoq'}],async()=>{calls++;return response;});
 try{classicGame(h.ctx,h.ctx.root,{id:'translation',words:h.words,answer:h.answer});h.input(h.q('input'),'run');h.click(h.q('[data-game-check]'));h.click(h.q('[data-game-check]'));assert.equal(calls,1);assert.equal(h.q('[data-translation-answer]'),null);resolve(null);await tick();assert.equal(h.q('[data-translation-answer]'),null);assert.equal(h.q('input').value,'run');assert.equal(h.pending.size,0);assert(h.q('[data-game-verification-error]'));assert(!h.q('[data-game-check]').disabled);}finally{h.dispose();}
});
test('route exit discards a late verdict and does not schedule advancement',async()=>{
 let resolve;const h=fixture('gap',[word('a','run','Move quickly.','We run daily.')],()=>new Promise(r=>resolve=r));
 try{classicGame(h.ctx,h.ctx.root,{id:'gap',words:h.words,answer:h.answer});h.input(h.q('input'),'run');h.click(h.q('[data-game-check]'));h.controller.abort();resolve({verified:true,correct:true});await tick();assert.equal(h.pending.size,0);}finally{h.dispose();}
});
test('matching requires a verified server verdict before retaining a pair',async()=>{
 const h=fixture('match',[word('a','run','Move quickly.'),word('b','sleep','Rest at night.')],async()=>null);
 try{matchingGame(h.ctx,h.ctx.root,{words:h.words,answer:h.answer});h.click(h.q('[data-match-left=a]'));h.click(h.q('[data-match-right=a]'));await tick();assert.equal(h.q('[data-match-left=a]').disabled,false);assert(h.q('[data-game-verification-error]'));}finally{h.dispose();}
});
test('an acknowledged builder answer cannot be cleared and counted twice',async()=>{
 let calls=0;const h=fixture('builder',[word('a','run','Move quickly.','We run daily.')],async()=>{calls++;return {verified:true,correct:true};});
 try{classicGame(h.ctx,h.ctx.root,{id:'builder',words:h.words,answer:h.answer});for(let i=0;i<3;i++)h.click(h.q('[data-builder-tile="'+i+'"]'));h.click(h.q('[data-game-check]'));await tick();const clear=h.qa('button').find(n=>n.textContent===h.ctx.dict.vocabulary.games.clear);assert(clear.disabled);h.click(clear);h.click(h.q('[data-game-check]'));await tick();assert.equal(calls,1);}finally{h.dispose();}
});
