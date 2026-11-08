/** Bounded same-origin audio warmup for published unlocked Listening cards.
 * No playback, no persistent cache, no media grants or R2 public URLs.
 * Each request remains subject to the server's active-session/sequence policy.
 */
const AUDIO_PREFIX='/api/resources/listening/';
const MAX_PARALLEL=2;
const FIRST_BYTES=256*1024;
const MAX_CARDS=12;
function eligible(cards){
 return cards.filter(card=>!card.locked&&typeof card.testId==='string')
  .sort((a,b)=>Number(b.started||b.answerProgress?.state==='in_progress')-Number(a.started||a.answerProgress?.state==='in_progress'))
  .slice(0,MAX_CARDS);
}
async function warmOne(card,fetcher,signal,origin){
 const metadata=await fetcher('/api/listening/full/'+encodeURIComponent(card.testId)+'/authored?warmup=1',{
  credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}
 });
 if(!metadata.ok)return;
 const data=await metadata.json();
 if(signal.aborted||typeof data?.audioUrl!=='string')return;
 const url=new URL(data.audioUrl,origin);
 if(url.origin!==origin||!url.pathname.startsWith(AUDIO_PREFIX))return;
 // A byte range starts the authorized audio transfer without fetching entire
 // 16MB+ files for tests which may never be opened this visit.
 const response=await fetcher(url.pathname+url.search,{
  credentials:'same-origin',cache:'no-store',redirect:'error',signal,
  headers:{Range:'bytes=0-'+(FIRST_BYTES-1),Accept:'audio/*'}
 });
 if(response.status!==206){await response.body?.cancel().catch(()=>{});return;}
 const reader=response.body?.getReader();
 if(!reader)return;
 let count=0;
 try{
  while(count<FIRST_BYTES&&!signal.aborted){
   const {done,value}=await reader.read();
   if(done)break;
   count+=value?.byteLength||0;
  }
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
/** Abort when the catalogue route is left. Errors are strictly speculative. */
export function warmUnlockedAudio(cards,{signal,fetcher=globalThis.fetch.bind(globalThis),origin=globalThis.location?.origin}={}){
 if(!Array.isArray(cards)||!origin||signal?.aborted)return Promise.resolve();
 if(globalThis.navigator?.connection?.saveData)return Promise.resolve();
 const selected=eligible(cards);
 if(!selected.length)return Promise.resolve();
 let next=0;
 const run=async()=>{
  while(next<selected.length&&!signal?.aborted){
   const card=selected[next++];
   try{await warmOne(card,fetcher,signal,origin);}catch{/* Warmup must never block catalogue navigation. */}
  }
 };
 return Promise.all(Array.from({length:Math.min(MAX_PARALLEL,selected.length)},run)).then(()=>{});
}
