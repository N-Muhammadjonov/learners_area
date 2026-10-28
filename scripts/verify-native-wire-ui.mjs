/** Mount production native modules using captured responses from the real ASGI
 * + disposable PostgreSQL gate. This verifies DOM contracts, not browser layout. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import routes from '../frontend/vanilla/js/routes.js';
import {setup,tick,api} from '../frontend/vanilla/tests/staff-final30/harness.mjs';
import {ApiError} from '../frontend/vanilla/js/api-client.js';

const wire=JSON.parse(fs.readFileSync(process.argv[2]??'../browser-wire.json','utf8'));
const canonical=path=>{const u=new URL(path,'http://preview.test');u.hash='';u.searchParams.sort();return u.pathname+u.search;};
const samples=new Map();
for(const [path,value] of Object.entries(wire)){
 const key=canonical(path);
 // Fault-injection samples deliberately contain unavailable widgets. The UI
 // gate below mounts the healthy response; outage rendering has its own tests.
 if(samples.has(key)&&/\/app\/(dashboard|progress)/.test(value.route??''))continue;
 samples.set(key,value);
}
const routeFor=path=>routes.find(r=>new RegExp('^'+r.pattern.split('/').map(p=>p.startsWith(':')?'[^/]+':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$').test(path));
const selected=new Set(['/app/dashboard','/app/progress','/app/mocks','/app/coach','/app/assignments','/app/profile',
 '/app/vocabulary','/app/vocabulary?tab=revision','/app/vocabulary?tab=use','/app/vocabulary?tab=board','/app/vocabulary/games',
 '/app/grammar','/app/grammar/lessons','/app/listening/lessons','/app/reading/lessons','/app/courses/ielts',
 '/app/video-lessons','/app/reading/academic','/app/reading/general','/app/listening/academic','/app/listening/general',
 '/app/listening/mcq','/app/management','/app/admin/content','/app/admin/materials','/app/owner/audit',
 '/app/teacher/students','/app/owner','/app/admin/statistics']);
for(const game of ['cards','choice','match','gap','race','translation','builder'])selected.add('/app/vocabulary/games/'+game+'?set=all');
selected.add('/app/grammar?tab=writing');
for(const raw of samples.values())if(raw.route){const p=new URL(raw.route,'http://preview.test');
 if(p.pathname==='/app/writing'&&p.searchParams.get('tab')!=='topic-vocabulary')selected.add(raw.route);
 if(/^\/app\/writing\/(exam|translation|grade|language-stealing|lessons)\//.test(p.pathname))selected.add(raw.route);
 if(/^\/app\/(reading|listening|grammar)\/lessons\//.test(p.pathname))selected.add(raw.route);
}
// Staff read envelopes and their production routes.
const staffPaths={'teacher-students':'/app/teacher/students','owner-overview':'/app/owner','centre-statistics':'/app/admin/statistics'};
for(const raw of samples.values())if(staffPaths[raw.kind])selected.add(staffPaths[raw.kind]);
let checks=0;const failures=[];
const transport=async(path,options={})=>{
 assert.equal(options.method??'GET','GET','Read-only DOM verification sent a mutation');
 const value=samples.get(canonical(path));
 if(!value)throw new ApiError(503,'wire_sample_missing:'+path);
 return structuredClone(value);
};
for(const path of selected)for(const locale of ['en','uz']){
 const role=/\/app\/(owner|admin|management)/.test(path)?'owner':path.startsWith('/app/teacher')||path.endsWith('/author')?'teacher':'student';
 const h=setup({path,role,locale,theme:locale==='en'?'day':'night'});
 try{
  for(const key of ['localStorage','sessionStorage','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','KeyboardEvent','MouseEvent'])globalThis[key]=h.dom.window[key];
  h.dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  h.dom.window.HTMLMediaElement.prototype.pause=function(){};
  h.dom.window.HTMLMediaElement.prototype.load=function(){};
  h.ctx.session=structuredClone(wire['/api/frontend/session'].session);h.ctx.session.user.role=role;
  api.request=transport;
  const route=routeFor(new URL(path,'http://preview.test').pathname);
  assert.ok(route,'No production route: '+path);
  await h.mount(await route.load());await tick(15);
  if(path==='/app/grammar')assert.equal(h.nav[0]?.path,'/app/grammar/lessons');
  else assert.ok(h.ctx.root.textContent.trim(),'Empty native screen');
  assert.equal(h.qa('[data-integration-required],[data-region-failure],[data-writing-not-found],[data-staff-not-found]').length,0,'Native contract rejected the Python response');
  assert.equal(h.qa('[data-vocabulary-region-error]').length,0,'Vocabulary server response was not accepted');
  assert.equal(h.qa('[data-async-loading],[aria-busy="true"]').length,0,'Native screen still loading');
  assert.doesNotMatch(h.ctx.root.textContent,/\bundefined\b|\[object Object\]/);
  checks++;
 }catch(error){failures.push({path,locale,error:error.message});}
 finally{try{h.dispose();}catch(error){failures.push({path,locale,error:error.message});}}
}
// WebGL-unavailable fallback still follows the verified role for Management.
for(const role of ['student','teacher','admin','owner']){
 const h=setup({path:'/app',role});
 try{h.dom.window.HTMLCanvasElement.prototype.getContext=()=>null;api.request=transport;await h.mount(await routeFor('/app').load());await tick(8);
  assert.equal(h.qa('a[href="/app/management"]').length,role==='student'?0:1);checks++;
 }catch(error){failures.push({path:'/app',role,error:error.message});}finally{h.dispose();}
}
console.log(JSON.stringify({checks,failures,scope:'Production DOM with actual ASGI response samples; no visual/device certification'}));
if(failures.length)process.exitCode=1;
