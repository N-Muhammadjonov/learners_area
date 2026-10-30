import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {createRouter,compilePattern} from '../js/router.js';
import {createRouteReuse} from '../js/route-reuse.js';
import {createPrivateScope} from '../js/private-scope.js';

function registered(path,load,progressiveMount=true){
 return {pattern:path,protected:true,progressiveMount,match:compilePattern(path),load:async()=>({mount:load})};
}
const authorized=async()=>({session:{user:{id:'user-a',role:'student',accountStatus:'active'},expiresAt:9999999999}});
test('authorized passive page commits its initial UI before data hydration completes',async()=>{
 const h=setup({role:'student',path:'/app/progress'});
 let resolve;
 const waiting=new Promise(r=>{resolve=r;});
 const router=createRouter({root:h.ctx.root,window,routes:[
  registered('/app/progress',async({root})=>{root.append(document.createElement('article'));await waiting;root.querySelector('article').textContent='Fetched data';})
 ],prepare:authorized,onError:e=>{throw e;}});
 try{
  const run=router.start();await tick(4);
  assert(h.ctx.root.querySelector('[data-progressive-route]'),'authorized view is committed before API resolves');
  assert(!h.ctx.root.textContent.includes('Fetched data'));
  resolve();await run;assert(h.ctx.root.textContent.includes('Fetched data'));
 }finally{resolve();router.destroy();h.dispose();}
});
test('a superseded delayed mount cannot replace its successor or become reusable',async()=>{
 const h=setup({role:'student',path:'/app/progress'}),scope=createPrivateScope();
 scope.setScope('user-a');let resolve;
 const waiting=new Promise(r=>resolve=r);
 const router=createRouter({root:h.ctx.root,window,reuse:createRouteReuse({scope}),routes:[
  registered('/app/progress',async({root,signal})=>{await waiting;if(!signal.aborted)root.textContent='stale data';}),
  registered('/app/mocks',({root})=>{root.textContent='current view';})
 ],prepare:authorized,onError:e=>{throw e;}});
 try{
  const pending=router.start();await tick(4);
  await router.go('/app/mocks');resolve();await pending;
  assert(h.ctx.root.textContent.includes('current view'));
  assert(!h.ctx.root.textContent.includes('stale data'));
 }finally{resolve();router.destroy();scope.setScope(null);h.dispose();}
});
test('non-opt-in active route retains transactional mount behavior',async()=>{
 const h=setup({role:'student',path:'/app/reading/attempts/123'});
 let resolve;const waiting=new Promise(r=>resolve=r);
 const router=createRouter({root:h.ctx.root,window,routes:[
  {pattern:'/app/reading/attempts/:id',protected:true,layout:'focus',match:compilePattern('/app/reading/attempts/:id'),load:async()=>({
   mount:async({root})=>{await waiting;root.textContent='exam ready';}
  })}
 ],prepare:authorized,onError:e=>{throw e;}});
 try{
  const pending=router.start();await tick(4);
  assert(!h.ctx.root.querySelector('[data-progressive-route]'));
  resolve();await pending;assert(h.ctx.root.textContent.includes('exam ready'));
 }finally{resolve();router.destroy();h.dispose();}
});

test('authorization gate prevents early mount and private DOM before completion',async()=>{
 const h=setup({role:'student',path:'/app/progress'});let release;const gate=new Promise(r=>release=r);let mounts=0;
 const router=createRouter({root:h.ctx.root,window,routes:[
  registered('/app/progress',({root})=>{mounts++;root.textContent='PRIVATE USER DATA';})
 ],prepare:()=>gate,onError:e=>{throw e;}});
 try{const pending=router.start();await tick(4);
  assert.equal(mounts,0);assert(!h.ctx.root.textContent.includes('PRIVATE USER DATA'));
  release(await authorized());await pending;
  assert.equal(mounts,1);assert(h.ctx.root.textContent.includes('PRIVATE USER DATA'));
 }finally{release(await authorized());router.destroy();h.dispose();}
});
test('a failed progressive mount never enters reusable DOM cache',async()=>{
 const h=setup({role:'student',path:'/app/progress'}),scope=createPrivateScope();scope.setScope('user-a');
 const reuse=createRouteReuse({scope}),router=createRouter({root:h.ctx.root,window,reuse,routes:[
  registered('/app/progress',async({root})=>{root.textContent='BROKEN PARTIAL VIEW';throw new Error('fixture mount failed');})
 ],prepare:authorized,onError:()=>{h.ctx.root.textContent='error boundary';}});
 try{await router.start();await tick(4);
  assert.equal(reuse.size,0);assert(!h.ctx.root.textContent.includes('BROKEN PARTIAL VIEW'));
 }finally{router.destroy();scope.setScope(null);h.dispose();}
});
