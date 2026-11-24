import {el,listen} from '../dom.js';
import {awaitAccountMutations} from '../mutation-lifetime.js';
import {setPreference} from '../preferences.js';
const ns='http://www.w3.org/2000/svg';
function icon(kind){const svg=document.createElementNS(ns,'svg');for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',width:'1em',height:'1em',focusable:'false',class:'text-[18px]'}))svg.setAttribute(k,v);
 // Exact source geometry from src/components/ui/icons.tsx; visual parity unverified.
 const p=document.createElementNS(ns,'path');p.setAttribute('d',kind==='day'?'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4':'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z');svg.append(p);if(kind==='day'){const c=document.createElementNS(ns,'circle');c.setAttribute('cx','12');c.setAttribute('cy','12');c.setAttribute('r','4');svg.append(c);}return svg;}
export function controls({dict,locale,signal,refresh,state},{showTheme=true}={}){
 let mutationState=state,localeFocus=null;let theme=document.documentElement.dataset.theme,themePending=false,localePending=false;const header=el('header',{'data-auth-controls':'',class:'absolute inset-x-0 top-0 flex flex-wrap items-center justify-end gap-3 p-4'});
 const group=el('div',{'data-theme-toggle':theme,class:'flex items-center gap-1'});
 const failure=el('span',{role:'alert',class:'text-xs text-band-bad',hidden:true});
 const toggle=el('button',{type:'button',class:'theme-btn theme-btn-active','data-theme-switch':'',role:'switch',
  'aria-label':dict.theme.night});
 function sync(){
  group.dataset.themeToggle=theme;
  toggle.setAttribute('aria-checked',String(theme==='night'));
  toggle.title=dict.theme[theme==='night'?'day':'night'];
  toggle.replaceChildren(icon(theme));
 }
 listen(toggle,'click',async()=>{
  if(signal.aborted||themePending)return;
  themePending=true;
  const previous=theme;
  theme=theme==='night'?'day':'night';
  document.documentElement.dataset.theme=theme;
  sync();
  toggle.setAttribute('aria-disabled','true');
  failure.hidden=true;
  group.setAttribute('aria-busy','true');
  try{await setPreference('theme',theme,signal);}
  catch{
   if(signal.aborted)return;
   theme=previous;
   document.documentElement.dataset.theme=theme;
   sync();
   failure.textContent=dict.common.error;
   failure.hidden=false;
  }finally{
   themePending=false;
   toggle.removeAttribute('aria-disabled');
   group.removeAttribute('aria-busy');
  }
 },signal);
 sync();group.append(toggle,failure);
 const locales=el('div',{'data-locale-switcher':'',class:'flex flex-col items-start gap-1'});const lg=el('div',{role:'group','aria-label':dict.locale.switchLabel,class:'flex overflow-hidden rounded-sm border border-ink-100 text-xs font-medium'});const err=el('span',{role:'alert',class:'text-xs text-band-bad'});
 err.hidden=true;const localeStatus=el('span',{role:'status',class:'sr-only'},dict.loadingPage.label);
 for(const code of ['uz','en']){const b=el('button',{type:'button',lang:code,'aria-label':dict.locale[code],'aria-pressed':String(code===locale),class:'px-2.5 py-1 uppercase '+(code===locale?'bg-signal-600 text-signal-contrast':'bg-paper-raised text-ink-500 hover:bg-paper-sunken')},code);listen(b,'click',async()=>{if(signal.aborted||localePending||code===locale)return;localePending=true;const restoreFocus=document.activeElement===b,clickedPath=window.location.pathname+window.location.search;localeFocus=restoreFocus?{locale:code,path:clickedPath}:null;const bs=[...lg.querySelectorAll('button')];bs.forEach(b=>b.disabled=true);err.textContent='';err.hidden=true;locales.append(localeStatus);lg.setAttribute('aria-busy','true');try{await setPreference('locale',code,signal);await awaitAccountMutations(mutationState,signal);if(!signal.aborted){document.documentElement.lang=code;await refresh();if(restoreFocus&&document.documentElement.lang===code&&window.location.pathname+window.location.search===clickedPath&&[document.body,document.documentElement].includes(document.activeElement))document.querySelector('[data-locale-switcher] button[lang="'+code+'"]')?.focus({preventScroll:true});}}catch{if(!signal.aborted){err.textContent=dict.auth.errorNetwork;err.hidden=false;}}finally{localePending=false;localeFocus=null;localeStatus.remove();bs.forEach(b=>b.disabled=false);lg.removeAttribute('aria-busy');}},signal);lg.append(b);}locales.append(lg,err);header.append(...(showTheme?[group]:[]),locales);header.updateState=next=>mutationState=next;header.preferenceFocus=()=>localeFocus&&[document.body,document.documentElement].includes(document.activeElement)?localeFocus:null;return header;
}
