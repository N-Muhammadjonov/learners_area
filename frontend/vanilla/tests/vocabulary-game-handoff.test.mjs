import test from 'node:test';
import assert from 'node:assert/strict';
import {nextHandoffWord,handoffSlice,handoffSourceDeck,mergeHandoffState} from '../modules/vocabulary/game-handoff.js';

const source=Array.from({length:24},(_,i)=>'word-'+(i+1));

test('all seven games resume at the next uncompleted source word',()=>{
 for(const game of ['cards','choice','gap','race','translation','builder']){
  const state={deck:source.slice(8,18),index:3};
  assert.equal(nextHandoffWord(game,state,source),'word-12',game);
  assert.equal(nextHandoffWord(game,{...state,index:10},source),'word-19',game+' after a completed 10-word round');
 }
 const board={left:source.slice(10,16),right:source.slice(10,16).reverse(),matched:['word-11','word-12']};
 assert.equal(nextHandoffWord('match',board,source),'word-13');
 assert.equal(nextHandoffWord('match',{...board,matched:board.left},source),'word-17');
});

test('an exhausted group never silently restarts or duplicates earlier words',()=>{
 assert.equal(nextHandoffWord('cards',{deck:source,index:24},source),null);
 assert.equal(nextHandoffWord('race',{deck:source.slice(14),index:10},source),null);
 assert.deepEqual(handoffSlice(source,'word-12').slice(0,4),['word-12','word-13','word-14','word-15']);
 assert.deepEqual(handoffSlice(source,'missing'),[]);
 assert.deepEqual(handoffSlice(source,'word-23'),['word-23','word-24']);
});

test('server attempt state preserves the full pack section across mode changes and reload',()=>{
 const state=mergeHandoffState('choice',{deck:source.slice(5,15),index:3,correct:2},source,2);
 assert.deepEqual(state._handoff.sourceDeck,source);
 assert.equal(state._handoff.batchIndex,2);
 const attempt={deck:source.slice(5,15),state};
 assert.deepEqual(handoffSourceDeck(attempt),source);
 assert.equal(nextHandoffWord('choice',attempt.state,handoffSourceDeck(attempt)),'word-9');
 assert.deepEqual(mergeHandoffState('builder',{deck:source.slice(8,12),index:0,_handoff:state._handoff},source.slice(8,12),2)._handoff.sourceDeck,source);
});

test('flashcard initial shuffle becomes its persisted source order',()=>{
 const shuffled=['word-3','word-1','word-2'];
 const state=mergeHandoffState('cards',{deck:shuffled,index:1},source.slice(0,3),0);
 assert.deepEqual(state._handoff.sourceDeck,shuffled);
 assert.equal(nextHandoffWord('cards',state,state._handoff.sourceDeck),'word-1');
});

test('matching pairs resume their unmatched word even when clicked out of order',()=>{
 const state={left:source.slice(4,10),matched:['word-5','word-8','word-9']};
 assert.equal(nextHandoffWord('match',state,source),'word-6');
 assert.equal(nextHandoffWord('match',{left:[],matched:[]},source),'word-1');
});
