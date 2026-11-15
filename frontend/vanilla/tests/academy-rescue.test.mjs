import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount} from '../modules/staff-final30/academy-rescue.js';
import routes from '../js/routes.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';

const route='/api/staff/academy/rescue';
const thresholds={revision:1,windowDays:28,attendancePercent:75,minimumMarkedSessions:3,overdueStreak:2,scoreDropPoints:15};
const item={studentId:'fixture-id',studentName:'Fixture learner',groupName:'IELTS B2',status:'needs_support',
 observedWindow:{startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-28T00:00:00Z'},
 reasons:[{ruleId:'attendance',value:25,threshold:75,sampleSize:4,evidenceIds:['attendance-fixture-id']}]};

test('Rescue Queue deep link is packaged and uses the protected staff route',()=>{
 const url='/app/management/rescue';
 const staticRoutes=JSON.parse(readFileSync(new URL('../routes.json',import.meta.url),'utf8')).routes;
 assert(staticRoutes.some(pattern=>new RegExp('^'+pattern+'$').test(url)));
 const entry=routes.find(route=>route.pattern===url);
 assert(entry.protected);
 assert.deepEqual(entry.roles,['teacher','admin','owner']);
});

test('assigned evidence is visible to staff and thresholds can only be edited by the owner',async()=>{
 const h=setup({role:'teacher',path:'/app/management/rescue'});
 try{
  h.stub({[route]:()=>({thresholds,items:[item],page:1,hasNext:false})});
  await h.mount({mount});
  assert(h.q('[data-rescue-student="fixture-id"]').textContent.includes('attendance-fixture-id'));
  assert(!h.q('[data-rescue-thresholds]'));
  const filter=h.q('[data-rescue-filter]');
  filter.value='insufficient_data';
  filter.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
  await tick();
  assert.equal(h.calls.at(-1).path,route+'?page=1&status=insufficient_data');
  for(const role of ['teacher','admin','owner','student','guardian']){
   assert.equal(managementAreas(h.ctx.dict,role).some(x=>x.href==='/app/management/rescue'),
    ['teacher','admin','owner'].includes(role));
  }
 }finally{h.dispose();}
});

test('owner sends an integer revisioned threshold update and reloads real queue state',async()=>{
 const h=setup({role:'owner',path:'/app/management/rescue'});
 try{
  let revision=1;
  h.stub({[route+'/thresholds']:()=>({...thresholds,revision:++revision}),
   [route]:()=>({thresholds:{...thresholds,revision},items:[],page:1,hasNext:false})});
  await h.mount({mount});
  assert(h.q('[data-academy-rescue]').textContent.includes('No learners match'));
  const form=h.q('[data-rescue-thresholds]');
  h.input(form.querySelector('[name="attendancePercent"]'),'70');
  h.submit(form);
  await tick();
  assert.deepEqual(h.calls.find(call=>call.method==='PUT').body,{...thresholds,attendancePercent:70});
  assert.equal(h.calls.at(-1).method,'GET');
  assert(h.q('[data-academy-rescue]').textContent.includes('Thresholds saved.'));
 }finally{h.dispose();}
});

test('a teacher retries an unchanged case action with the same id and sees the case history',async()=>{
 const h=setup({role:'teacher',path:'/app/management/rescue'});
 try{
  const groupId='fixture-group';
  const path=route+'/'+groupId+'/'+item.studentId+'/actions';
  let claimed=false;
  let failures=1;
  h.stub({[path]:(url,options)=>{
   if(options.method==='POST'){
    if(failures--){throw Object.assign(Error('Unavailable'),{status:503});}
    claimed=true;
    return {revision:1,status:'claimed'};
   }
   return {items:[{action:'claim',createdAt:'2026-10-29T00:00:00Z',reason:'Agreed support'}],page:1,hasNext:false};
  },[route]:()=>({thresholds,items:[{...item,groupId,case:{revision:claimed?1:0,
   status:claimed?'claimed':'open',assignedTo:claimed?h.ctx.session.user.id:null}}],
   page:1,hasNext:false})});
  await h.mount({mount});
  const form=h.q('[data-rescue-case-form]');
  h.input(form.querySelector('textarea'),'Agreed support');
  h.submit(form);
  await tick();
  assert(form.textContent.includes('Could not save the action'));
  h.submit(form);
  await tick();
  const posts=h.calls.filter(call=>call.method==='POST');
  assert.equal(posts.length,2);
  assert.equal(posts[0].body.id,posts[1].body.id);
  assert.equal(posts[1].body.action,'claim');
  assert(h.q('[data-rescue-student]').textContent.includes('Claimed'));
  const history=[...h.q('[data-rescue-student]').querySelectorAll('details')].at(-1);
  history.open=true;
  await tick();
  assert(history.textContent.includes('Agreed support'));
 }finally{h.dispose();}
});
