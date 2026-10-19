import {validateExamValues} from './exam-validation-v15.js';
import {originalCheckpoint} from './original-policy-v11.js';
/** Single-flight checkpoint transport, not an exam engine. One latest own snapshot.
 * No automatic mutation retries: cancellation cannot undo a committed server write. */
export class CheckpointWriter {
 constructor({send,ack,status=()=>{},describe=()=>({}),signal}){Object.assign(this,{send,ack,status,describe});this.latest=null;this.active=null;this.saved=null;this.closed=false;this.blocked=false;this.failed=false;this.barrier=null;this.signal=signal;this.onAbort=()=>this.dispose();signal?.addEventListener('abort',this.onAbort,{once:true});if(signal?.aborted)this.dispose();}
 stage(values){if(this.closed)return null;const fingerprint=JSON.stringify(values);if(this.latest?.fingerprint===fingerprint)return this.latest;const before=this.latest,from=before&&this.describe(before.values),to=this.describe(values);if(before!==this.active?.entry&&from?.status==='in_progress'&&['submitted','exited'].includes(to.status)&&from.key===to.key)this.barrier=before;return this.latest={fingerprint,values:JSON.parse(fingerprint),requested:false};}
 save(values){const entry=this.stage(values);if(!entry||this.blocked)return;if(this.failed){this.status({phase:'error',error:this.lastError,blocked:false});return;}if(this.saved===entry.fingerprint&&!this.active&&!this.barrier){this.status({phase:'saved'});return;}entry.requested=true;this.drain();}
 retry(){if(this.closed||this.blocked||this.active||!this.latest)return;this.failed=false;this.save(this.latest.values);}
 async drain(){if(this.closed||this.blocked||this.failed||this.active||(!this.barrier&&!this.latest?.requested))return;const entry=this.barrier||this.latest;if(entry===this.barrier)this.barrier=null;entry.requested=false;const controller=new AbortController();this.active={entry,controller};this.status({phase:'saving'});
 try{const result=await this.send(entry.values,controller.signal);if(this.closed||controller.signal.aborted)return;
 // A superseded ACK may contain old answers. Never replace the newest draft/UI.
 this.saved=entry.fingerprint;if(this.latest.fingerprint===entry.fingerprint){this.ack(result,entry.values);this.status({phase:'saved'});}
 }catch(error){if(this.closed||controller.signal.aborted)return;this.blocked=[401,403,404].includes(error.status);const from=this.describe(entry.values),to=this.latest&&this.describe(this.latest.values);if(from.status==='in_progress'&&from.key===to?.key&&['submitted','exited'].includes(to.status))this.barrier=entry;this.saved=null;this.lastError=error;this.failed=true;entry.requested=false;this.status({phase:'error',error,blocked:this.blocked});}
 finally{if(this.active?.controller===controller)this.active=null;if(!this.closed&&!this.blocked&&(this.barrier||this.latest!==entry))this.drain();}
 }
 dispose(){this.signal?.removeEventListener('abort',this.onAbort);this.closed=true;this.active?.controller.abort();this.active=null;this.latest=null;this.barrier=null;}
}
export function checkpointMessage(error,locale='en'){
 const uz=locale.startsWith('uz'),status=error?.status;
 const pairs={401:['Session expired. Sign in again.','Sessiya tugadi. Qayta kiring.'],403:['Access denied or revoked. Recheck access before retrying.','Ruxsat yo‘q yoki bekor qilingan. Ruxsatni qayta tekshiring.'],404:['Attempt unavailable. Recheck access before retrying.','Urinish mavjud emas. Ruxsatni qayta tekshiring.'],409:['Attempt conflict. Your draft is retained; recheck the attempt before retrying.','Urinish holati mos emas. Javoblar saqlandi; urinishni qayta tekshiring.'],429:['Too many requests. Wait before retrying; your draft is retained.','So‘rovlar ko‘p. Kutib qayta urining; javoblar saqlandi.']};
 if(pairs[status])return pairs[status][uz?1:0];
 if(error?.name==='TimeoutError')return uz?'So‘rov vaqti tugadi. Javoblar saqlandi; qayta urinishingiz mumkin.':'Request timed out. Your draft is retained; you can retry.';
 if(status>=500)return uz?'Serverda xatolik. Javoblar saqlandi; qayta urinishingiz mumkin.':'Server unavailable. Your draft is retained; you can retry.';
 return uz?'Saqlash tasdiqlanmadi. Javoblar saqlandi; qayta urining.':'Save not confirmed. Your draft is retained; retry saving.';
}

/** A submit/exit ACK must confirm that transition, not merely return an open draft. */
export function checkpointAck(values,key,snapshot){validateExamValues(snapshot,key);const own=JSON.parse(snapshot[key]||'{}'),canonical=originalCheckpoint(values,key,own.attemptKey),returned=JSON.parse(canonical[key]||'{}');if(['submitted','exited'].includes(own.attemptStatus)&&returned.attemptStatus!==own.attemptStatus)throw Object.assign(Error('Unconfirmed attempt transition'),{status:409});return canonical;}

/** Replaying a new local attempt may require its missed start ACK first. A changed
 * authoritative identity is a conflict, NEVER permission to overwrite that attempt. */
export function checkpointReplay(serverValues,draft,key,intent){validateExamValues(serverValues,key);validateExamValues(draft,key);const own=JSON.parse(draft[key]||'{}'),server=JSON.parse(serverValues[key]||'{}');if(!own.attemptKey||own.attemptKey===server.attemptKey)return null;if(intent?.attemptKey!==own.attemptKey||(intent.previousKey??null)!==(server.attemptKey??null)||server.attemptStatus==='in_progress')throw Object.assign(Error('Authoritative attempt changed'),{status:409});if(own.attemptStatus==='in_progress')return null;return {...draft,[key]:JSON.stringify({...own,attemptStatus:'in_progress',submitted:false,lastResults:[]})};}
