/** Controlled DOM benchmark, not a browser paint or production network SLA. */
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import routes from '../frontend/vanilla/js/routes.js';
import {setup,api} from '../frontend/vanilla/tests/staff-final30/harness.mjs';
import {privateScope} from '../frontend/vanilla/js/private-scope.js';
const wire=JSON.parse(fs.readFileSync(process.argv[2]??'../browser-wire.json','utf8'));
const key=path=>{const u=new URL(path,'https://fixture.invalid');u.searchParams.sort();return u.pathname+u.search;};
const samples=new Map();for(const [path,v]of Object.entries(wire)){const k=key(path);if(samples.has(k)&&/\/app\/(dashboard|progress)/.test(v.route??''))continue;samples.set(k,v);}
const results=[];
for(const path of ['/app/dashboard','/app/listening/lessons','/app/reading/lessons','/app/grammar/lessons','/app/video-lessons','/app/progress']){
 const h=setup({path,role:'student'});let active=0,requests=0;
 try{
  for(const name of ['CustomEvent','Element','MutationObserver','HTMLInputElement','HTMLTextAreaElement','KeyboardEvent'])globalThis[name]=h.dom.window[name];
  h.dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});privateScope.setScope(h.ctx.session.user.id);
  api.request=async(raw)=>{const value=samples.get(key(raw));if(!value)throw Error('No wire fixture: '+raw);active++;requests++;try{await new Promise(r=>setTimeout(r,40));return structuredClone(value);}finally{active--;}};
  const route=routes.find(r=>r.pattern===path);
  async function run(){h.ctx.root.replaceChildren();const start=performance.now();const view=await route.load();await view.mount(h.ctx);
   const deadline=performance.now()+3000;
   do{await new Promise(r=>setImmediate(r));if(!active&&!h.q('[data-async-loading],[aria-busy="true"]'))break;}while(performance.now()<deadline);
   if(active||h.q('[data-async-loading],[aria-busy="true"],[data-region-failure]'))throw Error('Incomplete route: '+path);
   if(!h.ctx.root.textContent.trim())throw Error('Empty route: '+path);return performance.now()-start;
  }
  const cold=await run(),before=requests,warm=[];
  for(let i=0;i<10;i++)warm.push(await run());warm.sort((a,b)=>a-b);
  results.push({route:path,firstDOMMs:+cold.toFixed(2),cachedMedianDOMMs:+warm[5].toFixed(2),cachedP90DOMMs:+warm[8].toFixed(2),cachedNetworkRequests:requests-before});
 }finally{h.dispose();}
}
console.log(JSON.stringify({scope:'Node/jsdom DOM mounts using captured ASGI payloads and 40ms simulated read latency; excludes browser layout/paint, remote database, media and WebGL',results},null,2));
