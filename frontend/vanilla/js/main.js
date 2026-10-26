import {enableDiagnostics,rootDiagnosticsEnabled} from './diagnostics.js';
import {mount as mountError} from '../modules/error.js';
import {createRouter,compilePattern} from './router.js';
import {createRouteReuse} from './route-reuse.js';
import {readPreferences} from './preferences.js';
import routes from './routes.js';
import {canonicalPath} from './navigation.js';
document.documentElement.dataset.theme=readPreferences().theme;
document.documentElement.lang=readPreferences().locale;
let workspace;
async function ensureWorkspace(){workspace??=(await import('./workspace.js')).createWorkspace(document.querySelector('#root'));return workspace;}
let pipelineDiagnostics;
const router=createRouter({reuse:createRouteReuse(),metrics:{begin:input=>pipelineDiagnostics?.begin(input)},root:document.querySelector('#root'),onUpdate:context=>workspace?.updateLocation(context),onStart:(url,{signal,source})=>workspace?.begin(url,signal,source),canonicalize:canonicalPath,prepare:async context=>{document.title=context.url.pathname==='/'?'Learners Area — IELTS inside a private centre':'Learners Area';if(rootDiagnosticsEnabled())void enableDiagnostics(context.signal);return context.route?.protected?(await ensureWorkspace()).prepare(context):undefined;},commit:(staging,context)=>{if(workspace)workspace.commit(staging,context);else document.querySelector('#root').replaceChildren(...staging.childNodes);},routes:routes.map(r=>({...r,match:compilePattern(r.pattern)})),notFound:()=>import('../modules/not-found.js'),onError:async(error,root,context)=>{if(context.signal.aborted)return;const staging=document.createElement('div');await mountError({...context,error,root:staging});if(context.signal.aborted)return;if(context.session&&workspace)workspace.commit(staging,context);else{workspace?.destroy();workspace=null;root.replaceChildren(...staging.childNodes);}const h=root.querySelector('h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}});
// Load stage instrumentation only for the existing server-approved QA flag.
if(rootDiagnosticsEnabled())void import('./navigation-metrics.js').then(({createNavigationMetrics})=>{pipelineDiagnostics=createNavigationMetrics({enabled:rootDiagnosticsEnabled,emit:sample=>console.info('[qa-perf] '+JSON.stringify(sample))});}).catch(()=>{}).finally(()=>router.start());
else void router.start();
