import {safeNextPath} from './safe-next.js';
export function compilePattern(pattern){return new RegExp('^'+pattern.split('/').map(s=>s.startsWith(':')?'([^/]+)':s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$');}
/** Lazy loaders return view cleanup. Aborted navigation can never replace a newer view. */
export function createRouter({root,routes,notFound,onError,canonicalize,prepare,commit,onStart,window:win=window}){
 let controller,cleanup,serial=0,entrySerial=0,state={};const entry=()=>Date.now().toString(36)+'-'+(++entrySerial);
 function historyKey(){if(typeof win.history.state?.__laEntry!=='string')win.history.replaceState({...win.history.state,__laEntry:entry()},'',win.location.href);return win.history.state.__laEntry;}
 async function render(navigation={}){const historyEntry=historyKey();if(!navigation.refresh){for(const k of Object.keys(state))delete state[k];state={};}const id=++serial;controller?.abort(navigation.refresh?'route-refresh':undefined);cleanup?.();cleanup=null;controller=new AbortController();const signal=controller.signal;
  let url=new URL(win.location.href);const canonical=canonicalize?.(url);if(canonical){win.history.replaceState(win.history.state,'',canonical);url=new URL(win.location.href);}const record=routes.find(r=>r.match.test(url.pathname));
  let context;try{onStart?.(url,{signal,navigate,route:record,source:navigation.source});context={url,signal,navigate,refresh,state,route:record,historyKey:historyEntry,preserveScroll:navigation.scroll===false};const extra=prepare?await prepare(context):undefined;if(signal.aborted||id!==serial)return;if(extra?.redirect){void navigate(extra.redirect,{replace:true});return;}Object.assign(context,extra);const view=await (record?.load??notFound)();if(signal.aborted||id!==serial)return;
   const staging=document.createElement('div');const dispose=await view.mount({...context,root:staging});
   if(signal.aborted||id!==serial){dispose?.();return;}
   if(commit)commit(staging,context);else root.replaceChildren(...staging.childNodes);cleanup=dispose;const heading=root.querySelector('h1')??root.querySelector('[data-shell-main]');if(heading&&!navigation.refresh){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }catch(error){if(!signal.aborted&&id===serial){controller.abort();cleanup?.();cleanup=null;const errorController=new AbortController();controller=errorController;const dispose=await onError(error,root,{...context,url,signal:errorController.signal,navigate,refresh});if(errorController.signal.aborted||id!==serial)dispose?.();else cleanup=dispose;}}
 }
 function refresh(){return render({refresh:true,scroll:false});}
 function navigate(target,{replace=false,scroll=true,source}={}){const safe=safeNextPath(target);if(!safe)throw new TypeError('Unsafe navigation');const url=new URL(safe,win.location.origin);if(url.origin!==win.location.origin)throw new TypeError('Unsafe origin');win.history[replace?'replaceState':'pushState']({__laEntry:replace?historyKey():entry()},'',url.pathname+url.search+url.hash);return render({scroll,source});}
 const click=e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download')||a.hasAttribute('data-native'))return;const u=new URL(a.href,win.location.href);if(u.origin!==win.location.origin||u.pathname.startsWith('/api/'))return;if(u.pathname===win.location.pathname&&u.search===win.location.search&&u.hash)return;e.preventDefault();void navigate(u.pathname+u.search+u.hash,{source:a});};
 win.addEventListener('popstate',render);root.addEventListener('click',click);
 return {navigate,refresh,start:render,destroy(){for(const k of Object.keys(state))delete state[k];++serial;controller?.abort();cleanup?.();root.removeEventListener('click',click);win.removeEventListener('popstate',render);}};
}
