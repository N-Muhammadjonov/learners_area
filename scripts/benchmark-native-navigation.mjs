/** Controlled DOM benchmark. No browser paint, database, network or deployment latency claim. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import routes from '../frontend/vanilla/js/routes.js';import {createRouter,compilePattern} from '../frontend/vanilla/js/router.js';
import {setup,api,ID} from '../frontend/vanilla/tests/staff-final30/harness.mjs';
const h=setup({path:'/app/vocabulary',role:'student'});for(const k of ['localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','AbortController','AbortSignal'])globalThis[k]=window[k];
const wire=JSON.parse(fs.readFileSync(process.env.INTERACTION_WIRE_FIXTURE||'../review-interactions-oct25/current-wire.json','utf8'));
const canonical=raw=>{const u=new URL(raw,'https://fixture.invalid');u.searchParams.sort();return u.pathname+u.search;};const samples=new Map(Object.entries(wire).map(([k,v])=>[canonical(k),v]));
const reads=[];api.request=async path=>{reads.push(path);const value=samples.get(canonical(path));if(value===undefined)throw Error('Missing real ASGI sample: '+path);return structuredClone(value);};
const selected=[['/app/vocabulary','[data-vocab-list], [data-vocabulary-core=library]'],['/app/vocabulary?tab=revision','[data-revision-card], [data-revision-summary]'],['/app/vocabulary?tab=board','[data-board-rows], [data-board-empty]']];
const router=createRouter({root:h.ctx.root,routes:routes.map(r=>({...r,match:compilePattern(r.pattern)})),window,prepare:()=>({dict:h.ctx.dict,locale:'en',session:h.ctx.session}),onError:error=>{throw error;},notFound:()=>{throw Error('No route');}});
const all=[];try{
 for(let turn=0;turn<40;turn++){const [path,selector]=selected[turn%selected.length],start=performance.now();await router.navigate(path);for(let spin=0;spin<100;spin++){await new Promise(r=>setImmediate(r));if(h.q(selector)&&!h.q('[data-async-loading],[aria-busy=true]'))break;}assert(h.q(selector),'View never ready: '+path);assert(!h.q('[data-vocabulary-region-error]'),'API contract failure');if(turn>=8)all.push({path,ms:performance.now()-start});}
 const sorted=all.map(x=>x.ms).sort((a,b)=>a-b),p=percent=>sorted[Math.ceil(sorted.length*percent)-1];
 const exact=new Map(routes.filter(r=>!r.pattern.includes(':')).map(r=>[r.pattern,r])),compiled=routes.map(r=>({...r,match:compilePattern(r.pattern)})),targets=[...exact.keys()];let sentinel;
 const dispatch=(fast)=>{const start=performance.now();for(let i=0;i<200000;i++){const target=targets[i%targets.length];sentinel=fast?exact.get(target):compiled.find(r=>r.match.test(target));}assert(sentinel);return performance.now()-start;};dispatch(true);dispatch(false);const mapMs=dispatch(true),scanMs=dispatch(false);
 const result={scope:'Actual native router/module DOM with captured ASGI JSON served from memory. Imports warmed, JSDOM, one local machine. Excludes browser paint, network, database and serverless cold starts.',samples:all.length,warmDomReadyMs:{p50:+p(.5).toFixed(2),p95:+p(.95).toFixed(2),max:+sorted.at(-1).toFixed(2)},dispatch:{iterations:200000,staticRoutes:exact.size,mapMs:+mapMs.toFixed(2),regexScanMs:+scanMs.toFixed(2)},authStateRequests:reads.filter(p=>p==='/api/auth/state').length};
 const output=process.env.NAVIGATION_BENCHMARK_REPORT;if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{router.destroy();h.dispose();}
