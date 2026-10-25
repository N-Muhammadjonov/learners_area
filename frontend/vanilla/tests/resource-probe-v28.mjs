/** Diagnostic-only parent realm probe. Stores numeric handles and WeakRefs, not
 * DOM nodes/handlers. Does not claim native/OOPIF/universal browser coverage. */
export function installResourceProbeV28(){
 if(window!==top)return;
 const intervals=new Map(),timeouts=new Map(),rafs=new Map(),observers=new Map(),urls=new Set(),controllers=[],audio=[];let next=0;
 const owner=()=>new Error().stack.split('\n').slice(2,5).join('\n');
 const nativeInterval=setInterval,nativeClearInterval=clearInterval;window.setInterval=function(fn,ms,...args){const id=nativeInterval(fn,ms,...args);intervals.set(id,owner());return id;};window.clearInterval=function(id){intervals.delete(id);return nativeClearInterval(id);};
 const nativeTimeout=setTimeout,nativeClear=clearTimeout,nativeRAF=requestAnimationFrame,nativeCancel=cancelAnimationFrame;
 window.setTimeout=function(fn,ms,...args){let id;const stack=owner();id=nativeTimeout(function(...a){timeouts.delete(id);return typeof fn==='function'?fn.apply(this,a):eval(fn);},ms,...args);timeouts.set(id,stack);return id;};
 window.clearTimeout=function(id){timeouts.delete(id);return nativeClear(id);};
 window.requestAnimationFrame=function(fn){let id;const stack=owner();id=nativeRAF(t=>{rafs.delete(id);fn(t);});rafs.set(id,stack);return id;};
 window.cancelAnimationFrame=function(id){rafs.delete(id);return nativeCancel(id);};
 for(const name of ['MutationObserver','ResizeObserver']){const Native=window[name];if(!Native)continue;window[name]=class extends Native{constructor(cb){super(cb);this.__v27id=++next;this.__v27owner=owner();}observe(...a){observers.set(this.__v27id,{type:name,owner:this.__v27owner});return super.observe(...a);}disconnect(){observers.delete(this.__v27id);return super.disconnect();}};}
 const Abort=AbortController;window.AbortController=class extends Abort{constructor(){super();controllers.push({ref:new WeakRef(this),owner:owner()});}};
 const AudioNative=Audio;window.Audio=function(...a){const node=new AudioNative(...a);audio.push(new WeakRef(node));return node;};window.Audio.prototype=AudioNative.prototype;
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=function(...a){const url=create.apply(this,a);urls.add(url);return url;};URL.revokeObjectURL=function(url){urls.delete(url);return revoke.call(this,url);};
 let requests=0,peakRequests=0;const fetchNative=fetch;window.fetch=async function(...a){requests++;peakRequests=Math.max(requests,peakRequests);try{return await fetchNative.apply(this,a);}finally{requests--;}};
 window.__v27probe=()=>({intervals:[...intervals.values()],timers:[...timeouts.values()],rafs:[...rafs.values()],observers:[...observers.values()],urls:urls.size,unabortedControllers:controllers.map(r=>r.ref.deref()).filter(c=>c&&!c.signal.aborted).length,controllerOwners:controllers.filter(r=>{const c=r.ref.deref();return c&&!c.signal.aborted;}).map(r=>r.owner),requests,peakRequests,audio:audio.map(r=>r.deref()).filter(Boolean).map(a=>({paused:a.paused,hasSrc:!!a.getAttribute('src')})),frames:document.querySelectorAll('iframe').length,dialogs:document.querySelectorAll('[role=dialog],[data-review-recovery],[data-review-retained]').length});
}
