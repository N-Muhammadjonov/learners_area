/** Bounded, identity-scoped memory only; no persistent private data. */
export function createPrivateScope({limit=32,ttl=15000,maxBytes=2*1024*1024,clock=Date.now}={}){
 let scope=null,generation=0,revision=0,bytes=0;const cache=new Map(),resources=new Set(),listeners=new Set();
 function remove(key){const row=cache.get(key);if(row)bytes-=row.bytes;cache.delete(key);}
 function notify(reason){for(const fn of [...listeners])try{fn(reason);}catch{}}
 function clear(reason='clear'){generation++;revision++;cache.clear();bytes=0;notify(reason);for(const dispose of [...resources]){try{dispose(reason);}catch{}}resources.clear();}
 function inspect(key){const v=cache.get(key);if(!v||!scope||v.scope!==scope||v.expiry<=clock()){remove(key);return undefined;}cache.delete(key);cache.set(key,v);return {value:v.value,stale:v.freshUntil<=clock()};}
 return {get scope(){return scope;},get generation(){return generation;},get revision(){return revision;},setScope(next){if(next===scope)return;clear('scope-change');scope=next;},clear,
  own(dispose){resources.add(dispose);return()=>resources.delete(dispose);},
  inspect,
  get(key){const row=inspect(key);return row&&!row.stale?row.value:undefined;},
  put(key,value,{timeSensitive=false,ttl:fresh=ttl,staleTtl=0}={}){if(!scope||timeSensitive)return;let size;try{size=JSON.stringify(value).length*2;}catch{return;}if(size>maxBytes||!Number.isFinite(fresh)||fresh<0||!Number.isFinite(staleTtl)||staleTtl<0)return;remove(key);const now=clock();cache.set(key,{scope,value,bytes:size,freshUntil:now+fresh,expiry:now+fresh+staleTtl});bytes+=size;while(cache.size>limit||bytes>maxBytes)remove(cache.keys().next().value);},
  invalidate(prefix){revision++;for(const key of [...cache.keys()])if(key.startsWith(prefix))remove(key);notify('invalidate:'+prefix);},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},get bytes(){return bytes;},get size(){return cache.size;}};
}
export const privateScope=createPrivateScope();
