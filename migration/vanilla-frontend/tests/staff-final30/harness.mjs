/** FINAL30 test harness. Synthetic transport only — fixtures are NOT live integration. */
import {JSDOM} from 'jsdom';
import {api} from '../../js/api-client.js';
import {privateScope} from '../../js/private-scope.js';
import en from '../../js/i18n/en.js';
import uz from '../../js/i18n/uz.js';
export const dicts={en,uz};
export const tick=(n=3)=>new Promise(r=>{let i=0;const s=()=>++i>=n?r():setTimeout(s,0);setTimeout(s,0);});
export const ID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function setup({path='/app/admin/people',role='admin',locale='en',theme='day'}={}){
 const dom=new JSDOM('<!doctype html><main id="root"></main>',{url:'https://fixture.invalid'+path,pretendToBeVisual:true});
 for(const k of ['window','document','Node','Event','HTMLElement'])globalThis[k]=dom.window[k];
 /* jsdom lacks <dialog> modal methods; same polyfill the V3 suite uses. */
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const controller=new dom.window.AbortController(),nav=[],original=api.request;
 const calls=[];
 const ctx={root:document.querySelector('#root'),url:new URL(dom.window.location.href),signal:controller.signal,dict:dicts[locale],locale,theme,state:{},navigate:async(p,o)=>{nav.push({path:p,...o});},refresh(){},session:{user:{id:ID(1),name:'Fixture Staff',role,accountStatus:'active',photoPresent:false}}};
 const h={dom,ctx,nav,calls,controller,
  /** routes: {[pathOrPrefix]: value | (path,options)=>value}. First matching key wins; unknown => 503 ApiError. */
  stub(routes){api.request=async(path,options={})=>{calls.push({path,method:options.method??'GET',body:options.body});for(const [k,v] of Object.entries(routes)){if(path===k||path.startsWith(k+'?')||(k.endsWith('*')&&path.startsWith(k.slice(0,-1)))){const r=typeof v==='function'?await v(path,options):v;if(r instanceof Error)throw r;return r;}}const {ApiError}=await import('../../js/api-client.js');throw new ApiError(503,'service_unavailable');};},
  async mount(mod){await mod.mount(ctx);await tick();},
  q:s=>ctx.root.querySelector(s),qa:s=>[...ctx.root.querySelectorAll(s)],
  click:n=>n.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true})),
  input:(n,v)=>{n.value=v;n.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},
  change:(n,v)=>{n.value=v;n.dispatchEvent(new dom.window.Event('change',{bubbles:true}));},
  submit:f=>f.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})),
  /** Global tripwire: rendered text must never contain JS stringification artifacts (see F-17). */
  dispose(){const t=ctx.root.textContent;controller.abort();api.request=original;dom.window.close();privateScope.setScope(null);if(/(^|[^\w'])(null|undefined)([^\w']|$)|\[object /.test(t)&&!h.allowArtifacts)throw new Error('stray artifact text rendered: '+t.match(/.{0,30}(null|undefined|\[object ).{0,30}/)[0]);}};
 return h;
}
export const envelope=(kind,data)=>({version:1,kind,data});
export {api};
