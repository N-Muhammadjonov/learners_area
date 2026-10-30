import {previousAppPath} from './return-navigation.js';
import {safeNextPath} from './safe-next.js';
export function compilePattern(pattern){return new RegExp('^'+pattern.split('/').map(s=>s.startsWith(':')?'([^/]+)':s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$');}
/** Route flights and mounted views have separate lifetimes. Only explicit passive views are retained. */
export function createRouter({root,routes,notFound,onError,canonicalize,prepare,commit,onStart,onUpdate,metrics,reuse,window:win=window}){
 const exactRoutes=new Map(routes.filter(r=>r.pattern&&!r.pattern.includes(':')).map(r=>[r.pattern,r])),dynamicRoutes=routes.filter(r=>!r.pattern||r.pattern.includes(':'));
 let controller,active,sameDocument,serial=0,entrySerial=0,state={};
 const entry=()=>Date.now().toString(36)+'-'+(++entrySerial);
 function historyKey(){if(typeof win.history.state?.__laEntry!=='string')win.history.replaceState({...win.history.state,__laEntry:entry()},'',win.location.href);return win.history.state.__laEntry;}
 const dispose=(e,reason='route-left')=>{if(!e)return;e.controller.abort(reason);e.dispose?.();if(reason!=='route-refresh')for(const key of Object.keys(e.context.state??{}))delete e.context.state[key];};
 function leave(){if(!active)return;const old=active;active=null;if(!reuse?.put(old.key,old))dispose(old);}
 function focusDestination(navigation){if(navigation.refresh)return;const focus=navigation.focus?root.querySelector(navigation.focus):null,heading=root.querySelector('h1')??root.querySelector('[data-shell-main]');if(focus)focus.focus({preventScroll:true});else if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
 async function render(navigation={}){
  const historyEntry=historyKey();let url=new URL(win.location.href);const canonical=canonicalize?.(url);if(canonical){win.history.replaceState(win.history.state,'',canonical);url=new URL(win.location.href);}
  // A module may handle a safe same-page tab change without remounting its shell/tree.
  if(!navigation.refresh&&active?.navigate&&active.context.url.pathname===url.pathname&&!active.controller.signal.aborted&&(!active.context.session||active.context.session.expiresAt*1000>Date.now())){
   const inner=metrics?.begin({pattern:active.context.route?.pattern??'other',kind:'inner-navigation',signal:active.controller.signal});inner?.point('commit-start');
   if(active.navigate(url,navigation)===true){++serial;controller?.abort('same-page-navigation');active.context.url=url;active.context.historyKey=historyEntry;onUpdate?.(active.context);inner?.point('commit-end');inner?.finish('committed');focusDestination(navigation);return;}inner?.finish('delegated');
  }
  const id=++serial;controller?.abort(navigation.refresh?'route-refresh':'superseded');controller=new AbortController();const flight=controller,signal=flight.signal;
  if(active&&(navigation.refresh||!reuse?.eligible(active))){dispose(active,navigation.refresh?'route-refresh':'route-left');active=null;}
  if(!navigation.refresh){if(!active)for(const key of Object.keys(state))delete state[key];state={};}sameDocument=null;
  const record=exactRoutes.get(url.pathname)??(url.pathname.endsWith('/')?exactRoutes.get(url.pathname.slice(0,-1)||'/'):undefined)??dynamicRoutes.find(r=>r.match.test(url.pathname));
  const measurement=metrics?.begin({pattern:record?.pattern??'other',kind:navigation.refresh?'refresh':navigation.kind??'navigate',signal});
  let context,staging,cleanup;
  const resume=[],pause=[],hooks={history:null,navigate:null};
  try{
   onStart?.(url,{signal,navigate,route:record,source:navigation.source});
   context={url,signal,navigate,go:navigate,back,refresh,onHistory:handler=>{hooks.history=handler;if(active?.context===context)sameDocument=handler;},onNavigate:handler=>hooks.navigate=handler,onResume:handler=>resume.push(handler),onPause:handler=>pause.push(handler),state,route:record,historyKey:historyEntry,preserveScroll:navigation.scroll===false};
   // Public module code can load beside the authority read. No mount/data read precedes authorization.
   measurement?.point('module-start');const loading=Promise.resolve().then(()=> (record?.load??notFound)()).catch(error=>{const failure=new Error('Module could not load',{cause:error});failure.code='module_load_failed';throw failure;});loading.catch(()=>{});
   measurement?.point('prepare-start');const extra=prepare?await prepare(context):undefined;measurement?.point('prepare-end');
   if(signal.aborted||id!==serial)return;
   if(extra?.redirect){measurement?.finish('redirected');void navigate(extra.redirect,{replace:true});return;}Object.assign(context,extra);
   const key=url.pathname+url.search+url.hash;
   const saved=!navigation.refresh?reuse?.take(key):undefined;
   if(saved){
    leave();staging=saved.staging;context={...context,signal:saved.controller.signal,state:saved.context.state};
    measurement?.point('commit-start');if(commit)commit(staging,context);else root.replaceChildren(...staging.childNodes);measurement?.point('commit-end');
    saved.context=context;active=saved;controller=null;state=context.state;sameDocument=saved.history;measurement?.finish('committed');
    for(const fn of saved.resume)try{fn();}catch{}focusDestination(navigation);return;
   }
   const view=await loading;measurement?.point('module-end');if(signal.aborted||id!==serial)return;
   staging=document.createElement('div');measurement?.point('mount-start');const result=await view.mount({...context,root:staging});cleanup=typeof result==='function'?result:undefined;measurement?.point('mount-end');
   if(signal.aborted||id!==serial){cleanup?.();return;}
   const nodes=[...staging.childNodes];leave();
   measurement?.point('commit-start');if(commit)commit(staging,context);else root.replaceChildren(...staging.childNodes);measurement?.point('commit-end');
   active={controller:flight,dispose:cleanup,staging,nodes,context,key,resume,pause,history:hooks.history,navigate:hooks.navigate,...reuse?.stamp()};
   // The pending-flight handle must not abort a kept view on the next click.
   controller=null;sameDocument=hooks.history;measurement?.finish('committed');focusDestination(navigation);
  }catch(error){
   if(error?.name==='TypeError'&&/dynamically imported module|importing a module script|module script.*failed/i.test(error.message)){const failure=new Error('Module could not load',{cause:error});failure.code='module_load_failed';error=failure;}
   measurement?.finish('error');
   if(!signal.aborted&&id===serial){flight.abort();cleanup?.();leave();const errorController=new AbortController();controller=errorController;const result=await onError(error,root,{...context,url,signal:errorController.signal,navigate,refresh});const stop=typeof result==='function'?result:undefined;
    if(errorController.signal.aborted||id!==serial)stop?.();else{active={controller:errorController,dispose:stop,context:{...context,url},nodes:[],key:'error',resume:[]};controller=null;}}
  }
 }
 function refresh(){return render({refresh:true,scroll:false});}
 function back(fallback='/app'){
  const safe=safeNextPath(fallback);if(!safe||!/^\/app(?:\/|\?|#|$)/.test(safe))throw new TypeError('Unsafe return destination');
  if(previousAppPath(win)&&win.history.length>1){win.history.back();return;}return navigate(safe,{replace:true});
 }
 function navigate(target,{replace=false,scroll=true,source,focus}={}){
  const safe=safeNextPath(target);if(!safe)throw new TypeError('Unsafe navigation');const url=new URL(safe,win.location.origin);if(url.origin!==win.location.origin)throw new TypeError('Unsafe origin');
  const from=replace?previousAppPath(win):win.location.pathname+win.location.search+win.location.hash;
  win.history[replace?'replaceState':'pushState']({__laEntry:replace?historyKey():entry(),...(from?{__laFrom:from}:{})},'',url.pathname+url.search+url.hash);return render({scroll,source,focus});
 }
 const click=e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download')||a.hasAttribute('data-native'))return;const u=new URL(a.href,win.location.href);if(u.origin!==win.location.origin||u.pathname.startsWith('/api/'))return;if(u.pathname===win.location.pathname&&u.search===win.location.search&&u.hash)return;e.preventDefault();void navigate(u.pathname+u.search+u.hash,{source:a});};
 const history=event=>{const url=new URL(win.location.href);if(sameDocument?.(url,event)===true){if(active){active.context.url=url;active.context.historyKey=historyKey();onUpdate?.(active.context);}return;}void render({kind:'history'});};
 win.addEventListener('popstate',history);root.addEventListener('click',click);
 return {navigate,go:navigate,back,refresh,start:render,destroy(){++serial;controller?.abort();dispose(active);active=null;reuse?.destroy();state={};root.removeEventListener('click',click);win.removeEventListener('popstate',history);}};
}
