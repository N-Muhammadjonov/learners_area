import {api} from '../../js/api-client.js';
import {academyHelp} from '../shared/academy-help.js';
import {paymentDate} from '../payments/format.js';
import {el,listen} from '../../js/dom.js';
import {anySignal} from '../../js/signals.js';

const route='/api/staff/academy/rescue';
const fieldNames=['windowDays','attendancePercent','minimumMarkedSessions','overdueStreak','scoreDropPoints'];
const limits=[[7,90],[1,100],[2,20],[1,10],[1,100]];
const en={
 title:'Learner support',intro:'Review recorded signals before deciding how to help a learner.',
 all:'All learners',needs_support:'Support signal',no_signal:'No support signal',insufficient_data:'Insufficient data',
 attendance:'Attendance (%)',overdue_assignments:'Consecutive overdue assignments',ielts_practice_drop:'Practice score drop (points)',
 windowDays:'Observation window (days)',attendancePercent:'Minimum attendance (%)',minimumMarkedSessions:'Minimum marked sessions',
 overdueStreak:'Overdue assignments in a row',scoreDropPoints:'Practice score drop (points)',
 thresholds:'Support thresholds',save:'Save thresholds',saved:'Thresholds saved.',
 retry:'Retry',next:'Next',prev:'Previous',page:'Page',sample:'Records',limit:'Threshold',evidence:'Evidence IDs',
 empty:'No learners match this filter.',error:'Could not load the support queue.',
 stale:'These thresholds changed. Reload the queue before saving again.',failure:'Could not save the thresholds.',
 workflow:'Case status',open:'Open',claimed:'Claimed',resolved:'Resolved',dismissed:'Dismissed',
 claim:'Claim',assign:'Assign',note:'Note',plan:'Plan follow-up',follow_up:'Follow-up',resolve:'Resolve',dismiss:'Dismiss',reopen:'Reopen',
 action:'Action',reason:'Reason or note',assignee:'Assigned teacher',date:'Follow-up date',history:'Action history',
 saveAction:'Save action',actionError:'Could not save the action.',emptyHistory:'No actions recorded.',
 conflict:'This case changed. Reload the queue before trying again.',
};
const uz={
 title:'O‘quvchiga yordam',intro:'Yordam turini tanlashdan oldin qayd etilgan ma’lumotlarni ko‘rib chiqing.',
 all:'Barcha o‘quvchilar',needs_support:'Yordam belgisi',no_signal:'Yordam belgisi yo‘q',insufficient_data:'Ma’lumot yetarli emas',
 attendance:'Davomat (%)',overdue_assignments:'Ketma-ket kechikkan topshiriqlar',ielts_practice_drop:'Mashq natijasi pasayishi (punkt)',
 windowDays:'Kuzatuv davri (kun)',attendancePercent:'Minimal davomat (%)',minimumMarkedSessions:'Eng kam qayd etilgan darslar',
 overdueStreak:'Ketma-ket kechikkan topshiriqlar',scoreDropPoints:'Mashq natijasi pasayishi (punkt)',
 thresholds:'Yordam mezonlari',save:'Mezonlarni saqlash',saved:'Mezonlar saqlandi.',
 retry:'Qayta urinish',next:'Keyingi',prev:'Oldingi',page:'Sahifa',sample:'Qaydlar',limit:'Chegara',evidence:'Manba identifikatorlari',
 empty:'Bu filtrga mos o‘quvchi yo‘q.',error:'Yordam ro‘yxatini yuklab bo‘lmadi.',
 stale:'Mezonlar o‘zgargan. Saqlashdan oldin ro‘yxatni yangilang.',failure:'Mezonlarni saqlab bo‘lmadi.',
 workflow:'Ish holati',open:'Ochiq',claimed:'Biriktirilgan',resolved:'Hal qilindi',dismissed:'Yopildi',
 claim:'Qabul qilish',assign:'Biriktirish',note:'Qayd',plan:'Kuzatuvni rejalash',follow_up:'Kuzatuv',resolve:'Hal qilish',dismiss:'Yopish',reopen:'Qayta ochish',
 action:'Amal',reason:'Sabab yoki qayd',assignee:'Biriktirilgan o‘qituvchi',date:'Kuzatuv sanasi',history:'Amallar tarixi',
 saveAction:'Amalni saqlash',actionError:'Amalni saqlab bo‘lmadi.',emptyHistory:'Qayd etilgan amallar yo‘q.',
 conflict:'Ish holati o‘zgardi. Qayta urinishdan oldin ro‘yxatni yangilang.',
};

export function mount(ctx){
 const t=ctx.locale==='uz'?uz:en;
 const view=el('section',{class:'mx-auto max-w-5xl space-y-4','data-academy-rescue':''});
 const results=el('div',{class:'space-y-3'});
 const settings=el('div');
 const message=el('p',{role:'status'});
 const status=el('select',{'data-rescue-filter':''},
  el('option',{value:''},t.all),
  ...['needs_support','insufficient_data','no_signal'].map(key=>el('option',{value:key},t[key])));
 status.value='needs_support';
 const workflow=el('select',{'data-rescue-workflow-filter':''},
  el('option',{value:''},t.workflow),
  ...['open','claimed','follow_up','resolved','dismissed'].map(key=>el('option',{value:key},t[key])));
 let read;
 let page=1;
 let saving=false;
 view.append(el('h1',{class:'text-xl font-semibold'},t.title),el('p',{},t.intro),
  settings,message,el('div',{class:'flex flex-wrap gap-3'},
   el('label',{class:'flex items-center gap-2'},t.title,status),
   el('label',{class:'flex items-center gap-2'},t.workflow,workflow)),results);
 ctx.root.append(view);
 view.append(academyHelp(ctx,'rescue'));

 function button(label,action,disabled=false){
  const node=el('button',{type:'button',class:'btn-secondary',disabled},label);
  listen(node,'click',action,ctx.signal);
  return node;
 }

 function drawSettings(thresholds){
  if(ctx.session.user.role!=='owner')return;
  const form=el('form',{class:'grid gap-3 sm:grid-cols-2','data-rescue-thresholds':''});
  const fields=fieldNames.map((key,index)=>{
   const [min,max]=limits[index];
   const input=el('input',{type:'number',name:key,value:thresholds[key],min,max,step:1,required:true});
   form.append(el('label',{class:'grid gap-1'},t[key],input));
   return input;
  });
  const save=el('button',{type:'submit',class:'btn-primary'},t.save);
  const outcome=el('p',{role:'alert'});
  form.append(save,outcome);
  listen(form,'submit',async event=>{
   event.preventDefault();
   if(saving||!form.reportValidity())return;
   saving=true;
   save.disabled=true;
   outcome.textContent='';
   message.textContent='';
   const body=Object.fromEntries(fields.map(input=>[input.name,input.valueAsNumber]));
   try{
    await api.request(route+'/thresholds',{method:'PUT',signal:ctx.signal,body:{revision:thresholds.revision,...body}});
    if(ctx.signal.aborted)return;
    message.textContent=t.saved;
    await load(1);
   }catch(error){
    if(!ctx.signal.aborted)outcome.textContent=error.status===409?t.stale:t.failure;
   }finally{
    saving=false;
    save.disabled=false;
   }
  },ctx.signal);
  const detail=el('details',{class:'card p-3',open:settings.querySelector('details')?.open===true},
   el('summary',{class:'font-medium'},t.thresholds),form);
  settings.replaceChildren(detail);
 }

 function casePanel(item){
  const state=item.case;
  const user=ctx.session.user;
  const manager=user.role==='owner'||user.role==='admin';
  const path=route+'/'+item.groupId+'/'+item.studentId+'/actions';
  const closed=state.status==='resolved'||state.status==='dismissed';
  const ownCase=state.assignedTo===user.id;
  const options=[];
  if(closed){
   if(manager||ownCase)options.push('reopen');
  }else{
   if(state.status==='open'&&user.role==='teacher')options.push('claim');
   if(manager)options.push('assign');
   if(state.revision>0&&(manager||ownCase)){
    options.push('note','resolve','dismiss');
    if(state.status!=='open')options.push('plan');
    if(state.status==='follow_up')options.push('follow_up');
   }
  }
  const host=el('div',{class:'space-y-2'},el('p',{},t.workflow+' · '+t[state.status]+
   (state.followUpOn?' · '+state.followUpOn:'')));
  const log=el('div');
  const history=el('details',{},el('summary',{},t.history),log);
  async function showHistory(pageNumber){
   log.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
   try{
    const data=await api.request(path+'?page='+pageNumber,{signal:ctx.signal,fresh:true});
    if(ctx.signal.aborted)return;
    log.replaceChildren(data.items.length?el('ol',{class:'space-y-1'},...data.items.map(entry=>
     el('li',{},t[entry.action]+' · '+paymentDate(entry.createdAt,ctx.locale,'—')+' · '+entry.reason))):el('p',{},t.emptyHistory),
     button(t.prev,()=>void showHistory(pageNumber-1),pageNumber===1),
     button(t.next,()=>void showHistory(pageNumber+1),!data.hasNext));
   }catch{
    if(!ctx.signal.aborted)log.replaceChildren(el('p',{role:'alert'},t.error),button(t.retry,()=>void showHistory(pageNumber)));
   }
  }
  listen(history,'toggle',()=>{if(history.open)void showHistory(1);},ctx.signal);
  host.append(history);
  if(!options.length)return host;

  const action=el('select',{'data-rescue-action':''},...options.map(key=>el('option',{value:key},t[key])));
  const reason=el('textarea',{required:true,minlength:3,maxlength:300,rows:2});
  const assignee=el('select');
  const assigneeLabel=el('div',{},el('label',{class:'grid gap-1'},t.assignee,assignee));
  const followUp=el('input',{type:'date'});
  const dateLabel=el('div',{},el('label',{class:'grid gap-1'},t.date,followUp));
  const outcome=el('p',{role:'alert'});
  const save=el('button',{type:'submit',class:'btn-primary'},t.saveAction);
  const form=el('form',{class:'space-y-2','data-rescue-case-form':''},
   el('label',{class:'grid gap-1'},t.action,action),el('label',{class:'grid gap-1'},t.reason,reason),
   assigneeLabel,dateLabel,save,outcome);
  let retries;
  let loadingTeachers;
  async function choose(){
   const assign=action.value==='assign';
   assigneeLabel.hidden=!assign;
   assignee.required=assign;
   assignee.disabled=!assign;
   dateLabel.hidden=action.value!=='plan';
   followUp.required=action.value==='plan';
   followUp.disabled=action.value!=='plan';
   if(!assign||loadingTeachers||assignee.options.length)return;
   loadingTeachers=true;
   try{
    const {teachers}=await api.request(path+'/assignees',{signal:ctx.signal,fresh:true});
    if(ctx.signal.aborted)return;
    assignee.replaceChildren(el('option',{value:''},t.assignee),...teachers.map(teacher=>
     el('option',{value:teacher.id},teacher.name)));
   }catch{
    if(!ctx.signal.aborted)outcome.textContent=t.error;
   }finally{loadingTeachers=false;}
  }
  listen(action,'change',()=>void choose(),ctx.signal);
  listen(form,'submit',async event=>{
   event.preventDefault();
   if(save.disabled||!form.reportValidity())return;
   const content={revision:state.revision,action:action.value,reason:reason.value};
   if(action.value==='assign')content.assignee=assignee.value;
   if(action.value==='plan')content.followUpOn=followUp.value;
   const fingerprint=JSON.stringify(content);
   if(retries?.fingerprint!==fingerprint)retries={fingerprint,id:crypto.randomUUID()};
   save.disabled=true;
   outcome.textContent='';
   try{
    await api.request(path,{method:'POST',signal:ctx.signal,body:{id:retries.id,...content}});
    if(!ctx.signal.aborted)await load(page);
   }catch(error){
    if(!ctx.signal.aborted){
     outcome.textContent=error.status===409?t.conflict:t.actionError;
     if(error.status===409)outcome.append(' ',button(t.retry,()=>void load(page)));
    }
   }finally{save.disabled=false;}
  },ctx.signal);
  host.append(form);
  void choose();
  return host;
 }

 function drawItem(item){
  const window=item.observedWindow;
  const card=el('li',{class:'card space-y-2 p-3','data-rescue-student':item.studentId},
   el('h2',{class:'font-semibold'},item.studentName),
   el('p',{},item.groupName+' · '+t[item.status]),
   el('p',{class:'text-sm'},paymentDate(window.startsAt,ctx.locale,'—')+' – '+paymentDate(window.endsAt,ctx.locale,'—')));
  for(const entry of item.reasons){
   card.append(el('details',{class:'text-sm'},
    el('summary',{},t[entry.ruleId]+' · '+entry.value+' · '+t.limit+' '+entry.threshold+' · '+t.sample+' '+entry.sampleSize),
    el('p',{class:'break-all'},t.evidence+' · '+entry.evidenceIds.join(', '))));
  }
  if(item.case)card.append(casePanel(item));
  return card;
 }

 async function load(target){
  read?.abort();
  const controller=new AbortController();
  read=controller;
  const signal=anySignal([controller.signal,ctx.signal]);
  results.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  const query=new URLSearchParams({page:target});
  if(status.value)query.set('status',status.value);
  if(workflow.value)query.set('workflow',workflow.value);
  try{
   const value=await api.request(route+'?'+query,{signal,fresh:true});
   if(signal.aborted)return;
   page=value.page;
   drawSettings(value.thresholds);
   results.replaceChildren(value.items.length?el('ul',{class:'space-y-2'},...value.items.map(drawItem)):el('p',{},t.empty),
    el('div',{class:'flex flex-wrap items-center gap-2'},button(t.prev,()=>void load(page-1),page===1),
     el('span',{},t.page+' '+page),button(t.next,()=>void load(page+1),!value.hasNext)));
  }catch{
   if(!signal.aborted)results.replaceChildren(el('p',{role:'alert'},t.error),button(t.retry,()=>void load(target)));
  }
 }
 listen(status,'change',()=>void load(1),ctx.signal);
 listen(workflow,'change',()=>void load(1),ctx.signal);
 void load(1);
}
