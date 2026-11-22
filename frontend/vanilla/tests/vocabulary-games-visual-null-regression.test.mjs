import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountGames,GAME_ICONS,GAME_CONTINUE_UZ,gameContinueLabel} from '../modules/vocabulary/games.js';
import {GAMES} from '../modules/vocabulary/shared.js';

const words=Array.from({length:10},(_,i)=>({
 id:ID(i+610),term:'term'+(i+1),definitionEn:'Definition for term '+(i+1),
 translationUz:'tarjima '+(i+1),exampleSentence:'The term'+(i+1)+' is useful.',
 collocations:'term use',acceptedTranslations:[]
}));

function fixture(h) {
 let attempt=null;
 h.stub({
  '/api/vocabulary/folders':{ok:true,folders:[]},
  '/api/vocabulary/packs':{ok:true,packs:[]},
  '/api/vocabulary/games':(path,options={})=>{
   const query=new URL(path,'https://fixture.invalid').searchParams;
   if(options.method==='POST') {
    if(options.body.action==='start'){
     attempt={attemptId:ID(990),revision:0,deck:options.body.deck,state:options.body.state};
     return {ok:true,attempt};
    }
    if(options.body.action==='save') {
     attempt={...attempt,revision:attempt.revision+1,state:options.body.state};
     return {ok:true,attempt};
    }
    return {ok:true,verified:true,correct:true,awarded:0,srsUntouched:true};
   }
   if(query.get('attempt')==='1')return {ok:true,attempt};
   return {ok:true,words,total:words.length,due:0,batchIndex:0,
    batches:[{index:0,count:words.length,known:0,complete:false,unlocked:true}],
    selfAssessments:{}};
  }
 });
}

test('game hub contains seven named gradient tiles, emoji icons, and no null placeholder',async()=>{
 for(const locale of ['uz','en']) {
  const h=setup({path:'/app/vocabulary/games?set=all',role:'student',locale});
  try {
   fixture(h);mountGames(h.ctx,h.ctx.root);
   await tick(14);
   const tiles=h.qa('[data-vocabulary-games] .vocabulary-game-tile');
   assert.equal(tiles.length,7);
   for(const key of GAMES){
    const tile=h.q('[data-vocabulary-games] [data-game="'+key+'"]');
    assert(tile);
    assert.equal(tile.querySelector('.vocabulary-game-tile-icon').textContent,GAME_ICONS[key]);
   }
   assert.doesNotMatch(h.ctx.root.textContent,/(^|\W)null(\W|$)/i);
  }finally{h.dispose();}
 }
});

test('six handoff controls in each of seven games render one complete Uzbek label and the correct emoji',async()=>{
 for(const current of GAMES) {
  const h=setup({path:'/app/vocabulary/games/'+current+'?set=all',role:'student',locale:'uz'});
  try {
   fixture(h);mountGames(h.ctx,h.ctx.root,current);
   await tick(18);
   const buttons=h.qa('[data-game-switch]');
   assert.equal(buttons.length,6,current);
   assert.equal(h.q('[data-game-switch="'+current+'"]'),null);
   for(const key of GAMES.filter(k=>k!==current)){
    const node=h.q('[data-game-switch="'+key+'"]');
    assert(node,current+' -> '+key);
    assert.equal(node.dataset.game,key);
    assert.equal(node.querySelector('.vocabulary-game-switch-icon').textContent,GAME_ICONS[key]);
    assert.equal(node.querySelector('.vocabulary-game-switch-label').textContent,GAME_CONTINUE_UZ[key]);
    assert.equal(node.textContent,GAME_ICONS[key]+GAME_CONTINUE_UZ[key]);
    assert.equal(node.querySelector('.vocabulary-game-switch-action'),null);
   }
   assert.doesNotMatch(h.ctx.root.textContent,/(^|\W)null(\W|$)/i,current+' must not render null');
  }finally{h.dispose();}
 }
});

test('English handoff names are complete phrases and do not contain a detached suffix',()=>{
 for(const key of GAMES) {
  assert.equal(gameContinueLabel('en',key,'Example name'),'Continue in Example name');
  assert.equal(gameContinueLabel('uz',key,'Example name'),GAME_CONTINUE_UZ[key]);
  assert.match(GAME_CONTINUE_UZ[key],/da davom ettirish$/);
 }
});

test('handoff buttons share source tile gradients with accessible states and a mobile layout',()=>{
 const css=readFileSync(fileURLToPath(new URL('../css/global.css',import.meta.url)),'utf8');
 for(const key of GAMES.slice(1)){
  assert(css.includes('.vocabulary-game-switch-button[data-game="'+key+'"]'),key+' must have the same color as its hub tile');
 }
 assert.match(css,/\.vocabulary-game-switch-icon\s*\{/);
 assert.match(css,/\.vocabulary-game-switch-label\s*\{/);
 assert.match(css,/\.vocabulary-game-switch-button:focus-visible/);
 assert.match(css,/@media\(max-width:390px\)/);
});
