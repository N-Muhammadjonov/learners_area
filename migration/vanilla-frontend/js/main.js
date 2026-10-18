import {createRouter,compilePattern} from './router.js';
import {readPreferences} from './preferences.js';
import {el} from './dom.js';
import routes from './routes.js';
import {canonicalPath} from './navigation.js';
document.documentElement.dataset.theme=readPreferences().theme;
document.documentElement.lang=readPreferences().locale;
let workspace;
async function ensureWorkspace(){workspace??=(await import('./workspace.js')).createWorkspace(document.querySelector('#root'));return workspace;}
const router=createRouter({root:document.querySelector('#root'),canonicalize:canonicalPath,prepare:async context=>context.route?.protected?(await ensureWorkspace()).prepare(context):undefined,commit:(staging,context)=>{if(workspace)workspace.commit(staging,context);else document.querySelector('#root').replaceChildren(...staging.childNodes);},routes:routes.map(r=>({...r,match:compilePattern(r.pattern)})),notFound:()=>import('../modules/not-found.js'),onError:(_error,root)=>{root.replaceChildren(el('main',{class:'p-6'},el('h1',{},'Migration candidate unavailable'),el('p',{},'The view could not be loaded. Reload to retry. No private content was loaded.')));}});
void router.start();
