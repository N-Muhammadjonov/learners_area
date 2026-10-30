import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {createRouter,compilePattern} from '../js/router.js';
import {createRouteReuse} from '../js/route-reuse.js';
import {createPrivateScope,privateScope} from '../js/private-scope.js';
import {viewData,viewSnapshot} from '../js/adapters/frontend.js';
import {presentationKey,affectsLearningData} from '../js/cache-policy.js';
import {createApi} from '../js/api-client.js';
import {mount as writingHome} from '../modules/writing/home.js';
import {trendCards} from '../modules/progress/trends.js';
import {sectionHeader} from '../modules/shell/section-header.js';

test('memory freshness, stale windows, byte limits and identity changes are independent',()=>{
 let time=0;const scope=createPrivateScope({clock:()=>time,maxBytes:100});scope.setScope('A');scope.put('snapshot',{score:7},{ttl:5,staleTtl:10});time=6;assert.equal(scope.get('snapshot'),undefined);assert.equal(scope.inspect('snapshot').value.score,7);assert(scope.inspect('snapshot').stale);scope.put('large','x'.repeat(100));assert.equal(scope.size,1);time=16;assert.equal(scope.inspect('snapshot'),undefined);assert.equal(scope.bytes,0);scope.put('new',{id:'A'});scope.setScope('B');assert.equal(scope.size,0);
});

test('presence and display preferences preserve data; real mutations invalidate it',()=>{
 for(const path of ['/api/presence','/api/theme','/api/locale'])assert.equal(affectsLearningData(path),false);
 for(const path of ['/api/reading/attempts/id/submit','/api/vocabulary','/api/profile','/api/auth/logout','/api/admin/content'])assert.equal(affectsLearningData(path),true);
});

test('settled passive views retain DOM and listeners, then purge on account switch',async()=>{
 const h=setup({role:'student',path:'/app/reading/lessons'});let actor='A',mounts=0,clicks=0,disposed=0;privateScope.setScope(actor);
 const reuse=createRouteReuse({limit:2}),load=async()=>({mount:c=>{mounts++;const box=document.createElement('section'),button=document.createElement('button');button.textContent=actor;button.onclick=()=>clicks++;box.append(button);c.root.append(box);return()=>disposed++;}});
 const routes=['/app/reading/lessons','/app/listening/lessons'].map(pattern=>({pattern,protected:true,match:compilePattern(pattern),load}));
 const router=createRouter({root:h.ctx.root,routes,reuse,window,prepare:async()=>({session:{user:{id:actor},expiresAt:9999999999}}),onError:e=>{throw e;}});
 try{await router.start();const button=h.q('button');button.click();await router.go('/app/listening/lessons');await router.back('/app/reading/lessons');await tick();assert.equal(h.q('button'),button);button.click();assert.equal(clicks,2);assert.equal(mounts,2);actor='B';privateScope.setScope(actor);await router.go('/app/reading/lessons');assert.equal(h.q('button').textContent,'B');assert(!h.q('button').isSameNode(button));assert(disposed>=2);}finally{router.destroy();h.dispose();}
});

test('reuse is bounded and excludes media, active exams, unfinished work and locale changes',()=>{
 const h=setup({role:'student'}),scope=createPrivateScope();scope.setScope('A');const pool=createRouteReuse({scope,limit:1,maxNodes:10});
 const entry=(path,html)=>{const staging=document.createElement('div');staging.innerHTML=html;return {context:{url:new URL(path,'https://fixture.invalid'),session:{},route:{protected:true}},nodes:[...staging.children],staging,controller:new AbortController(),...pool.stamp()};};
 try{for(const html of ['<section><audio></audio></section>','<section><textarea></textarea></section>','<section><p role="status">Loading</p></section>'])assert(!pool.eligible(entry('/app/reading/lessons',html)));assert(!pool.eligible(entry('/app/reading/attempts/private','<section>Exam</section>')));const first=entry('/app/reading/lessons','<section>A</section>');pool.put('a',first);pool.put('b',entry('/app/listening/lessons','<section>B</section>'));assert.equal(pool.size,1);assert(first.controller.signal.aborted);document.documentElement.lang='uz';assert.equal(pool.take('b'),undefined);assert.equal(pool.size,0);}finally{pool.destroy();h.dispose();}
});

test('parallel public module loading never mounts before authorization or after rapid navigation',async()=>{
 const h=setup({role:'student',path:'/app/reading/lessons'});let authorize,loads=0,mounts=0;const gate=new Promise(r=>authorize=r),load=async()=>{loads++;return {mount:c=>{mounts++;c.root.textContent='ready';}};};
 const router=createRouter({root:h.ctx.root,routes:[{pattern:'/app/reading/lessons',protected:true,load},{pattern:'/login',load}],window,prepare:c=>c.url.pathname==='/login'?{}:gate,onError:e=>{throw e;}});
 try{const old=router.start();await tick();assert.equal(loads,1);assert.equal(mounts,0);await router.go('/login');authorize({session:{user:{id:'A'}}});await old;assert.equal(mounts,1);assert.equal(h.ctx.root.textContent,'ready');}finally{router.destroy();h.dispose();}
});

test('late personalized responses reject across accounts and expired snapshots do not display',async()=>{
 const h=setup({role:'student'});let release;privateScope.setScope('A');h.stub({'/api/frontend/view':()=>new Promise(r=>release=r)});
 try{const result=viewData('/app/progress',h.ctx.signal,'progressStreak');privateScope.setScope('B');release({version:1,route:'/app/progress',region:'progressStreak',data:{progressStreak:{streak:9}}});await assert.rejects(result,e=>e.name==='AbortError');assert.equal(privateScope.size,0);const path='/api/frontend/view?route=%2Fapp%2Fprogress&region=progressStreak';privateScope.put(presentationKey('view',path),{progressStreak:{streak:2}},{ttl:0,staleTtl:10000});assert(viewSnapshot('/app/progress','progressStreak').stale);assert.equal(viewSnapshot('/app/listening/attempts/private'),undefined);}finally{h.dispose();}
});

test('prefetch byte limits do not fail a concurrent intentional full read',async()=>{
 const client=createApi(async()=>new Response(JSON.stringify({value:'x'.repeat(1000)}),{headers:{'Content-Type':'application/json'}}));
 const limited=client.request('/api/catalogue',{maxBytes:40}),normal=client.request('/api/catalogue');await assert.rejects(limited,e=>e.code==='prefetch_limit');assert.equal((await normal).value.length,1000);client.clear();
});

test('Writing inner tabs preserve the workspace and tab controls across history navigation',async()=>{
 const h=setup({role:'student',path:'/app/writing?tab=lessons'});let mounts=0;const OriginalAbort=globalThis.AbortController;globalThis.AbortController=window.AbortController;
 h.stub({'/api/frontend/view':path=>({version:1,route:new URL(path,'https://fixture.invalid').searchParams.get('route'),data:{lessons:[],sets:[],aiReady:false,available:false}})});
 const router=createRouter({root:h.ctx.root,routes:[{pattern:'/app/writing',protected:true,load:async()=>({mount:c=>{mounts++;writingHome(c);}})}],window,prepare:async()=>({dict:h.ctx.dict,locale:'en',session:{...h.ctx.session,expiresAt:9999999999}}),onError:e=>{throw e;}});
 try{await router.start();await tick(8);const host=h.q('[data-writing-native]'),tabs=h.q('[data-writing-tablist]');await router.go('/app/writing?tab=translation',{focus:'[data-writing-tab=translation]'});await tick(8);assert.equal(h.q('[data-writing-native]'),host);assert.equal(h.q('[data-writing-tablist]'),tabs);assert.equal(host.dataset.writingActiveTab,'translation');assert.equal(mounts,1);window.history.back();await tick(12);assert.equal(host.dataset.writingActiveTab,'lessons');assert.equal(mounts,1);}finally{router.destroy();h.dispose();globalThis.AbortController=OriginalAbort;}
});

test('soft Writing navigation updates its header title while retaining the live tab list',()=>{
 const h=setup({role:'student',path:'/app/writing?tab=lessons'});globalThis.MutationObserver=window.MutationObserver;
 try{const header=sectionHeader(h.ctx),content=document.createElement('div'),tabs=document.createElement('nav');tabs.dataset.writingTablist='';content.append(tabs);h.ctx.root.append(header.node,content);header.attach(content);header.updateLocation(new URL('/app/writing?tab=translation',window.location.origin));assert.equal(header.node.querySelector('[data-writing-tablist]'),tabs);assert.equal(header.node.querySelector('[data-module-section-heading]').dataset.moduleSectionHeading,'writing:translation');}finally{h.dispose();}
});

test('an unavailable Retention series does not crash all other Progress trends',()=>{
 const h=setup({role:'student'});try{const node=trendCards({reading:[],listening:[],writing:[],speaking:[],heatmap:[],retention:null},h.ctx.dict);assert(node.querySelector('[data-trend-unavailable]'));assert(node.querySelector('[data-trend="reading"]'));}finally{h.dispose();}
});

test('eight passive routes survive 59 seconds, evict the least recent view, and expire at 60 seconds',()=>{
 const h=setup({role:'student'}),scope=createPrivateScope();scope.setScope('A');let time=0;
 const pool=createRouteReuse({scope,clock:()=>time}),paths=['/app/dashboard','/app/progress','/app/reading/lessons','/app/reading/academic','/app/reading/general','/app/listening/lessons','/app/listening/academic','/app/grammar/lessons'];
 const entry=path=>{const staging=document.createElement('div');staging.innerHTML='<section><button>Catalogue</button></section>';return {context:{url:new URL(path,'https://fixture.invalid'),session:{},route:{protected:true}},nodes:[...staging.children],staging,controller:new AbortController(),...pool.stamp()};};
 try{
  const views=paths.map(path=>entry(path));paths.forEach((path,i)=>assert(pool.put(path,views[i])));assert.equal(pool.size,8);
  // 45 seconds previously expired the view. Retained DOM now survives this revisit.
  time=59000;const reused=pool.take(paths[0]);assert.equal(reused,views[0]);assert.equal(reused.nodes[0].querySelector('button').textContent,'Catalogue');assert(pool.put(paths[0],reused));
  assert(pool.put('/app/video-lessons',entry('/app/video-lessons')));assert.equal(pool.size,8);assert(views[1].controller.signal.aborted);assert(!views[0].controller.signal.aborted);
  time=60000;assert.equal(pool.take(paths[0]),undefined);assert(views[0].controller.signal.aborted);
  scope.setScope('B');assert.equal(pool.size,0);assert.equal(pool.nodeCount,0);
 }finally{pool.destroy();h.dispose();}
});

test('the enlarged DOM budget accepts a 9001-node catalogue but still bounds total retained nodes',()=>{
 const h=setup({role:'student'}),scope=createPrivateScope();scope.setScope('A');const pool=createRouteReuse({scope});
 const entry=(path,count)=>{const staging=document.createElement('div');staging.innerHTML='<section>'+('<i></i>'.repeat(count))+'</section>';return {context:{url:new URL(path,'https://fixture.invalid'),session:{},route:{protected:true}},nodes:[...staging.children],staging,controller:new AbortController(),...pool.stamp()};};
 try{
  const large=entry('/app/reading/academic',9000);assert(pool.put('large',large));assert.equal(pool.nodeCount,9001);
  assert(pool.put('next',entry('/app/listening/academic',8000)));assert(large.controller.signal.aborted);assert.equal(pool.size,1);assert.equal(pool.nodeCount,8001);
  assert.equal(pool.put('oversize',entry('/app/grammar/lessons',16000)),false);assert.equal(pool.nodeCount,8001);
 }finally{pool.destroy();h.dispose();}
});
