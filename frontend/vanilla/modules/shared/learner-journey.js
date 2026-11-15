import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';

const en={
 title:'Learner journey',empty:'No milestones recorded yet.',goal:'Study goal',band:'Target band',exam:'Exam date',
 group_joined:'Joined a group',attendance:'Class attendance',reading_completed:'Reading completed',
 listening_completed:'Listening completed',speaking_submitted:'Speaking submitted',writing_submitted:'Writing submitted',
 teacher_feedback:'Teacher feedback added',assignment_completed:'Assignment completed',
 present:'Present',late:'Late',absent:'Absent',excused:'Excused',previous:'Previous',next:'Next',retry:'Retry',
};
const uz={
 title:'O‘quv yo‘li',empty:'Hozircha o‘quv natijalari yo‘q.',goal:'O‘quv maqsadi',band:'Maqsad balli',exam:'Imtihon sanasi',
 group_joined:'Guruhga qo‘shildi',attendance:'Dars davomati',reading_completed:'Reading yakunlandi',
 listening_completed:'Listening yakunlandi',speaking_submitted:'Speaking topshirildi',writing_submitted:'Writing topshirildi',
 teacher_feedback:'O‘qituvchi fikr bildirdi',assignment_completed:'Topshiriq yakunlandi',
 present:'Qatnashdi',late:'Kechikdi',absent:'Qatnashmadi',excused:'Uzrli',previous:'Oldingi',next:'Keyingi',retry:'Qayta urinish',
};

export function learnerJourney(ctx,endpoint,signal=ctx.signal){
 const t=ctx.locale==='uz'?uz:en;
 const clock=new Intl.DateTimeFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',
  {timeZone:'Asia/Tashkent',dateStyle:'medium'});
 const body=el('div',{class:'space-y-3'});
 const panel=el('details',{class:'card space-y-3 p-3','data-learner-journey':''},
  el('summary',{class:'cursor-pointer font-semibold'},t.title),body);
 let reading=false;
 const button=(title,props)=>el('button',{type:'button',class:'btn-secondary',...props},title);
 async function load(page){
  if(reading||signal.aborted)return;
  reading=true;
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const data=await api.request(endpoint+'?page='+page,{signal,fresh:true});
   if(signal.aborted)return;
   const events=data.items.map(item=>{
    const heading=t[item.kind]??item.kind;
    const name=item.title?heading+' · '+item.title:heading;
    const detail=[item.status?t[item.status]:null,Number.isInteger(item.score)&&Number.isInteger(item.total)?
     item.score+'/'+item.total:null,clock.format(new Date(item.occurredAt))].filter(Boolean).join(' · ');
    const title=item.href?.startsWith('/app/')&&!item.href.includes('\\')?
     el('a',{href:item.href,class:'font-medium underline'},name):el('span',{class:'font-medium'},name);
    return el('li',{class:'border-b border-ink-100 pb-2'},title,el('p',{class:'text-sm'},detail));
   });
   const goal=data.goal;
   const goals=goal?[goal.targetBand==null?null:t.band+' '+goal.targetBand,
    goal.examDate?t.exam+' '+clock.format(new Date(goal.examDate)):null].filter(Boolean):[];
   const previous=button(t.previous,{disabled:page===1}),next=button(t.next,{disabled:!data.hasNext});
   listen(previous,'click',()=>void load(page-1),signal);
   listen(next,'click',()=>void load(page+1),signal);
   body.replaceChildren(...[
    goals.length?el('p',{class:'text-sm'},t.goal+' · '+goals.join(' · ')):null,
    events.length?el('ol',{class:'space-y-2'},events):el('p',{},t.empty),
    (page>1||data.hasNext)?el('div',{class:'flex gap-2'},previous,next):null,
   ].filter(Boolean));
  }catch{
   if(signal.aborted)return;
   const retry=button(t.retry);
   listen(retry,'click',()=>void load(page),signal);
   body.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }finally{reading=false;}
 }
 listen(panel,'toggle',()=>{if(panel.open&&!body.childNodes.length)void load(1);},signal);
 return panel;
}
