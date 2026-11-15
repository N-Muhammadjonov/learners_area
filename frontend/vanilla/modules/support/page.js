import {el} from '../../js/dom.js';
import {reportProblem} from '../shared/report.js';

/** Shared support destination: the utility form and staff inbox use the same reports. */
export async function mount(ctx){
 const {root,dict,signal,session,locale}=ctx,t=dict.support;
 const staff=['teacher','admin','owner'].includes(session?.user?.role);
 const host=el('main',{'data-support-page':'',class:'mx-auto flex max-w-4xl flex-col gap-4'},
  el('h1',{class:'font-display text-2xl text-ink-900'},locale==='uz'?'Yordam / Muammo':'Support / Feedback'),
  el('p',{class:'body-text'},t.subtitle));
 const form=reportProblem(ctx,{floating:false});
 host.append(el('section',{class:'card flex flex-col gap-3 p-4'},form));
 const info=el('section',{class:'card flex flex-col gap-2 p-4'},
  el('h2',{class:'card-title'},t.otherWaysTitle),el('p',{class:'body-text'},t.otherWaysBody));
 host.append(info);
 const inbox=staff?el('section',{'data-unified-support-inbox':'',class:'min-w-0'}):null;
 if(inbox)host.append(inbox);
 root.append(host);
 const dispose=()=>{form.dispose?.();host.remove();};
 if(signal.aborted){dispose();return dispose;}
 signal.addEventListener('abort',dispose,{once:true});
 if(staff){
  const {supportMount}=await import('../staff-final30/teacher.js');
  if(!signal.aborted)await supportMount({...ctx,root:inbox});
 }
 return dispose;
}
