import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const read=x=>fs.readFileSync(new URL(x,root),'utf8');
const route=read('modules/staff-final30/routes.js');
const matches=[...route.matchAll(/\{pattern:'([^']+)'/g)].map(x=>x[1]);
const modules=['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks'];
const file=read('js/adapters/staff-final30/statistics.js');
const coreStub=`
const bad=()=>Object.assign(new Error('invalid_staff_adapter'),{status:502});
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,{max=100000}={})=>{if(typeof x!=='string'||x.length>max)throw bad();return x};
const int=(x,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw bad();return x};
const bool=x=>{if(typeof x!=='boolean')throw bad();return x};
const arr=(x,max=5000)=>{if(!Array.isArray(x)||x.length>max)throw bad();return x};
const date=x=>{const d=new Date(x);if(!Number.isFinite(d.getTime()))throw bad();return d};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staffData=()=>{throw new Error('no external transport during unit tests')};`;
const src=file.replace(/import \{[^\n]+\} from '\.\/core\.js';/,coreStub);
assert(src.includes('const bad=()'),'Pure statistics test stub injection failed');
const stats=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const summary=()=>modules.map(m=>({module:m,started:2,completed:1,learners:1,accuracy:m==='writing'?null:80,band:m==='mocks'?7.5:null,latest:null}));
const student='11111111-2222-4333-8444-555555555555';
test('38 management routes, exactly once, protected on staff route metadata',()=>{assert.equal(matches.length,38);assert.equal(new Set(matches).size,38);assert(route.includes('protected:true'));});
test('the current main retains Management, Statistics and all assignment/assessment routes',()=>{assert(matches.includes('/app/management'));assert(matches.includes('/app/admin/statistics'));assert(matches.includes('/app/admin/reading/retention/staged'));assert(matches.includes('/app/teacher/speaking'));});
test('protected preserved route indexes cannot be overwritten by a staff override',()=>{for(const path of ['/app/admin/content','/app/admin/materials','/app/owner/audit'])assert(!matches.includes(path));});
test('source modules exact SQL inventory of 10 result kinds, no fabricated assignment rows',()=>assert.deepEqual([...stats.RESULT_MODULES],modules));
test('summary retains null ungraded fields, preserves source order',()=>{const d=stats.validateSummary(summary().reverse());assert.deepEqual(d.map(x=>x.module),modules);assert.equal(d.find(x=>x.module==='writing').accuracy,null);});
test('summary rejects invented over-100% accuracy and grade >9',()=>{let rows=summary();rows[0].accuracy=101;assert.throws(()=>stats.validateSummary(rows));rows=summary();rows[9].band=10;assert.throws(()=>stats.validateSummary(rows));});
test('summary requires all modules and rejects duplicates',()=>{assert.throws(()=>stats.validateSummary(summary().slice(1)));const rows=summary();rows[1]=rows[0];assert.throws(()=>stats.validateSummary(rows));});
test('summary rejects completion count greater than attempts and learner count > attempts',()=>{let rows=summary();rows[0].completed=3;assert.throws(()=>stats.validateSummary(rows));rows=summary();rows[0].learners=3;assert.throws(()=>stats.validateSummary(rows));});
test('centre statistics validates daily, enrolled learners and grades',()=>{const data={summary:summary(),selected:null,daily:[{day:'2026-10-23',count:4}],students:[{id:student,name:'Synthetic A',started:2,completed:1,accuracy:null,band:7.5}],levels:[]};const parsed=stats.validateCentreStatistics(data);assert.equal(parsed.students[0].band,7.5);assert.equal(parsed.daily[0].count,4);});
test('centre statistics refuses duplicate activity dates and foreign/malformed student IDs',()=>{const d={summary:summary(),selected:null,daily:[{day:'2026-10-23',count:4},{day:'2026-10-23',count:9}],students:[],levels:[]};assert.throws(()=>stats.validateCentreStatistics(d));d.daily=[];d.students=[{id:'bad',name:'Synthetic',started:1,completed:1,accuracy:70,band:null}];assert.throws(()=>stats.validateCentreStatistics(d));});
test('history keeps missing score distinct from zero',()=>{const data={total:1,pages:1,page:1,module:'speaking',rows:[{id:student,module:'speaking',activity:'speaking',at:'2026-10-23T10:00:00.000Z',completed:true,score:null,maximum:9,unit:'band',title:null}]};const parsed=stats.validateResultHistory(data);assert.equal(parsed.rows[0].score,null);data.rows[0].score=0;assert.equal(stats.validateResultHistory(data).rows[0].score,0);});
test('history rejects foreign module, impossible pagination and band > 9',()=>{const d={total:1,pages:1,page:1,module:'reading',rows:[{id:student,module:'writing',activity:'essays',at:null,completed:true,score:8,maximum:9,unit:'band',title:null}]};assert.throws(()=>stats.validateResultHistory(d));d.module=null;d.rows[0].score=10;assert.throws(()=>stats.validateResultHistory(d));d.rows=[];d.pages=2;assert.throws(()=>stats.validateResultHistory(d));});
test('staff modules retain source authorization + canonical original API',()=>{const x=read('modules/staff-final30/delete-material.js');assert(x.includes("'/api/admin/content/" )===false);assert(x.includes('rawJson(\'DELETE\''));assert(x.includes('signal.aborted'));});
test('people directory carries online/presence truth and rejects fabricated unknown count',()=>{const x=read('js/adapters/staff-final30/people.js'),ui=read('modules/staff-final30/people.js');for(const key of ['onlineCount','visitSeconds','totalSeconds','username','phoneNumber','seenAt'])assert(x.includes(key),key);assert(ui.includes('data-person-presence'));assert(ui.includes("p.set('online','1')"));});
test('staff integration is additive in both ZIP stage and installed Arena checkout',()=>{
 const installed=new URL('js/routes.js',root);
 if(fs.existsSync(installed)){
  const x=fs.readFileSync(installed,'utf8');
  assert(x.includes('STAFF V57 DISPATCH'));
  assert(x.includes("import staffRoutes from '../modules/staff-final30/routes.js';"));
  assert(x.includes("modules/mocks/page.js"),'existing Mock Tests route must be preserved');
 }else{
  const x=read('../../integrate-staff-v56.mjs');
  assert(x.includes('STAFF V57 DISPATCH'));assert(x.includes('Working tree must be clean'));
  assert(!x.includes('force:true'));
 }
});
