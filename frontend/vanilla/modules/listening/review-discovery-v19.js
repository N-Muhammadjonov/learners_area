/** Bounded same-user/test hints, never authority. Foreign source bytes are NEVER deleted.
 * Callers must freshly authorize session + canonical attempt + server own revisions.
 * The cooperating-browser recovery lock serializes copies, not backend commits.
 */
import {reviewIntent} from './review-recovery-v17.js';
const conflict=message=>Object.assign(Error(message+'; original Review bytes retained.'),{status:409});
const prefix=(user,test)=>`la-authored-listening:${user}:${test}:`;
export function reviewScopeKey(key,user,test){const p=prefix(user,test);return typeof key==='string'&&key.startsWith(p)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:review-v17$/.test(key.slice(p.length));}
const digest=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
export function reviewCandidates(storage,user,test,currentKey,{maxKeys=512,maxRecords=8,maxChars=2000000,offset=0}={}){
 const bound=(v,max)=>Number.isSafeInteger(v)&&v>0?Math.min(v,max):max;maxKeys=bound(maxKeys,512);maxRecords=bound(maxRecords,8);maxChars=bound(maxChars,2000000);offset=Number.isSafeInteger(offset)&&offset>=0?offset:0;
 const records=[];let chars=0,i=offset;const length=storage.length;
 for(;i<length&&i<offset+maxKeys&&records.length<maxRecords;i++){
  const key=storage.key(i);if(key===currentKey||!reviewScopeKey(key,user,test))continue;
  const raw=storage.getItem(key);if(raw===null)continue;
  if(raw.length>1000000||chars+raw.length>maxChars){records.push({key,state:'invalid'});continue;}chars+=raw.length;
  try{const intent=reviewIntent(JSON.parse(raw));if(intent.user!==user||intent.test!==test)throw conflict('Scope mismatch');records.push({key,raw,intent,state:'pending'});}catch{records.push({key,state:'invalid'});}
 }
 return {records,truncated:i<length,inspected:i-offset,nextOffset:i,chars};
}
function marker(storage,key){const raw=storage.getItem(key);if(raw===null)return null;if(raw.length>4096)throw conflict('Invalid recovery transfer hint');let v;try{v=JSON.parse(raw);}catch{throw conflict('Malformed recovery transfer hint');}if(v?.version!==1||!['pending','confirmed'].includes(v.state)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest)||typeof v.target!=='string'||Object.keys(v).some(k=>!['version','state','digest','target'].includes(k)))throw conflict('Invalid recovery transfer hint');return v;}
export async function reviewCandidateHint(storage,journal,candidate){
 if(!reviewScopeKey(candidate.key,journal.user,journal.test)||candidate.key===journal.key||storage.getItem(candidate.key)!==candidate.raw)throw conflict('Recovery record changed');
 const intent=reviewIntent(JSON.parse(candidate.raw));if(intent.user!==journal.user||intent.test!==journal.test)throw conflict('Recovery owner changed');
 const v=marker(storage,candidate.key+':transfer-v19');if(!v||v.digest!==await digest(candidate.raw))return 'available';
 if(!reviewScopeKey(v.target,journal.user,journal.test)||v.target===candidate.key)throw conflict('Invalid recovery target hint');
 if(v.state==='confirmed')return 'previously-confirmed';
 return storage.getItem(v.target)!==null?'copied':'available';
}
/** Explicit copy, under the shared recovery lock. Source stays untouched even after ACK:
 * localStorage has no cross-document compare-and-delete transaction. */
export async function copyReviewCandidate(storage,journal,candidate,{assertCurrent=()=>{}}={}){
 assertCurrent();const hint=await reviewCandidateHint(storage,journal,candidate);assertCurrent();
 if(hint!=='available')throw conflict('Recovery copy already exists');
 if(journal.read()||storage.getItem(journal.key)!==null)throw conflict('Resolve current-context work first');
 const hash=await digest(candidate.raw);assertCurrent();if(storage.getItem(candidate.key)!==candidate.raw)throw conflict('Recovery record changed');
 const link=JSON.stringify({version:1,state:'pending',digest:hash,target:journal.key}),key=candidate.key+':transfer-v19';
 // Persist the hint BEFORE copy. Failed/quota writes never erase source or target.
 storage.setItem(key,link);if(storage.getItem(key)!==link)throw conflict('Recovery transfer hint unavailable');
 if(journal.read()||storage.getItem(journal.key)!==null||storage.getItem(candidate.key)!==candidate.raw)throw conflict('Recovery changed while copying');
 storage.setItem(journal.key,candidate.raw);if(storage.getItem(journal.key)!==candidate.raw)throw conflict('Recovery copy unavailable');
 const provenance=JSON.stringify({version:1,source:candidate.key,digest:hash});storage.setItem(journal.key+':adoption-v19',provenance);
 if(storage.getItem(journal.key+':adoption-v19')!==provenance)throw conflict('Recovery provenance unavailable');
 return journal.read();
}
/** Typed owned ACK only. A receipt is a hint, never completion/authorization authority.
 * Failure leaves original bytes. No foreign record is removed, even on success. */
export async function acknowledgeReviewCopy(storage,journal,body,attempt){
 const key=journal.key+':adoption-v19',raw=storage.getItem(key);if(!raw)return false;if(raw.length>4096)throw conflict('Invalid recovery provenance');
 const link=JSON.parse(raw);if(link?.version!==1||Object.keys(link).some(k=>!['version','source','digest'].includes(k))||!reviewScopeKey(link.source,journal.user,journal.test)||link.source===journal.key||!/^[a-f0-9]{64}$/.test(link.digest))throw conflict('Invalid recovery provenance');
 const source=storage.getItem(link.source);if(!source||source.length>1000000||await digest(source)!==link.digest)return false;
 const intent=reviewIntent(JSON.parse(source));if(intent.user!==journal.user||intent.test!==journal.test||intent.attempt!==attempt||Object.entries(intent.body.answers).some(([q,a])=>body.answers?.[q]!==a))return false;
 const hintKey=link.source+':transfer-v19',hint=marker(storage,hintKey);if(hint?.digest!==link.digest||hint.target!==journal.key||storage.getItem(key)!==raw)return false;
 storage.setItem(hintKey,JSON.stringify({...hint,state:'confirmed'}));return true;
}
