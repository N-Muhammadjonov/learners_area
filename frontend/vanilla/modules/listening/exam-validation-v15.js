/** Existing authored-state contract only. No authorization, grading or new limits. */
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=()=>{throw Object.assign(Error('Malformed exam checkpoint'),{status:409});};
export function validateExamValues(values,key){
 if(!record(values)||Object.entries(values).some(([k,v])=>k.length>100||typeof v!=='string'||v.length>100000)||JSON.stringify(values).length>100000)bad();
 if(!key.startsWith('la_listening_test_')||values[key]===undefined)return values;
 let v;try{v=JSON.parse(values[key]);}catch{bad();}if(!record(v))bad();
 if(v.attemptStatus!==undefined&&!['none','in_progress','submitted','exited'].includes(v.attemptStatus))bad();
 if(v.attemptKey!==undefined&&(typeof v.attemptKey!=='string'||!uuid.test(v.attemptKey)))bad();
 if(['in_progress','submitted','exited'].includes(v.attemptStatus)&&!v.attemptKey)bad();
 for(const field of ['answers','reviewAnswers'])if(v[field]!==undefined){if(!record(v[field])||Object.entries(v[field]).some(([q,a])=>!/^([1-9]|[1-3][0-9]|40)$/.test(q)||typeof a!=='string'||a.length>(field==='answers'?500:4000)))bad();}
 for(const [field,max] of [['flags',40],['reviewChecked',4]])if(v[field]!==undefined&&(!Array.isArray(v[field])||v[field].length>max||new Set(v[field]).size!==v[field].length||v[field].some(q=>!Number.isInteger(q)||q<1||q>max)))bad();
 if(v.submitted!==undefined&&typeof v.submitted!=='boolean')bad();
 if((v.attemptStatus==='in_progress'&&(v.submitted===true||v.lastResults?.length))||(v.attemptStatus==='submitted'&&v.submitted===false)||(v.attemptStatus==='exited'&&v.submitted===true))bad();
 if(v.audioPosition!==undefined&&(!Number.isFinite(v.audioPosition)||v.audioPosition<0||v.audioPosition>7200))bad();
 if(v.lastResults!==undefined){if(!Array.isArray(v.lastResults)||v.lastResults.length>40)bad();const seen=new Set();for(const r of v.lastResults){if(!record(r)||Object.keys(r).some(k=>!['q','user','ok'].includes(k))||!Number.isInteger(r.q)||r.q<1||r.q>40||seen.has(r.q)||typeof r.user!=='string'||r.user.length>500||typeof r.ok!=='boolean')bad();seen.add(r.q);}}
 return values;
}
/** Semantic own-attempt baseline; UI/practice metadata is not a server revision. */
export function examStamp(values,key){const v=JSON.parse(values[key]||'{}');const sort=o=>Object.fromEntries(Object.entries(o||{}).sort(([a],[b])=>Number(a)-Number(b)));return JSON.stringify({key:v.attemptKey??null,status:v.attemptStatus??'none',answers:sort(v.answers),flags:[...(v.flags||[])].sort((a,b)=>a-b),reviewAnswers:sort(v.reviewAnswers),reviewChecked:[...(v.reviewChecked||[])].sort((a,b)=>a-b)});}
export function assertExamBaseline(server,key,baseline,desired){const stamp=examStamp(server,key);if(baseline!==null&&baseline!==undefined&&stamp!==baseline){if(desired&&stamp===examStamp(desired,key))return true;throw Object.assign(Error('Newer authoritative attempt state; local draft retained'),{status:409});}return false;}
/** Real browser cooperative mutex when available; NOT a server/cross-device lock. */
export function withExamTurn(name,signal,task,locks=globalThis.navigator?.locks){return locks?.request?locks.request(name,{signal},task):task();}


export function assertLegacyReplay(server,draft,key){const a=JSON.parse(server[key]||'{}'),b=JSON.parse(draft[key]||'{}');if(a.attemptKey&&a.attemptKey===b.attemptKey){const projected={...draft,[key]:JSON.stringify({...b,attemptStatus:a.attemptStatus})};assertExamBaseline(server,key,examStamp(projected,key));}}
