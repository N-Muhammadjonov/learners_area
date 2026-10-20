import {resource} from '../../../js/adapters/listening-v7.js';
/** Bounded session-owned authenticated chunks. No capability URL enters child.
 * Replaying evicted, previously delivered byte ranges is permitted; arbitrary
 * not-yet-delivered offsets still are NOT a random-seek protocol. */
export class RangeMedia {
 constructor(items,emit,{fetch:read=globalThis.fetch.bind(globalThis),signal,onError=()=>{},onUnauthorized=()=>{},chunkSize=262144,maxCacheBytes=8*1024*1024,readTimeout=15000,cached}={}){
  if(!items.every(i=>resource(i.url))||!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>262144||!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<chunkSize||!Number.isFinite(readTimeout)||readTimeout<=0)throw Error('Invalid resource');
  Object.assign(this,{items,emit,read,onError,onUnauthorized,chunkSize,maxCacheBytes,readTimeout});this.abort=new AbortController();this.signal=AbortSignal.any([this.abort.signal,...(signal?[signal]:[])]);this.states=new Map();this.lru=new Map();this.cacheBytes=0;this.reading=0;this.waiters=[];
  if(cached&&JSON.stringify(cached.items)===JSON.stringify(items))for(const {meta,packet} of cached.entries){let state=this.states.get(packet.id);if(!state){state={...meta,cache:new Map(),pending:new Map()};this.states.set(packet.id,state);}this.remember(state,packet);}

 }
 async slot(signal){
  if(signal.aborted)throw signal.reason;
  if(this.reading<2){this.reading++;return;}
  await new Promise((resolve,reject)=>{const task={go:()=>{signal.removeEventListener('abort',cancel);this.reading++;resolve();}},cancel=()=>{const index=this.waiters.indexOf(task);if(index>=0)this.waiters.splice(index,1);reject(signal.reason);};signal.addEventListener('abort',cancel,{once:true});this.waiters.push(task);});
 }
 release(){this.reading--;this.waiters.shift()?.go();}
 remember(s,packet){const key=packet.id+':'+packet.offset;this.lru.set(key,{s,packet});s.cache.set(packet.offset,packet);this.cacheBytes+=packet.bytes.byteLength;
  while(this.cacheBytes>this.maxCacheBytes){const [old,{s:owner,packet:p}]=this.lru.entries().next().value;this.lru.delete(old);owner.cache.delete(p.offset);this.cacheBytes-=p.bytes.byteLength;}
 }
 async pull(id,offset=0){
  if(this.signal.aborted||!Number.isSafeInteger(offset)||offset<0)return;
  const item=this.items.find(i=>i.id===id);if(!item)return;let s=this.states.get(id);
  if(!s){s={offset:0,highWater:0,total:null,mime:null,etag:null,cache:new Map(),pending:new Map()};this.states.set(id,s);}
  if(s.cache.has(offset)){const packet=s.cache.get(offset),key=id+':'+offset,value=this.lru.get(key);this.lru.delete(key);this.lru.set(key,value);this.emit(packet);return;}
  if(offset>s.highWater||s.total!==null&&offset>=s.total)return;
  if(s.pending.has(offset))return s.pending.get(offset);
  // At most one read and one restart waiter per identity, two transports globally.
  if(s.pending.size){if(offset!==0)return;if(!s.restart)s.restart=[...s.pending.values()][0].then(()=>{s.restart=null;return this.pull(id,0);});return s.restart;}
  const work=(async()=>{let response,reader,ownsSlot=false;const signal=AbortSignal.any([this.signal,AbortSignal.timeout(this.readTimeout)]);
   const bounded=promise=>new Promise((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
   const cancelReader=()=>{void reader?.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',cancelReader,{once:true});
   try{
    if(this.reading<2)this.reading++;else await this.slot(signal);ownsSlot=true;if(signal.aborted)throw signal.reason;
    const url=new URL(item.url,location.origin);url.searchParams.set('download','1');const end=offset+this.chunkSize-1;
    for(let attempt=0;attempt<2;attempt++){
     response=await bounded(this.read(url.pathname+url.search,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Range:`bytes=${offset}-${end}`,...(s.etag?{'If-Range':s.etag}:{})},signal}));
     if(response.status===401){this.onUnauthorized();throw Error('Unauthorized');}if(response.status<500||attempt)break;await bounded(response.body?.cancel());
    }
    let total,finish;
    if(response.status===206){const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');if(!m)throw Error('Invalid range');const start=Number(m[1]);finish=Number(m[2]);total=Number(m[3]);if(![start,finish,total].every(Number.isSafeInteger)||start!==offset||finish<start||finish>end||total<=finish)throw Error('Invalid range');}
    else if(response.status===200&&offset===0){total=Number(response.headers.get('Content-Length'));if(!Number.isSafeInteger(total)||total<=0||total>this.chunkSize)throw Error('Ignored range');finish=total-1;}
    else throw Error('Range denied');
    const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase(),etag=response.headers.get('ETag');
    if(!/^(audio|video)\/[a-z0-9.+-]+$/.test(mime)||s.total!==null&&(mime!==s.mime||total!==s.total||etag!==s.etag))throw Error('Changed media');
    reader=response.body.getReader();const chunks=[];let length=0;
    for(;;){const part=await bounded(reader.read());if(part.done)break;length+=part.value.byteLength;if(length>finish-offset+1){void reader.cancel().catch(()=>{});throw Error('Oversized range');}chunks.push(part.value);}
    if(length!==finish-offset+1)throw Error('Truncated range');if(signal.aborted)throw signal.reason;
    const bytes=new Uint8Array(length);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength;}
    const packet={id,event:'chunk',offset,total,mime,bytes:bytes.buffer};s.total=total;s.mime=mime;s.etag=etag;s.offset=finish+1;s.highWater=Math.max(s.highWater,s.offset);this.remember(s,packet);this.emit(packet);
   }catch(error){if(!this.signal.aborted){this.emit({id,event:'error'});this.onError(error);}}
   finally{signal.removeEventListener('abort',cancelReader);if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}else if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});s.pending.delete(offset);if(ownsSlot)this.release();}
  })();s.pending.set(offset,work);return work;
 }
 prepare(){if(this.items[0])void this.pull(this.items[0].id);}
 cachedRanges(){return {items:this.items,entries:[...this.lru.values()].map(({s,packet})=>({meta:{offset:s.offset,highWater:s.highWater,total:s.total,mime:s.mime,etag:s.etag},packet}))};}
 dispose(){this.abort.abort();this.states.clear();this.lru.clear();this.cacheBytes=0;}
}
