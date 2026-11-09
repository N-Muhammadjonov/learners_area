import {el} from '../../js/dom.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {fullExamStart} from './exam-start.js';

export function secureExamGate(context,data,id){
 if(data.testId!==id||!uuid(id)||typeof data.title!=='string'||data.title.length>1000||data.attemptId!==null&&!uuid(data.attemptId))throw Error('Invalid exam gate');
 const uz=context.locale==='uz',host=el('section',{class:'mx-auto flex w-full max-w-5xl flex-col gap-4 p-4','data-listening-secure-gate':''},
  el('p',{class:'text-sm text-ink-500',role:'status'},uz?'Review va study mashqlari test topshirilgach ochiladi.':'Review and study activities unlock after you submit the exam.'));
 if(data.attemptId)host.append(el('h1',{class:'font-display text-2xl'},data.title),el('a',{href:'/app/listening/attempts/'+data.attemptId,class:'btn-primary w-fit','data-listening-resume':''},uz?'Testni davom ettirish':'Resume exam'));
 else host.append(fullExamStart(context,{id,title:data.title}));
 return host;
}
