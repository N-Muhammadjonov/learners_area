/** Native DOM + actual CSS color audit. No screenshot/layout or media-content claim. */
import fs from 'node:fs';import path from 'node:path';
import routes from '../frontend/vanilla/js/routes.js';import {compilePattern} from '../frontend/vanilla/js/router.js';
import {setup,tick,api} from '../frontend/vanilla/tests/staff-final30/harness.mjs';import {ApiError} from '../frontend/vanilla/js/api-client.js';
import {colorCascade,contrastRatio} from '../frontend/vanilla/tests/helpers/css-contrast.mjs';import {campusHeader} from '../frontend/vanilla/modules/campus/chrome.js';
const fixtureFile=process.argv[2]??process.env.THEME_AUDIT_WIRE;if(!fixtureFile)throw Error('Usage: node scripts/audit-theme-contrast.mjs /path/to/isolated-wire.json');
const wire=JSON.parse(fs.readFileSync(fixtureFile,'utf8')),canonical=raw=>{const u=new URL(raw,'https://fixture.invalid');u.hash='';u.searchParams.sort();return u.pathname+u.search;},samples=new Map();
for(const [raw,value]of Object.entries(wire))samples.set(canonical(raw),value);
const selected=new Set(['/app/vocabulary','/app/vocabulary?tab=dictionary','/app/vocabulary?tab=revision','/app/vocabulary?tab=use','/app/vocabulary?tab=board']);
for(const value of samples.values())if(value.route&&value.data&&value.data.kind!=='not_found')selected.add(value.route);
for(const route of routes)if(!route.pattern.includes(':')&&/^\/app\/(admin|owner|teacher|speaking)(?:\/|$)/.test(route.pattern))selected.add(route.pattern);
for(const extra of ['/app/management','/app/speaking/practice?part=part1','/app/speaking/practice?part=part1&topic=work'])selected.add(extra);
const matcher=routes.map(r=>({...r,match:compilePattern(r.pattern)})),globalStyles=['frontend/vanilla/css/global.css','frontend/vanilla/css/campus.css'].map(p=>fs.readFileSync(p,'utf8'));
const report={scope:'Foreground/background CSS cascade of actual native DOM using isolated ASGI JSON. Initial visible text only. Excludes image pixels, iframe contents, layout, disabled controls and browser paint.',cases:[],failures:[],unresolvedColors:[]};let checked=0;
for(const theme of ['day','night'])for(const focus of ['off','on'])for(const raw of selected){
 const url=new URL(raw,'https://fixture.invalid'),route=matcher.find(r=>r.match.test(url.pathname));if(!route||url.pathname==='/app')continue;
 const role=/^\/app\/(admin|owner|management)(?:\/|$)/.test(url.pathname)?'owner':url.pathname.startsWith('/app/teacher')?'teacher':'student';const h=setup({path:raw,role,locale:'uz'});let count=0;const missingFixtures=new Set();
 try{
  for(const key of ['localStorage','sessionStorage','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','KeyboardEvent','MouseEvent'])globalThis[key]=window[key];globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};
  document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
  const outer=h.ctx.root;if(route.layout!=='focus'){outer.innerHTML='<div data-shell data-campus-shell><header data-shell-topbar class="native-topbar bg-paper-raised"></header><main data-shell-main class="bg-paper"><div data-workspace-content></div></main></div>';h.ctx.root=outer.querySelector('[data-workspace-content]');const header=outer.querySelector('header');campusHeader(header,h.ctx).update(url);}
  api.request=async(raw,options={})=>{if((options.method??'GET')!=='GET')throw Error('Audit attempted a write');const value=samples.get(canonical(raw));if(!value){missingFixtures.add(new URL(raw,'https://fixture.invalid').pathname);throw new ApiError(503,'fixture_missing');}if(value.error)throw new ApiError(value.error==='dictionary_unavailable'?409:503,value.error);return structuredClone(value);};
  await h.mount(await route.load());await tick(12);document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
  const moduleStyles=[...document.querySelectorAll('link[rel=stylesheet]')].flatMap(link=>{const file=path.join('frontend/vanilla',new URL(link.href).pathname);return fs.existsSync(file)?[fs.readFileSync(file,'utf8')]:[];}),cascade=colorCascade(document,[...globalStyles,...moduleStyles]);
  for(const node of outer.querySelectorAll('a,button,p,span,label,h1,h2,h3,h4,li,dt,dd,td,th,strong,small,summary,legend,div')){
   const text=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();if(!text||!/[\p{L}\p{N}]/u.test(text)||node.closest('[disabled],[aria-disabled=true]')||node.matches(':disabled')||node.closest('[data-sidebar-brand]'))continue;
   const computed=cascade.get(node);if(!computed.visible)continue;const ratio=contrastRatio(computed.color,computed.background);count++;
   if(ratio<4.5)report.failures.push({route:raw,theme,focus,text:text.slice(0,90),class:node.className,ratio:+ratio.toFixed(3),foreground:computed.color,background:computed.background,rule:computed.foregroundRule});
  }
  for(const value of cascade.unknown)report.unresolvedColors.push({route:raw,theme,focus,value});report.cases.push({route:raw,theme,focus,textChecks:count,missingFixtureEndpoints:[...missingFixtures]});checked+=count;
 }catch(error){report.failures.push({route:raw,theme,focus,error:error.message});}finally{h.dispose();}
 if(report.cases.length%25===0)console.log(JSON.stringify({completed:report.cases.length,textChecks:checked,failures:report.failures.length}));
}
report.textChecks=checked;const output=process.env.THEME_AUDIT_REPORT||'/tmp/learners-theme-audit.json';fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases.length,textChecks:checked,failures:report.failures.length,unresolved:report.unresolvedColors.length,report:output}));
if(report.failures.length||report.unresolvedColors.length)process.exitCode=1;
