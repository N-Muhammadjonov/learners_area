import {createRouter,compilePattern} from './router.js';
import {readPreferences} from './preferences.js';
import {el} from './dom.js';
import routes from './routes.js';
import {canonicalPath} from './navigation.js';
document.documentElement.dataset.theme=readPreferences().theme;
document.documentElement.lang=readPreferences().locale;
const router=createRouter({root:document.querySelector('#root'),canonicalize:canonicalPath,routes:routes.map(r=>({...r,match:compilePattern(r.pattern)})),notFound:()=>import('../modules/not-found.js'),onError:(_error,root)=>{root.replaceChildren(el('main',{class:'p-6'},el('h1',{},'Migration candidate unavailable'),el('p',{},'The view could not be loaded. Reload to retry. No private content was loaded.')));}});
void router.start();
