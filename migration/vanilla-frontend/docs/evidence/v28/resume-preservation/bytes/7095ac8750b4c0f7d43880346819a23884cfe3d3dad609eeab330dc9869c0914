import {mount as mountError} from '../modules/error.js';
import {createRouter,compilePattern} from './router.js';
import {readPreferences} from './preferences.js';
import routes from './routes.js';
import {canonicalPath} from './navigation.js';
document.documentElement.dataset.theme=readPreferences().theme;
document.documentElement.lang=readPreferences().locale;
let workspace;
async function ensureWorkspace(){workspace??=(await import('./workspace.js')).createWorkspace(document.querySelector('#root'));return workspace;}
const router=createRouter({root:document.querySelector('#root'),onStart:(url,{signal})=>workspace?.begin(url,signal),canonicalize:canonicalPath,prepare:async context=>context.route?.protected?(await ensureWorkspace()).prepare(context):undefined,commit:(staging,context)=>{if(workspace)workspace.commit(staging,context);else document.querySelector('#root').replaceChildren(...staging.childNodes);},routes:routes.map(r=>({...r,match:compilePattern(r.pattern)})),notFound:()=>import('../modules/not-found.js'),onError:async(error,root,context)=>{if(context.signal.aborted)return;const staging=document.createElement('div');await mountError({...context,error,root:staging});if(context.signal.aborted)return;if(context.session&&workspace)workspace.commit(staging,context);else{workspace?.destroy();workspace=null;root.replaceChildren(...staging.childNodes);}const h=root.querySelector('h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}});
void router.start();
