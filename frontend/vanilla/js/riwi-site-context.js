/** Session-memory UI observations. No form values, transcript text, IDs, queries or persistent storage. */
import routes from './routes.js';
import {compilePattern} from './router.js';
import {privateScope} from './private-scope.js';
import {controlAction} from './control-help.js';
const patterns=routes.map(r=>({path:r.pattern,match:compilePattern(r.pattern)}));
let previous=null,scope=null;
export function siteQuestion(text){return /sayt|website|web\s*site|tugma|button|sahifa|bo[‘'’ʻ]?lim|navigation|navigats|interfeys|interface|qidiruv|search|yuklash|upload|menu|menyu|architecture|arxitektur|\/app\b/i.test(text);}
export function routePattern(path){return patterns.find(x=>x.match.test(path))?.path??null;}
export function captureSiteSurface(root=document,win=window,pathOverride,owner=false){
 const path=routePattern(pathOverride??win.location.pathname);if(!path?.startsWith('/app'))return null;
 const controls=[];
 for(const el of root.querySelectorAll('button,a[href],summary,[role="tab"],input[type="search"]')){
  if(el.closest('.riwi-transcript,[data-riwi-file-editor]'))continue;
  const rect=el.getBoundingClientRect();if(!rect.width||!rect.height||rect.bottom<=0||rect.top>=win.innerHeight)continue;
  let label=el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||'';
  if(el.closest('[data-campus-header-profile]')&&!el.matches('a'))label='Profile';
  label=label.replace(/\s+/g,' ').trim();if(!label||label.length>100||/@|https?:/.test(label))continue;
  let href=null;
  if(el.matches('a[href]')){try{const u=new URL(el.getAttribute('href'),win.location.href);if(u.origin===win.location.origin)href=routePattern(u.pathname);}catch{}}
  const css=win.getComputedStyle(el),zone=(rect.top+rect.height/2<win.innerHeight/3?'top':rect.top+rect.height/2>win.innerHeight*2/3?'bottom':'middle')+'-'+(rect.left+rect.width/2<win.innerWidth/3?'left':rect.left+rect.width/2>win.innerWidth*2/3?'right':'center');
  const tag=el.tagName.toLowerCase();
  const item={label,tag:['a','button','summary','input'].includes(tag)?tag:'button',href,zone,color:css.color,background:css.backgroundColor,disabled:!!el.disabled};
  if(owner){const action=controlAction(el);if(action)item.action=action;}
  controls.push(item);
  if(controls.length===60)break;
 }
 return {path,theme:root.ownerDocument?.documentElement.dataset.theme??document.documentElement.dataset.theme??'day',controls};
}
export function rememberSiteSurface(root,win=window,pathOverride,owner=false){
 const now=privateScope.scope;if(now!==scope){scope=now;previous=null;if(now)privateScope.own(()=>{previous=null;scope=null;});}
 const surface=captureSiteSurface(root,win,pathOverride,owner);if(now&&surface&&surface.path!=='/app/riwi'&&(surface.path!=='/app'||!previous))previous=surface;
}
export function siteContext(root=document,win=window,owner=false){
 const current=captureSiteSurface(root,win,undefined,owner);return [current,previous].filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.path===x.path)===i);
}
