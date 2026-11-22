import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount} from '../modules/vocabulary/index.js';
import {mountGames} from '../modules/vocabulary/games.js';
import {moduleLayout} from '../modules/shell/module-layout.js';

const word={id:ID(81),term:'climate',definitionEn:'Typical weather',translationUz:'iqlim',mastery:'new'};
function stub(h){
 h.stub({
  '/api/vocabulary/folders':{ok:true,folders:[]},
  '/api/vocabulary/packs':{ok:true,packs:[]},
  '/api/vocabulary/summary':{ok:true,summary:{total:1,due:0,byMastery:{new:1},bySource:{manual:1}}},
  '/api/vocabulary/leaderboard':{ok:true,points:0,rank:0,streak:0,name:'Learner',top:[]},
  '/api/vocabulary/sentences':{ok:true,words:[],sentences:[],hasMore:false},
  '/api/vocabulary/games':{ok:true,total:1,due:0,words:[word]},
  '/api/vocabulary':{ok:true,words:[word],hasMore:false}
 });
}

test('all Vocabulary tabs use one existing shell navigation, without an extra in-page tab row',async()=>{
 for(const tab of ['words','revision','use','board','dictionary']){
  const path=tab==='words'?'/app/vocabulary':'/app/vocabulary?tab='+tab;
  const h=setup({path,role:'student',locale:'uz'});
  try{
   stub(h);
   const staging=document.createElement('div');
   mount({...h.ctx,root:staging});
   h.ctx.root.append(moduleLayout(h.ctx,[...staging.childNodes]));
   await tick(8);
   assert.equal(h.qa('[data-module-sections="vocabulary"]').length,1,tab);
   assert.equal(h.qa('[data-vocabulary-hub-tabs]').length,0,tab);
   assert.equal(h.qa('[data-vocabulary-hub-tab]').length,0,tab);
   assert.equal(h.qa('[data-module-section]').length,6,tab);
  }finally{h.dispose();}
 }
});

test('Games library relies on shell navigation and has no redundant Lug‘at return button',async()=>{
 for(const locale of ['uz','en']){
  const h=setup({path:'/app/vocabulary/games?set=all',role:'student',locale});
  try{
   stub(h);
   const staging=document.createElement('div');
   mountGames(h.ctx,staging);
   h.ctx.root.append(moduleLayout(h.ctx,[...staging.childNodes]));
   await tick(12);
   assert.equal(h.qa('[data-module-sections="vocabulary"]').length,1);
   assert.equal(h.qa('[data-vocabulary-hub-tabs]').length,0);
   assert.equal(h.qa('[data-games-back-to-vocabulary]').length,0);
   assert.equal(h.qa('[data-game-back]').length,0);
   const cards=h.q('[data-vocabulary-games]');
   const note=h.q('[data-games-practice-note]');
   assert(cards&&note);
   assert.equal(cards.querySelectorAll('[data-game]').length,7);
   assert(cards.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING);
   assert.equal(note.querySelectorAll('h2').length,1);
   assert.match(note.textContent,locale==='uz'?/Takrorlash bo‘limida/:/scheduled Revision/);
   assert(!note.textContent.includes(h.ctx.dict.vocabulary.games.casualNote));
  }finally{h.dispose();}
 }
});

test('individual games retain the intended back-to-Games link without extra navigation',async()=>{
 const h=setup({path:'/app/vocabulary/games/choice?set=all',role:'student',locale:'uz'});
 try{
  stub(h);
  mountGames(h.ctx,h.ctx.root,'choice');
  assert.equal(h.qa('[data-game-back]').length,1);
  assert.match(h.q('[data-game-back]').getAttribute('href'),/^\/app\/vocabulary\/games\?set=all$/);
  assert.equal(h.qa('[data-games-back-to-vocabulary]').length,0);
  assert.equal(h.qa('[data-vocabulary-hub-tabs]').length,0);
 }finally{h.dispose();}
});

test('Games practice explanation has a clearly separated, theme-aware footer style',()=>{
 const css=readFileSync(fileURLToPath(new URL('../css/global.css',import.meta.url)),'utf8');
 assert.match(css,/\.vocabulary-games-practice-note\s*\{/);
 assert.match(css,/margin-top:clamp\(36px,4\.5vw,64px\)/);
 assert.match(css,/border-top:1px solid rgb\(var\(--ink-100\)\)/);
});
