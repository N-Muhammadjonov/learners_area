/** Slice 9: materials kind list + universal editor. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as M from '../../modules/staff-final30/materials.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('kind list: label from dictionary, rows link to editor with visibility text, empty state; unknown kind 404 without request; teachers allowed, students redirected',async()=>{
 h=setup({role:'teacher',path:'/app/admin/materials/live_class'});h.stub({'/api/frontend/staff/materials-kind':envelope('materials-kind',{rows:[{id:ID(2),title:'Class A',studentVisible:true},{id:ID(3),title:'<i>B</i>',studentVisible:false}]})});await h.mount({mount:M.kindMount});
 assert.equal(h.q('[data-materials-kind]').dataset.materialsKind,'live_class');assert.equal(h.q('h1').textContent,dicts.en.admin.materialsKindLiveClass);assert.equal(h.q('[data-materials-item="'+ID(2)+'"]').getAttribute('href'),'/app/admin/materials/live_class/'+ID(2));
 assert(h.q('[data-materials-item="'+ID(3)+'"]').textContent.includes(dicts.en.admin.materialsHidden));assert.equal(h.qa('i').length,0);h.dispose();
 h=setup({path:'/app/admin/materials/lesson'});h.stub({'/api/frontend/staff/materials-kind':envelope('materials-kind',{rows:[]})});await h.mount({mount:M.kindMount});assert(h.q('[data-empty-state]'));h.dispose();
 h=setup({path:'/app/admin/materials/bogus'});h.stub({});await h.mount({mount:M.kindMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({role:'student',path:'/app/admin/materials/lesson'});h.stub({});await h.mount({mount:M.kindMount});assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);
});
test('editor: heading with owner name, kind/visibility line, composer for the SAME ownerType loads existing blocks; save PUTs to /api/materials/:type/:id',async()=>{
 h=setup({role:'teacher',path:'/app/admin/materials/grammar/'+ID(4)});let put;globalThis.fetch=async(p,o)=>{if(o.method==='PUT'){put={p,b:JSON.parse(o.body)};return jres(200,{ok:true,blocks:[]});}return jres(200,{ok:true,blocks:[{id:'1',type:'text',position:0,textContent:'note',linkUrl:null,objectKey:null,originalName:null,mimeType:null,size:null}]});};
 h.stub({'/api/frontend/staff/materials-owner':envelope('materials-owner',{owner:{title:'Articles',studentVisible:false}})});await h.mount({mount:M.editorMount});await tick(6);
 assert.equal(h.q('h1').textContent,'Materials for Articles');assert(h.q('.meta-text').textContent.includes(dicts.en.admin.materialsKindGrammar));assert(h.q('.meta-text').textContent.includes(dicts.en.admin.materialsHidden));assert.equal(h.q('[data-resource-composer]').dataset.resourceComposer,'grammar');assert.equal(h.q('[data-composer-text]').value,'note');
 h.input(h.q('[data-composer-text]'),'edited');h.q('[data-composer-save]').click();await tick(6);assert.equal(put.p,'/api/materials/grammar/'+ID(4));assert.deepEqual(put.b,{blocks:[{type:'text',textContent:'edited'}]});
});
test('editor: not manageable/not found => not-found with NO composer and no materials request; bad uuid/type never reach the API',async()=>{
 let fetched=0;globalThis.fetch=async()=>{fetched++;return jres(200,{});};
 h=setup({path:'/app/admin/materials/lesson/'+ID(4)});h.stub({'/api/frontend/staff/materials-owner':new ApiError(404,'not_found')});await h.mount({mount:M.editorMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.q('[data-resource-composer]'),null);h.dispose();
 h=setup({path:'/app/admin/materials/lesson/not-a-uuid'});h.stub({});await h.mount({mount:M.editorMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/materials/hacker/'+ID(4)});h.stub({});await h.mount({mount:M.editorMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);assert.equal(fetched,0);
});
