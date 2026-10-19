/** One owned pending Review intent; reuses CheckpointWriter, never an automatic replay queue. */
const conflict=()=>Object.assign(Error('Pending Review conflicts with current server work; local answers retained.'),{status:409});
export function reviewIntent(value){
 if(!value||Object.keys(value).some(k=>!['version','user','test','attempt','body'].includes(k))||!value.body||Object.keys(value.body).some(k=>!['part','answers'].includes(k))||value.version!==1||typeof value.user!=='string'||typeof value.test!=='string'||typeof value.attempt!=='string'||!value.attempt||!Number.isInteger(value.body?.part)||value.body.part<1||value.body.part>4)throw conflict();
 const a=value.body.answers;if(!a||Array.isArray(a)||typeof a!=='object'||!Object.keys(a).length||Object.keys(a).length>40||Object.entries(a).some(([q,v])=>!/^([1-9]|[1-3][0-9]|40)$/.test(q)||typeof v!=='string'||!v.trim()||v.length>4000))throw conflict();
 return JSON.parse(JSON.stringify(value));
}
export class ReviewJournal {
 constructor(storage,key,user,test){Object.assign(this,{storage,key,user,test});}
 read(){const raw=this.storage.getItem(this.key);if(!raw)return null;if(raw.length>1000000)throw conflict();const v=reviewIntent(JSON.parse(raw));if(v.user!==this.user||v.test!==this.test)throw conflict();return v;}
 stage(body,attempt){const old=this.read();if(old&&old.attempt!==attempt)throw conflict();const v=reviewIntent({version:1,user:this.user,test:this.test,attempt,body:{...body,answers:{...old?.body.answers,...body.answers}}});this.storage.setItem(this.key,JSON.stringify(v));return v;}
 ack(body,expectedRaw){const raw=this.storage.getItem(this.key);if(expectedRaw!==undefined&&raw!==expectedRaw)return false;const current=this.read();if(!current||JSON.stringify(current.body)!==JSON.stringify(body)||this.storage.getItem(this.key)!==raw)return false;this.storage.removeItem(this.key);return true;}
 retained(){const raw=this.storage.getItem(this.key+':retained');if(!raw)return null;if(raw.length>1000000)throw conflict();const v=reviewIntent(JSON.parse(raw));if(v.user!==this.user||v.test!==this.test)throw conflict();return v;}
 /** Explicit learner action only. One bounded retained slot; never overwrite unresolved work. */
 archive(expected){const current=this.read();if(!current||JSON.stringify(current)!==JSON.stringify(expected))throw conflict();const previous=this.retained();if(previous&&JSON.stringify(previous)!==JSON.stringify(current))throw conflict();const bytes=JSON.stringify(current);this.storage.setItem(this.key+':retained',bytes);if(this.storage.getItem(this.key+':retained')!==bytes||JSON.stringify(this.read())!==bytes)throw conflict();this.storage.removeItem(this.key);}

}
/** Counts cannot prove which partial units committed. Never infer per-question ACKs.
 * A complete server Review can acknowledge the goal, NOT upload of these answer bytes. */
export function reconcileReview(intent,{user,test,attempt,examStatus,answers},progress){
 const v=reviewIntent(intent);if(v.user!==user||v.test!==test||v.attempt!==attempt||examStatus!=='submitted'||!progress?.activities?.review?.available)throw conflict();
 if(Object.entries(v.body.answers).some(([q,a])=>answers?.[q]!==a))throw conflict();
 return progress.activities.review.complete?'confirmed':'retry';
}

export async function reviewAttemptIdentity(own){if(typeof own.attemptKey==='string'&&own.attemptKey)return own.attemptKey;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({status:own.attemptStatus,answers:own.answers,results:own.lastResults})));return 'legacy:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
