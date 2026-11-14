import {api} from './api-client.js';
export const PUBLIC_LEVEL_KEY='la:level-check:v1';
const TTL=24*60*60*1000;
let pending;
/** Optional one-time guidance. Storage and import failures never delay navigation. */
export function consumePublicLevelHint(client=api,storage){
 if(pending)return pending;
 pending=(async()=>{
  try{
   storage??=globalThis.localStorage;
   const raw=storage?.getItem(PUBLIC_LEVEL_KEY);
   if(!raw)return;
   const remove=()=>{if(storage.getItem(PUBLIC_LEVEL_KEY)===raw)storage.removeItem(PUBLIC_LEVEL_KEY);};
   if(new TextEncoder().encode(raw).byteLength>4096){remove();return;}
   let data;try{data=JSON.parse(raw);}catch{remove();return;}
   const age=Date.now()-Date.parse(data?.created_at);
   if(data?.version!==1||data.source!=='public-level-check'||!Number.isFinite(age)||age < -60000||age>=TTL||!Array.isArray(data.raw_answers)||data.raw_answers.length!==17){remove();return;}
   try{await client.request('/api/study-plan/monthly/sequence/level/landing/import',{method:'POST',body:data});remove();}
   catch(error){if(error?.status===400)remove();}
  }catch{} // Optional storage can be unavailable in private browsing.
 })().finally(()=>{pending=undefined;});
 return pending;
}
