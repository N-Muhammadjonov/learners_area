import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount} from '../modules/speaking/live-partner.js';

const path='/app/speaking/live-partner',inviteId=ID(7);
const person=(id,name,avatar)=>({userId:ID(id),name,avatar,hasPhoto:false,speakingScore:null});
const first=person(2,'Fixture learner one','a'),second=person(3,'Fixture learner two','b');
const lobby={state:'available',realtime:{ready:true},rulesAccepted:true,online:[first,second]};

async function fixture(initial,actions,options){
 const h=setup({path,role:'student'}),previousFetch=globalThis.fetch,requests=[];
 h.dom.window.HTMLMediaElement.prototype.pause=function(){};
 h.stub({'/api/frontend/view':{version:1,route:path,data:{kind:'speaking_live_partner',questions:[],me:{...person(1,'Fixture learner', 'a'),hasGender:true}}}});
 globalThis.fetch=async(url,opts={})=>{
  if(url.startsWith('/api/speaking/practice/facets?'))return Response.json({topics:[]});
  assert.equal(url,'/api/live-partner');
  const request=opts.body?JSON.parse(opts.body):null;
  if(request&&!opts.keepalive)requests.push(request);
  const result=request?(actions[request.action]??lobby):initial;
  return Response.json(result);
 };
 mount(h.ctx,options);await tick(8);
 return {...h,requests,dispose(){try{h.dispose();}finally{globalThis.fetch=previousFetch;}}};
}

test('partner choice filters the online list and dials only the explicitly selected learner',async()=>{
 const h=await fixture(lobby,{invite:{...lobby,state:'outgoing_invite',outgoing:{id:inviteId,toUserId:second.userId}},cancel:lobby});
 try{
  assert.equal(h.qa('[data-partner-call]').length,2);
  h.click(h.q('[data-partner-preference="female"]'));
  assert.equal(h.q('[data-partner-preference="female"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(h.qa('[data-partner-call]').map(n=>n.dataset.partnerCall),[second.userId]);
  h.click(h.q('[data-partner-find]'));await tick(8);
  assert.deepEqual(h.requests,[]);
  h.click(h.q('[data-partner-call]'));await tick(8);
  assert.deepEqual(h.requests,[{action:'invite',toUserId:second.userId}]);
  assert(h.q('[data-partner-outgoing]').textContent.includes(second.name));
  h.click(h.q('[data-partner-cancel]'));await tick(8);
  assert.deepEqual(h.requests[1],{action:'cancel',inviteId});
  assert.equal(h.q('[data-partner-outgoing]'),null);
 }finally{h.dispose();}
});

test('incoming calls pass the exact invitation to accept and decline',async()=>{
 for(const action of ['accept','decline']){
  const h=await fixture({...lobby,state:'incoming_invite',incoming:{id:inviteId,from:first}},{[action]:lobby});
  try{
   assert(h.q('[data-partner-incoming]').textContent.includes(first.name));
   h.click(h.q('[data-partner-'+action+']'));await tick(8);
   assert.deepEqual(h.requests,[{action,inviteId}]);
   assert.equal(h.q('[data-partner-incoming]'),null);
  }finally{h.dispose();}
 }
});

test('unconfigured signalling leaves the lobby visible and disables dialling',async()=>{
 const h=await fixture({...lobby,realtime:{ready:false,reason:'not_configured'}},{});
 try{
  assert(h.q('[data-realtime-unavailable]'));
  assert(h.qa('[data-partner-call]').every(button=>button.disabled));
  assert.deepEqual(h.requests,[]);
 }finally{h.dispose();}
});

test('the conversation restores the self, questions, partner grid after accepting an invitation',async()=>{
 const incoming={...lobby,state:'incoming_invite',incoming:{id:inviteId,from:first}};
 const accepted={...lobby,state:'in_call',sessionId:ID(9),partner:first};
 const h=await fixture(incoming,{accept:accepted},{createCall(_sid,deps){
  return {start(){deps.onStatus('connected');},destroy(){}};
 }});
 try{
  assert(h.q('[data-partner-list]'));
  assert.equal(h.q('[data-partner-questions]'),null);
  h.click(h.q('[data-partner-accept]'));await tick(8);
  assert.equal(h.q('[data-partner-view="call"]')?.dataset.partnerView,'call');
  assert.equal(h.q('[data-partner-list]'),null);
  assert.deepEqual([...h.q('.lp-call-grid').children].map(panel=>
   ['self','questions','peer'].find(name=>panel.hasAttribute('data-partner-'+name))),
   ['self','questions','peer']);
 }finally{h.dispose();}
});

test('automatic search sends both preferences and can be cancelled',async()=>{
 const enhanced={...lobby,features:{enabled:true}};
 const queued={...enhanced,features:{enabled:true,searchUntil:'2026-11-11T00:01:00Z'}};
 const h=await fixture(enhanced,{search:queued,stop_search:enhanced});
 try{
  h.click(h.q('[data-partner-preference="female"]'));
  const select=h.q('[data-partner-focus="level"]');select.value='B2';
  select.dispatchEvent(new h.dom.window.Event('change'));
  h.click(h.q('[data-partner-find]'));await tick(8);
  assert.deepEqual(h.requests,[{action:'search',gender:'female',level:'B2'}]);
  h.click(h.q('[data-partner-find]'));await tick(8);
  assert.deepEqual(h.requests[1],{action:'stop_search'});
 }finally{h.dispose();}
});
