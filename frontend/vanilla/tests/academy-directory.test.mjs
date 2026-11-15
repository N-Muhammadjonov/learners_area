import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import routes from '../js/routes.js';
import {mount} from '../modules/staff-final30/academy-directory.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {dicts,ID,setup,tick} from './staff-final30/harness.mjs';

const path='/app/management/directory-files', api='/api/staff/academy/directory';
const columns={external_id:0,name:1,email:2,role:3};
const review={reviewHash:'e'.repeat(64),total:2,page:1,pageSize:100,ready:1,
 counts:{ready_stage:1,unsupported_role:1},rows:[
  {row:2,externalId:'D1',name:'Directory Student',email:'a@fixture.invalid',role:'student',status:'ready_stage'},
  {row:3,externalId:'D2',name:'Invalid role',email:'b@fixture.invalid',role:'',status:'unsupported_role'},
 ]};

async function inspect(h){
 const file=h.q('[data-directory-file] input');
 Object.defineProperty(file,'files',{value:[
  {name:'directory.csv',size:21,arrayBuffer:async()=>new TextEncoder().encode('ID,Name,Email,Role\n').buffer},
 ]});
 h.q('[data-directory-file]').reportValidity=()=>true;
 h.submit(h.q('[data-directory-file]'));
 await tick();
 const form=h.q('[data-directory-map]');
 h.input(form.querySelector('input'),'legacy-centre');
 h.submit(form);
 await tick();
}

test('owner route maps columns, previews, and retries only a confirmed batch with the same key',async()=>{
 assert.deepEqual(routes.find(r=>r.pattern===path).roles,['owner']);
 assert(managementAreas(dicts.en,'owner').some(x=>x.href===path));
 assert(!managementAreas(dicts.en,'admin').some(x=>x.href===path));
 const h=setup({path,role:'owner'});
 let attempts=0;
 h.stub({
  [api+'/import/inspect']:{headers:['ID','Name','Email','Role'],suggested:columns,sheets:[],sheet:null,rowCount:2},
  [api+'/import/preview']:review,
  [api+'/import/apply']:()=>++attempts===1?new ApiError(503,'unavailable'):
   {batchId:ID(4),total:2,linked:0,staged:1,counts:review.counts},
 });
 try{
  await mount(h.ctx);await inspect(h);
  assert.match(h.q('[data-directory-review]').textContent,/Directory Student/);
  const form=h.q('[data-directory-apply]');
  h.submit(form);await tick();
  assert.equal(attempts,0);
  form.querySelector('input').checked=true;
  h.submit(form);h.submit(form);await tick();
  assert.equal(attempts,1);
  h.submit(form);await tick();
  const commands=h.calls.filter(call=>call.path.endsWith('/apply')).map(call=>call.body);
  assert.equal(commands.length,2);
  assert.deepEqual(commands[0],commands[1]);
  assert.deepEqual(commands[0].columns,columns);
  assert.equal(commands[0].reviewHash,review.reviewHash);
  assert.equal(h.q('[data-directory-review] a').getAttribute('href'),api+'/imports/'+ID(4)+'/issues.csv');
 }finally{h.dispose();}
});

test('owner confirms an explicit account match for a pending directory row',async()=>{
 const h=setup({path,role:'owner'});
 let linked=false;
 h.stub({
  [api+'/pending']:()=>({rows:linked?[]:[{external_id:'T9',name:'Legacy Teacher',role:'teacher'}],next:null}),
  '/api/staff/academy/lookups/directory-teacher':{options:[{id:ID(7),label:'Registered Teacher'}]},
  [api+'/pending/link']:()=>{linked=true;return {linked};},
 });
 try{
  await mount(h.ctx);
  const panel=h.qa('details').find(node=>node.firstChild.textContent==='Pending directory records');
  panel.open=true;
  const find=panel.querySelector('form');
  h.input(find.querySelector('input'),'legacy');
  h.submit(find);await tick();
  h.click([...panel.querySelectorAll('button')].find(node=>node.textContent==='Link to account'));
  const forms=[...panel.querySelectorAll('form')];
  h.input(forms[1].querySelector('input'),'Registered');
  h.submit(forms[1]);await tick();
  forms[2].querySelector('input').checked=true;
  h.submit(forms[2]);await tick();
  assert(linked);
  assert.deepEqual(h.calls.find(call=>call.path.endsWith('/pending/link')).body,
   {source:'legacy',externalId:'T9',userId:ID(7)});
  assert.match(panel.textContent,/No pending rows for this source/);
 }finally{h.dispose();}
});
