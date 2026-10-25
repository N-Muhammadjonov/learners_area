import {previousAppPath} from './return-navigation.js';
import {safeNextPath} from './safe-next.js';
export function compilePattern(pattern){return new RegExp('^'+pattern.split('/').map(s=>s.startsWith(':')?'([^/]+)':s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$');}
/** Lazy loaders return view cleanup. Aborted navigation can never replace a newer view. */
export function createRouter({root,routes,notFound,onError,canonicalize,prepare,commit,onStart,metrics,window:win=window}){
 const exactRoutes=new Map(routes.filter(r=>r.pattern&&!r.pattern.includes(':')).map(r=>[r.pattern,r])),dynamicRoutes=routes.filter(r=>!r.pattern||r.pattern.includes(':'));
 let controller,cleanup,sameDocument,serial=0,entrySerial=0,state={};const entry=()=>Date.now().toString(36)+'-'+(++entrySerial);
 function historyKey(){if(typeof win.history.state?.__laEntry!=='string')win.history.replaceState({...win.history.state,__laEntry:entry()},'',win.location.href);return win.history.state.__laEntry;}
 async function render(navigation={}){const historyEntry=historyKey();if(!navigation.refresh){for(const k of Object.keys(state))delete state[k];state={};}sameDocument=null;const id=++serial;controller?.abort(navigation.refresh?'route-refresh':undefined);cleanup?.();cleanup=null;controller=new AbortController();const signal=controller.signal;
  let url=new URL(win.location.href);const canonical=canonicalize?.(url);if(canonical){win.history.replaceState(win.history.state,'',canonical);url=new URL(win.location.href);}const record=exactRoutes.get(url.pathname)??(url.pathname.endsWith('/')?exactRoutes.get(url.pathname.slice(0,-1)||'/'):undefined)??dynamicRoutes.find(r=>r.match.test(url.pathname));
  const measurement=metrics?.begin({pattern:record?.pattern??'other',kind:navigation.refresh?'refresh':navigation.kind??'navigate',signal});
  let context;try{onStart?.(url,{signal,navigate,route:record,source:navigation.source});context={url,signal,navigate,back,refresh,onHistory:handler=>{if(!signal.aborted&&id===serial)sameDocument=handler;},state,route:record,historyKey:historyEntry,preserveScroll:navigation.scroll===false};measurement?.point('prepare-start');const extra=prepare?await prepare(context):undefined;measurement?.point('prepare-end');if(signal.aborted||id!==serial)return;if(extra?.redirect){measurement?.finish('redirected');void navigate(extra.redirect,{replace:true});return;}Object.assign(context,extra);measurement?.point('module-start');const view=await (record?.load??notFound)();measurement?.point('module-end');if(signal.aborted||id!==serial)return;
   const staging=document.createElement('div');measurement?.point('mount-start');const dispose=await view.mount({...context,root:staging});measurement?.point('mount-end');
   if(signal.aborted||id!==serial){dispose?.();return;}
   measurement?.point('commit-start');if(commit)commit(staging,context);else root.replaceChildren(...staging.childNodes);measurement?.point('commit-end');measurement?.finish('committed');cleanup=dispose;const heading=root.querySelector('h1')??root.querySelector('[data-shell-main]'),focus=navigation.focus?root.querySelector(navigation.focus):null;if(!navigation.refresh){if(focus)focus.focus({preventScroll:true});else if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  }catch(error){measurement?.finish('error');if(!signal.aborted&&id===serial){controller.abort();cleanup?.();cleanup=null;const errorController=new AbortController();controller=errorController;const dispose=await onError(error,root,{...context,url,signal:errorController.signal,navigate,refresh});if(errorController.signal.aborted||id!==serial)dispose?.();else cleanup=dispose;}}
 }
 function refresh(){return render({refresh:true,scroll:false});}
 function back(fallback='/app'){
  const safe=safeNextPath(fallback);if(!safe||!/^\/app(?:\/|\?|#|$)/.test(safe))throw new TypeError('Unsafe return destination');
  if(previousAppPath(win)&&win.history.length>1){win.history.back();return;}
  return navigate(safe,{replace:true});
 }
 function navigate(target,{replace=false,scroll=true,source,focus}={}){const safe=safeNextPath(target);if(!safe)throw new TypeError('Unsafe navigation');const url=new URL(safe,win.location.origin);if(url.origin!==win.location.origin)throw new TypeError('Unsafe origin');
  const from=replace?previousAppPath(win):win.location.pathname+win.location.search+win.location.hash;
  win.history[replace?'replaceState':'pushState']({__laEntry:replace?historyKey():entry(),...(from?{__laFrom:from}:{})},'',url.pathname+url.search+url.hash);return render({scroll,source,focus});}

 const click=e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download')||a.hasAttribute('data-native'))return;const u=new URL(a.href,win.location.href);if(u.origin!==win.location.origin||u.pathname.startsWith('/api/'))return;if(u.pathname===win.location.pathname&&u.search===win.location.search&&u.hash)return;e.preventDefault();void navigate(u.pathname+u.search+u.hash,{source:a});};
 const history=event=>{if(sameDocument?.(new URL(win.location.href),event)===true)return;void render({kind:'history'});};
 win.addEventListener('popstate',history);root.addEventListener('click',click);
 return {navigate,back,refresh,start:render,destroy(){for(const k of Object.keys(state))delete state[k];++serial;controller?.abort();cleanup?.();root.removeEventListener('click',click);win.removeEventListener('popstate',history);}};
}
