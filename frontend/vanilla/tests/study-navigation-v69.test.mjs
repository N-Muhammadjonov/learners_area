import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount} from '../modules/profile/page.js';
import {studyForm} from '../modules/auth/study-form.js';
import {campusHeader} from '../modules/campus/chrome.js';
import {createApi} from '../js/api-client.js';
import {privateScope} from '../js/private-scope.js';
import {viewData} from '../js/adapters/frontend.js';
const study={currentLevel:'B2',currentBand:6.5,targetBand:8,examDate:'2027-03-04',dailyStudyMinutes:90,strongestSkill:'listening',weakestSkill:'writing'};

test('profile shows stored IELTS details, saves the exact PATCH contract and keeps the success state',async()=>{
 const h=setup({path:'/app/profile',role:'student'});let refreshed=0;h.ctx.refresh=async()=>refreshed++;
 try{h.stub({'/api/frontend/view':{version:1,route:'/app/profile',data:{profile:{telegramIntentEnabled:false,botUsername:null,study}}},'/api/profile/study':{ok:true}});await mount(h.ctx);
  const form=h.q('[data-study-form]');assert(form);assert.equal(form.querySelector('#currentBand').value,'6.5');assert.equal(form.querySelector('#examDate').value,'2027-03-04');
  h.input(form.querySelector('#targetBand'),'8.5');h.submit(form);await tick();
  const call=h.calls.find(c=>c.path==='/api/profile/study');assert.equal(call.method,'PATCH');assert.deepEqual(call.body,{preferredLanguage:'en',currentLevel:'B2',currentBand:'6.5',targetBand:'8.5',examDate:'2027-03-04',dailyStudyMinutes:'90',strongestSkill:'listening',weakestSkill:'writing'});assert.equal(refreshed,1);
  assert.equal(form.querySelector('[role=status]').textContent,h.ctx.dict.profile.studySaved);assert(h.ctx.state.profileStudy.saved);
 }finally{h.dispose();}
});
test('date parts preserve a partial draft and reject impossible dates before submitting',async()=>{
 const h=setup({path:'/app/profile'});
 try{h.stub({'/api/profile/study':{ok:true}});const form=studyForm(h.ctx,{profile:true,initial:study});h.ctx.root.append(form);
  const day=form.querySelector('[aria-label=Day]'),month=form.querySelector('[aria-label=Month]');h.input(day,'31');h.input(month,'2');h.submit(form);await tick();assert.equal(h.calls.length,0);assert(!form.checkValidity());
  h.input(day,'');assert.equal(form.querySelector('#examDate').value,'');assert(!form.checkValidity());
  const remount=studyForm(h.ctx,{profile:true,initial:study});assert.equal(remount.querySelector('[aria-label=Day]').value,'');assert.equal(remount.querySelector('[aria-label=Month]').value,'2');
 }finally{h.dispose();}
});
test('topbar orders Main, module identity and search; the campus hides both return controls',()=>{
 const h=setup({path:'/app/reading/academic'});
 try{const header=document.createElement('header'),search=document.createElement('input');header.append(search);const chrome=campusHeader(header,h.ctx);chrome.update(h.ctx.url);assert.equal(header.children[1].textContent,'←Main');assert.equal(header.children[2].textContent,h.ctx.dict.nav.reading);assert.equal(header.children[3],search);
  chrome.update(new URL('/app','https://fixture.invalid'));assert(header.children[1].hidden);assert(header.children[2].hidden);assert(!header.children[0].hidden);
 }finally{h.dispose();}
});
test('view cache is cloned, identity scoped and invalidated without admitting older in-flight data',async()=>{
 const h=setup({path:'/app/writing'});let version=0,release;
 try{privateScope.setScope('alice');h.stub({'/api/frontend/view':async()=>({version:1,route:'/app/writing',data:{catalogue:++version}})});
  const first=await viewData('/app/writing');first.catalogue=999;assert.equal((await viewData('/app/writing')).catalogue,1);assert.equal(h.calls.length,1);
  privateScope.invalidate('view:');assert.equal((await viewData('/app/writing')).catalogue,2);
  privateScope.invalidate('view:');h.stub({'/api/frontend/view':()=>new Promise(r=>release=r)});const old=viewData('/app/writing');privateScope.setScope('bob');release({version:1,route:'/app/writing',data:{catalogue:'alice'}});await old;assert.equal(privateScope.size,0);
  privateScope.setScope('alice');const pending=viewData('/app/writing');privateScope.invalidate('view:');release({version:1,route:'/app/writing',data:{catalogue:'pre-mutation'}});await pending;assert.equal(privateScope.size,0);
 }finally{h.dispose();}
});
test('a GET after a mutation never joins an older transport',async()=>{
 const calls=[];const client=createApi((path,options)=>new Promise(resolve=>calls.push({path,options,resolve})));const before=client.request('/api/catalogue');const mutation=client.request('/api/profile/study',{method:'PATCH',body:{}});const after=client.request('/api/catalogue');assert.equal(calls.length,3);
 for(const [i,c]of calls.entries())c.resolve(new Response(JSON.stringify({version:i}),{headers:{'Content-Type':'application/json'}}));assert.equal((await before).version,0);await mutation;assert.equal((await after).version,2);
});

test('mutation completion invalidates snapshots read during the write as well as those read before it',async()=>{
 const calls=[],invalidations=[];const client=createApi((path)=>new Promise(resolve=>calls.push({path,resolve})),()=>{},path=>invalidations.push(path));
 const write=client.request('/api/profile/study',{method:'PATCH',body:{}});const during=client.request('/api/catalogue');assert.equal(invalidations.length,1);
 calls[0].resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));await write;assert.equal(invalidations.length,2);
 const after=client.request('/api/catalogue');assert.equal(calls.length,3);
 for(const c of calls.slice(1))c.resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));await Promise.all([during,after]);
});
