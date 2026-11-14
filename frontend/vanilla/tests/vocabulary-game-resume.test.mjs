import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountGames} from '../modules/vocabulary/games.js';

const folder=ID(7);
const words=[
 {id:ID(11),term:'clarify',definitionEn:'make clear',translationUz:'aniqlashtirmoq'},
 {id:ID(12),term:'resolve',definitionEn:'find an answer',translationUz:'hal qilmoq'},
];

test('Returning to a folder game restores the saved word and score',async()=>{
 const h=setup({path:'/app/vocabulary/games/translation?set=folder&folderId='+folder,locale:'uz',role:'student'});
 let saved={attemptId:ID(41),deck:words.map(w=>w.id),revision:2,state:{deck:words.map(w=>w.id),index:1,correct:1}};
 try{
  h.stub({
   '/api/vocabulary/folders':{folders:[{id:folder,name:'My folder',count:2}]},
   '/api/vocabulary/packs':{packs:[]},
   '/api/vocabulary/games/attempt':(path,options)=>{
    if(options.method==='POST'){
     assert.equal(options.body.action,'save');
     saved={...saved,revision:saved.revision+1,state:options.body.state};
    }
    return {ok:true,attempt:saved};
   },
   '/api/vocabulary/games':(path,options)=>{
    assert.equal(options.method??'GET','GET');
    return {ok:true,words,total:2,due:0};
   },
  });
  mountGames(h.ctx,h.ctx.root,'translation');
  await tick(15);
  assert.match(h.q('[data-translation-prompt]')?.textContent??'','hal qilmoq');
  assert(h.q('[data-game-restart]'));
  assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
 }finally{h.dispose();}
});

test('Explicit retry starts a new attempt without clearing the previous attempt',async()=>{
 const h=setup({path:'/app/vocabulary/games/translation?set=folder&folderId='+folder,locale:'uz',role:'student'});
 let attempt={attemptId:ID(41),deck:words.map(w=>w.id),revision:2,state:{deck:words.map(w=>w.id),index:1,correct:1}};
 const previous=structuredClone(attempt);let starts=0;
 try{
  h.stub({
   '/api/vocabulary/folders':{folders:[{id:folder,name:'My folder',count:2}]},
   '/api/vocabulary/packs':{packs:[]},
   '/api/vocabulary/games/attempt':(path,options)=>{
    if(options.method==='POST'&&options.body.action==='start'){
     starts++;
     assert.deepEqual(options.body.deck,previous.deck);
     attempt={attemptId:ID(42),deck:words.map(w=>w.id),revision:0,state:{}};
    }
    return {ok:true,attempt};
   },
   '/api/vocabulary/games':{ok:true,words,total:2,due:0},
  });
  mountGames(h.ctx,h.ctx.root,'translation');
  await tick(15);
  h.click(h.q('[data-game-restart]'));
  await tick(20);
  assert.equal(starts,1);
  assert.equal(previous.attemptId,ID(41));
  assert.equal(previous.state.correct,1);
  assert.match(h.q('[data-translation-prompt]')?.textContent??'','aniqlashtirmoq');
 }finally{h.dispose();}
});
