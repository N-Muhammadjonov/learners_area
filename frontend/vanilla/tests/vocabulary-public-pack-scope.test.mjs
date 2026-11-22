import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount} from '../modules/vocabulary/index.js';

function stubVocabulary(h) {
 h.stub({
  '/api/vocabulary/folders':{ok:true,folders:[]},
  '/api/vocabulary/packs':{ok:true,packs:[]},
  '/api/vocabulary/summary':{ok:true,summary:{
   total:1,due:0,byMastery:{new:1},bySource:{manual:1}
  }},
  '/api/vocabulary/leaderboard':{ok:true,points:0,rank:null,streak:0,top:[]},
  '/api/vocabulary/sentences':{ok:true,words:[],sentences:[],hasMore:false},
  '/api/vocabulary':{ok:true,words:[{
   id:ID(20),term:'climate',definitionEn:'Typical weather conditions',
   translationUz:'iqlim',mastery:'new'
  }],hasMore:false}
 });
}

test('owner public-pack publisher appears in My words only; switching tabs retains the unpublished draft',async()=>{
 const h=setup({path:'/app/vocabulary',role:'owner',locale:'uz'});
 let navigate,history;
 try{
  h.ctx.onNavigate=callback=>{navigate=callback;};
  h.ctx.onHistory=callback=>{history=callback;};
  stubVocabulary(h);
  mount(h.ctx);
  await tick(8);

  const host=h.q('[data-owner-public-pack]');
  const publisher=h.q('[data-public-pack-publisher]');
  assert(host&&publisher,'owner should see the publisher in My words');
  assert.equal(host.hidden,false);
  const slug=publisher.querySelector('input[aria-label="Pack identifikatori"]');
  const title=publisher.querySelector('input[aria-label="Inglizcha nom"]');
  const body=publisher.querySelector('textarea');
  h.input(slug,'climate_change');
  h.input(title,'Climate change');
  h.input(body,'unsent draft');
  assert.equal(typeof navigate,'function');
  assert.equal(typeof history,'function');

  for(const tab of ['revision','use','board','dictionary']){
   assert.equal(navigate(new URL('https://fixture.invalid/app/vocabulary?tab='+tab)),true);
   await tick(4);
   assert.equal(host.hidden,true,tab+' must hide the owner publisher');
   assert.equal(h.q('[data-public-pack-publisher]'),publisher,'publisher should not be remounted');
   assert.equal(h.q('[data-vocabulary-panel]')?.dataset.vocabularyPanel??h.q('#vocabulary-panel')?.dataset.vocabularyPanel,tab);
  }
  assert.equal(history(new URL('https://fixture.invalid/app/vocabulary')),true);
  await tick(6);
  assert.equal(host.hidden,false,'returning to My words must reveal the publisher');
  assert.equal(h.q('[data-public-pack-publisher]'),publisher);
  assert.equal(slug.value,'climate_change');
  assert.equal(title.value,'Climate change');
  assert.equal(body.value,'unsent draft');
  assert.equal(h.qa('[data-public-pack-publisher]').length,1,'there must be no duplicate publisher');
 }finally{h.dispose();}
});

test('non-owner roles cannot see or publish public packs from any vocabulary tab',async()=>{
 for(const role of ['student','teacher','admin']){
  const h=setup({path:'/app/vocabulary',role});
  let navigate;
  try{
   h.ctx.onNavigate=callback=>{navigate=callback;};
   stubVocabulary(h);
   mount(h.ctx);
   await tick(6);
   assert.equal(h.q('[data-public-pack-publisher]'),null,role+' is not the owner');
   for(const tab of ['revision','use','board','dictionary']){
    assert.equal(navigate(new URL('https://fixture.invalid/app/vocabulary?tab='+tab)),true);
    await tick(3);
    assert.equal(h.q('[data-public-pack-publisher]'),null,role+' on '+tab);
   }
   assert(!h.calls.some(call=>call.path==='/api/vocabulary/packs/public'));
  }finally{h.dispose();}
 }
});

test('dedicated Games route has no owner public-pack publisher',async()=>{
 const h=setup({path:'/app/vocabulary/games',role:'owner'});
 try{
  stubVocabulary(h);
  h.stub({
   '/api/vocabulary/folders':{ok:true,folders:[]},
   '/api/vocabulary/packs':{ok:true,packs:[]},
   '/api/vocabulary/games':{ok:true,words:[],total:0,due:0}
  });
  mount(h.ctx);
  await tick(8);
  assert.equal(h.q('[data-public-pack-publisher]'),null);
  assert(h.q('[data-vocabulary-games]'));
 }finally{h.dispose();}
});
