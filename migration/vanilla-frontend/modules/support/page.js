import {el} from '../../js/dom.js';
import {reportProblem} from '../shared/report.js';
/** Source: main support/page.tsx. The same native report component is used by the shell utility. */
export function mount(ctx){
 const {root,dict,signal,session}=ctx,t=dict.support;
 const host=el('main',{'data-support-page':'',class:'mx-auto flex max-w-2xl flex-col gap-4'},
  el('h1',{class:'font-display text-2xl text-ink-900'},t.title),
  el('p',{class:'body-text'},t.subtitle));
 const form=reportProblem(ctx,{floating:false});
 host.append(el('section',{class:'card flex flex-col gap-3 p-4'},form));
 const info=el('section',{class:'card flex flex-col gap-2 p-4'},
  el('h2',{class:'card-title'},t.otherWaysTitle),el('p',{class:'body-text'},t.otherWaysBody));
 if(['teacher','admin','owner'].includes(session?.user?.role))info.append(el('a',{href:'/app/teacher/support',class:'btn-secondary self-start','data-support-inbox':''},t.inbox));
 host.append(info);root.append(host);
 const dispose=()=>{form.dispose?.();host.remove();};
 if(signal.aborted)dispose();else signal.addEventListener('abort',dispose,{once:true});
 return dispose;
}
