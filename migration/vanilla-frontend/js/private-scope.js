/** Bounded, identity-scoped memory only; no persistent private data. */
export function createPrivateScope({limit=32,ttl=15000,clock=Date.now}={}){
 let scope=null,generation=0;const cache=new Map(),resources=new Set();
 function clear(reason='clear'){generation++;cache.clear();for(const dispose of [...resources]){try{dispose(reason);}catch{}}resources.clear();}
 return {get scope(){return scope;},get generation(){return generation;},setScope(next){if(next===scope)return;clear('scope-change');scope=next;},clear,
  own(dispose){resources.add(dispose);return()=>resources.delete(dispose);},
  get(key){const v=cache.get(key);if(!v||!scope||v.scope!==scope||v.expiry<=clock()){cache.delete(key);return undefined;}cache.delete(key);cache.set(key,v);return v.value;},
  put(key,value,{timeSensitive=false}={}){if(!scope||timeSensitive)return;cache.delete(key);cache.set(key,{scope,value,expiry:clock()+ttl});while(cache.size>limit)cache.delete(cache.keys().next().value);},
  invalidate(prefix){for(const key of cache.keys())if(key.startsWith(prefix))cache.delete(key);},get size(){return cache.size;}};
}
export const privateScope=createPrivateScope();
