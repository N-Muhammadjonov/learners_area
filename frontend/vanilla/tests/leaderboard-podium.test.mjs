import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {privateScope} from '../js/private-scope.js';
import {mount} from '../modules/study-plan/motivation.js';

let dom,controller,root,originalRequest;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const standings=count=>Array.from({length:count},(_,i)=>({
  rank:i+1,alias:'Learner-'+String(i+1).padStart(6,'0'),
  stars:Math.max(0,count-i-1),coins:Math.max(0,count-i-1)*2,
  practiceMs:(count-i-1)*60000,premium:i%3===0,mine:false,
}));
function context(){
  return {root,signal:controller.signal,locale:'uz',
    dict:{common:{loading:'Yuklanmoqda'},errors:{unknown:'Xatolik'},
      errorPage:{retry:'Qayta urinish'}},
    url:new URL('https://fixture.invalid/app/leaderboard'),
    session:{user:{role:'owner',id:'fixture-owner'}}};
}
function response(entries){
  return {standings:entries,entries:entries.map(({alias,rank,stars})=>({
    alias,rank,points:stars,mine:false
  })),classAvailable:false,alias:null,position:null,hasMore:false,policy:{rules:[],limits:[]}};
}
beforeEach(()=>{
  dom=new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',
    {url:'https://fixture.invalid/app/leaderboard',pretendToBeVisual:true});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.Node=dom.window.Node;globalThis.HTMLElement=dom.window.HTMLElement;
  root=document.getElementById('root');controller=new AbortController();
  originalRequest=api.request;privateScope.clear();
});
afterEach(()=>{
  controller.abort();api.request=originalRequest;privateScope.clear();
  dom.window.close();
});

test('Top 20 shows distinct rank 2, 1, 3 podium and remaining table rows',async()=>{
  const requests=[];
  api.request=async path=>{
    requests.push(path);return response(standings(20));
  };
  mount(context());await flush();
  assert.equal(requests.length,1);
  const board=root.querySelector('[data-study-leaderboard]');
  assert(board);
  const positions=[...board.querySelectorAll('[data-coin-podium] [data-place]')]
    .map(row=>Number(row.dataset.place));
  assert.deepEqual(positions,[2,1,3]);
  const ranks=[...board.querySelectorAll('[data-study-rank]')]
    .map(row=>Number(row.dataset.studyRank));
  assert.deepEqual(ranks,Array.from({length:17},(_,i)=>i+4));
  assert.equal(board.querySelector('[data-leaderboard-visible-count]').textContent,
    'Top 20 · 20 ta faol o‘quvchi');
  assert.equal(board.querySelectorAll('[data-study-rank]').length+positions.length,20);
  assert.equal(board.querySelector('.coin-ranking-pagination'),null);
});

test('only real participants render: four active users means three podium and one table row',async()=>{
  api.request=async()=>response(standings(4));
  mount(context());await flush();
  assert.equal(root.querySelectorAll('[data-coin-podium] article').length,3);
  assert.equal(root.querySelectorAll('[data-study-rank]').length,1);
  assert.match(root.textContent,/4 ta faol o‘quvchi/);
  assert(!root.textContent.includes('Learner-000005'));
});

test('malformed extra leaderboard entries cannot create ranks beyond twentieth',async()=>{
  api.request=async()=>response(standings(25));
  mount(context());await flush();
  assert.equal(root.querySelectorAll('[data-coin-podium] article').length,3);
  assert.equal(root.querySelectorAll('[data-study-rank]').length,17);
  assert.equal(root.querySelector('[data-study-rank="21"]'),null);
});

test('no eligible users stays a real empty state, without fabricated podium winners',async()=>{
  api.request=async()=>response([]);
  mount(context());await flush();
  assert.equal(root.querySelector('[data-coin-podium]'),null);
  assert.match(root.textContent,/Bu davrda ishtirokchilar yo‘q/);
});
