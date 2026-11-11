import {el} from '../../js/dom.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {fullExamStart} from './exam-start.js';
import {originalListeningEntry} from './original-entry.js';

export function secureExamGate(context,data,id){
 if(data.testId!==id||!uuid(id)||typeof data.title!=='string'||data.title.length>1000||data.attemptId!==null&&!uuid(data.attemptId))throw Error('Invalid exam gate');
 if(data.originalLayout)return originalListeningEntry(context,data,id);
 const uz=context.locale==='uz',{fullListeningHub:t}=context.dict,r=t.research;
 const names={review:r.review,script:r.script,mcq:r.mcq,map:r.map,multi:uz?'Bir nechta javob tanlash':'Choose Multiple Answers',completion:r.completion,vocab:r.vocabulary,recall:r.recall,matching:r.matching,retry:r.retry};
 const examAction=data.attemptId
  ? el('a',{href:'/app/listening/attempts/'+data.attemptId,class:'btn-primary w-fit','data-listening-resume':''},uz?'Testni davom ettirish':'Resume exam')
  : fullExamStart(context,{id,title:data.title,compact:true});
 const cards=el('div',{class:'listening-purpose-grid'},
  el('article',{class:'card flex flex-col items-start gap-4 listening-exam-purpose','data-listening-activity':'exam'},
   el('h2',{class:'font-display text-2xl font-bold'},r.full),examAction));
 const activities=Array.isArray(data.activities)?new Set(data.activities):new Set();
 for(const key of activities){
  if(!Object.hasOwn(names,key))continue;
  cards.append(el('article',{class:'card flex flex-col gap-3','data-listening-activity':key,'data-listening-activity-locked':''},
   el('h2',{class:'font-display text-2xl font-bold'},names[key]),el('p',{class:'text-sm text-ink-500'},t.locked)));
 }
 return el('section',{class:'listening-workspace listening-hub w-full space-y-6','data-listening-secure-gate':''},
  el('p',{class:'listening-eyebrow'},uz?'Mashqlar':'Activities'),el('h1',{class:'font-display text-4xl'},data.title),
  el('p',{class:'text-sm text-ink-500',role:'status'},uz?'Tahlil va mashqlar imtihonni topshirgach ochiladi.':'Review and study activities unlock after you submit the exam.'),cards);
}
