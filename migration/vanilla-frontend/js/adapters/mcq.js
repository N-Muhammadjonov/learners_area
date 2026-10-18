import {ApiError} from '../api-client.js';
const stages=['listen','notes','committed','revealed','chosen','reasoned'],fields=['notes','ownAnswer','chosenAnswer','reasoning'];
const invalid=()=>{throw new ApiError(502,'invalid_mcq_adapter');};
/** Validate only presentation/transition DTOs. Never grade or infer server outcome. */
export function mcqPayload(p,questionId,sessionId){
 if(!p||typeof p.session?.id!=='string'||!p.session.id||!stages.includes(p.session.stage)||p.question?.id!==questionId||sessionId&&p.session.id!==sessionId)invalid();
 if(p.multiple!=null&&typeof p.multiple!=='boolean')invalid();
 if(p.options!==null&&(!Array.isArray(p.options)||p.options.some(o=>typeof o!=='string')||new Set(p.options).size!==p.options.length))invalid();
 if(stages.indexOf(p.session.stage)<3&&p.options!==null)invalid();
 if(p.outcome!=null&&!['correct','incorrect'].includes(p.outcome))invalid();
 if(stages.indexOf(p.session.stage)<4&&(p.outcome!=null||p.correctAnswer!=null||p.explanation!=null))invalid();
 for(const key of [...fields,'correctAnswer','explanation']){const v=fields.includes(key)?p.session[key]:p[key];if(v!=null&&typeof v!=='string')invalid();}
 if(p.next!==null&&(!p.next||!stages.includes(p.next.to)||p.next.field!==null&&!fields.includes(p.next.field)||!Number.isSafeInteger(p.next.minLength)||p.next.minLength<0))invalid();
 return p;
}
export function canAdvance(p,text){
 if(!p?.next)return false;const step=p.next;if(step.field===null)return true;
 if(typeof text!=='string'||text.trim().length<step.minLength)return false;
 if(step.field!=='chosenAnswer')return true;
 if(!p.multiple)return p.options?.includes(text)===true;
 try{const selected=JSON.parse(text);return Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length&&selected.every(v=>typeof v==='string'&&p.options?.includes(v));}catch{return false;}
}
export function mcqDay(d,number,role){
 if(!d||d.day!==number||typeof d.title!=='string'||typeof d.draft!=='boolean'||d.draft&&role==='student'||!d.status||!['not_started','in_progress','completed'].includes(d.status.state)||!Array.isArray(d.questions))invalid();
 const {total,completed}=d.status;if(!Number.isSafeInteger(total)||total!==d.questions.length||!Number.isSafeInteger(completed)||completed<0||completed>total||d.status.state==='completed'&&completed!==total)invalid();
 if(d.questions.some(q=>typeof q.id!=='string'||typeof q.questionText!=='string'||q.stage!==null&&!stages.includes(q.stage))||new Set(d.questions.map(q=>q.id)).size!==d.questions.length)invalid();
 if(d.audioUrl!=null&&typeof d.audioUrl!=='string')invalid();return d;
}
