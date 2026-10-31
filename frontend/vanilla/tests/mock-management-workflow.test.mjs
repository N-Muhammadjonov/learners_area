import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {returnPolicy} from '../modules/campus/return-policy.js';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';
const read=name=>fs.readFileSync(new URL('../modules/staff-final30/'+name,import.meta.url),'utf8');

test('management shows Mock Tests landing, only for teacher and owner',()=>{
 for(const dict of [en,uz]){
  for(const role of ['teacher','owner']){
   const areas=managementAreas(dict,role);
   assert.equal(areas.some(a=>a.href==='/app/management?view=mocks'),true);
   assert.equal(areas.some(a=>a.href==='/app/management?view=mock-grading'),false);
  }
  assert.equal(managementAreas(dict,'admin').some(a=>a.href.includes('view=mocks')),false);
 }
});

test('Mock landing and two child workspaces are separately addressable',()=>{
 const home=read('mock-management.js'),author=read('mock-create.js'),hub=read('management-hub.js');
 assert.match(home,/view=mock-create/);assert.match(home,/view=mock-grading/);
 assert.match(hub,/mock-management\.js/);assert.match(hub,/mock-create\.js/);
 assert.match(author,/\/api\/staff\/mocks\/authoring/);
 assert.match(author,/data-mock-author-publish/);
});

test('new Mock pages use shared Back header only',()=>{
 const origin='https://learnersarea.uz';
 assert.deepEqual(returnPolicy(new URL('/app/management?view=mocks',origin)),{mode:'back',href:'/app/management'});
 for(const tab of ['mock-create','mock-grading'])
  assert.deepEqual(returnPolicy(new URL(`/app/management?view=${tab}`,origin)),{mode:'back',href:'/app/management?view=mocks'});
 assert.doesNotMatch(read('mock-grading.js'),/el\('a', \{href: '\/app\/management', class: 'btn-secondary btn-sm'\}, L\.backManagement\)/);
});

test('grading prompts are model neutral without changing import schema',()=>{
 const s=read('mock-grading.js');
 assert.match(s,/AI Prompts/);assert.doesNotMatch(s,/Gemini Pro uchun rasmiy/);
 assert.match(s,/la\.mock\.grading\.v1/);
});
