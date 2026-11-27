import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountGames} from '../modules/vocabulary/games.js';
import {ApiError} from '../js/api-client.js';

const group=Array.from({length:14},(_,index)=>({
 id:ID(100+index),term:'term '+(index+1),
 definitionEn:'distinct meaning '+(index+1),translationUz:'tarjima '+(index+1),
 exampleSentence:'The term '+(index+1)+' appears.',acceptedTranslations:[]
}));
const sourceAttempt={
 attemptId:ID(800),revision:3,deck:group.map(word=>word.id),
 state:{deck:group.map(word=>word.id),index:2,pass:1,
  _handoff:{sourceDeck:group.map(word=>word.id),batchIndex:2}}
};
const section={ok:true,batchIndex:2,total:152,due:0,words:group,
 selfAssessments:{},batches:[{index:2,count:14,complete:false,unlocked:true}]};
function fixtures(initialAttempt=sourceAttempt,targetAttempt=null){
 let attempt=null;const starts=[];
 return {
  starts,
  routes:{
   '/api/vocabulary/folders':{ok:true,folders:[]},
   '/api/vocabulary/packs':{ok:true,packs:[{id:'environment',label:'Environment',wordCount:152,added:true}]},
   '/api/vocabulary/games':(path,options={})=>{
    if(options.method==='POST'){
     const body=options.body;
     if(body.action==='start'){
      starts.push(body);
      attempt={attemptId:ID(801),deck:body.deck,revision:0,state:body.state};
      return {ok:true,attempt};
     }
     if(body.action==='save'){
      attempt={...attempt,revision:attempt.revision+1,state:body.state};
      return {ok:true,attempt};
     }
     return {ok:true,verified:true,correct:true,awarded:0,srsUntouched:true};
    }
    const url=new URL(path,'https://fixture.invalid');
    if(url.searchParams.get('attempt')==='1'){
     return {ok:true,attempt:url.searchParams.get('gameId')==='cards'?initialAttempt:targetAttempt??attempt};
    }
    if(url.searchParams.get('batches')==='1')return section;
    const ids=url.searchParams.get('entryIds');
    const chosen=ids?ids.split(',').map(id=>group.find(w=>w.id===id)).filter(Boolean):group;
    return {ok:true,total:152,due:0,words:chosen};
   }
  }
 };
}

test('Games lists added topic packs and falls back to Due today when none are added',async()=>{
 for(const added of [true,false]){
  const h=setup({path:'/app/vocabulary/games?set=topic&topicPack=public&batch=3',role:'student'});
  try{
   const f=fixtures();
   h.stub({...f.routes,'/api/vocabulary/packs':{ok:true,packs:[
    {id:'public',label:'Public',wordCount:12,added:false},
    {id:'environment',label:'Environment',wordCount:152,added}
   ]}});
   mountGames(h.ctx,h.ctx.root);await tick(10);
   const params=new URL(window.location.href).searchParams;
   assert.equal(params.get('batch'),null);
   assert.equal(h.q('[data-game-set]').value,added?'topic':'due');
   if(added)assert.deepEqual([...h.q('[data-game-topic-pack]').options].map(option=>option.value),['environment']);
   else assert.equal(h.q('[data-game-topic-pack]'),null);
   assert(!h.calls.some(call=>call.path.includes('topicPack=public')));
  }finally{h.dispose();}
 }
});

test('a stale Due today batch and saved deck recover to the current topic pack group',async()=>{
 const h=setup({path:'/app/vocabulary/games/cards?set=due&batch=9',role:'student'});
 try{
  const f=fixtures();const route=f.routes['/api/vocabulary/games'];
  h.stub({...f.routes,'/api/vocabulary/games':(path,options)=>{
   const query=new URL(path,'https://fixture.invalid').searchParams;
   if(query.get('batch')==='9')return new ApiError(404,'batch_not_found');
   if(query.get('batches')==='1')return {...section,batchIndex:0,batches:[{index:0,count:14,label:'Travel arrangements',unlocked:true}]};
   if(query.get('attempt')==='1')return {ok:true,attempt:{...sourceAttempt,deck:[group[0].id]}};
   return route(path,options);
  }});
  mountGames(h.ctx,h.ctx.root,'cards');await tick(18);
  assert.equal(h.q('[data-game-set]').value,'due');
  assert.equal(new URL(window.location.href).searchParams.get('batch'),'0');
  assert.match(h.q('[data-flashcard-batch]').textContent,/Travel arrangements/);
  assert.equal(h.qa('[data-card-queue-item]').length,group.length);
  assert.equal(f.starts.length,1);
 }finally{h.dispose();}
});

test('flashcards switches to one of six games at the current section and word',async()=>{
 const h=setup({path:'/app/vocabulary/games/cards?set=topic&topicPack=environment&batch=2',role:'student'});
 try{
  const f=fixtures();h.stub(f.routes);
  mountGames(h.ctx,h.ctx.root,'cards');await tick(18);
  assert.equal(h.qa('[data-game-switch]').length,6);
  h.click(h.q('[data-game-switch=choice]'));await tick(8);
  assert.equal(h.nav.length,1);
  const destination=new URL(h.nav[0].path,'https://fixture.invalid');
  assert.equal(destination.pathname,'/app/vocabulary/games/choice');
  assert.equal(destination.searchParams.get('from'),'cards');
  assert.equal(destination.searchParams.get('batch'),'2');
  assert.equal(destination.searchParams.get('cursor'),group[2].id);
  assert.equal(f.starts.length,0);
 }finally{h.dispose();}
});

test('multiple choice inherits section cursor, scores one word and returns to flashcards without restarting',async()=>{
 const h=setup({path:'/app/vocabulary/games/choice?set=topic&topicPack=environment&batch=2&from=cards&cursor='+group[2].id,role:'student'});
 try{
  const f=fixtures();h.stub(f.routes);
  mountGames(h.ctx,h.ctx.root,'choice');await tick(20);
  assert.equal(f.starts.length,1);
  assert.equal(f.starts[0].deck[0],group[2].id);
  assert.equal(f.starts[0].deck.length,12);
  assert.equal(f.starts[0].state._handoff.sourceDeck.length,14);
  assert.match(h.q('[data-mcq-prompt]').textContent,/distinct meaning 3/);
  assert.equal(h.qa('[data-game-switch]').length,6);
  const right=h.qa('[data-option]').find(node=>node.dataset.option===group[2].term);
  assert(right);
  h.click(right);await tick(16);
  h.click(h.q('[data-game-switch=cards]'));await tick(8);
  assert.equal(h.nav.length,1);
  const target=new URL(h.nav[0].path,'https://fixture.invalid');
  assert.equal(target.searchParams.get('cursor'),group[3].id);
  assert.equal(target.searchParams.get('batch'),'2');
  assert.equal(target.searchParams.get('from'),'choice');
 }finally{h.dispose();}
});

test('missing source attempt cannot silently start another game at a random word',async()=>{
 const h=setup({path:'/app/vocabulary/games/match?set=topic&topicPack=environment&batch=2&from=cards&cursor='+group[2].id,role:'student'});
 try{
  const f=fixtures(null);h.stub(f.routes);
  mountGames(h.ctx,h.ctx.root,'match');await tick(18);
  assert(h.q('[data-game-load-retry]'));
  assert.equal(f.starts.length,0);
 }finally{h.dispose();}
});

test('reloading a handed-off game resumes the saved word and does not restart the group',async()=>{
 const saved={attemptId:ID(802),revision:5,deck:group.slice(2,12).map(w=>w.id),
  state:{deck:group.slice(2,12).map(w=>w.id),index:3,correct:2,
   _handoff:{sourceDeck:group.map(w=>w.id),batchIndex:2}}};
 const h=setup({path:'/app/vocabulary/games/choice?set=topic&topicPack=environment&batch=2',role:'student'});
 try{
  const f=fixtures(sourceAttempt,saved);h.stub(f.routes);
  mountGames(h.ctx,h.ctx.root,'choice');await tick(18);
  assert.match(h.q('[data-mcq-prompt]').textContent,/distinct meaning 6/);
  assert.equal(f.starts.length,0);
  h.click(h.q('[data-game-switch=cards]'));await tick(6);
  const target=new URL(h.nav[0].path,'https://fixture.invalid');
  assert.equal(target.searchParams.get('cursor'),group[5].id);
  assert.equal(target.searchParams.get('batch'),'2');
 }finally{h.dispose();}
});
