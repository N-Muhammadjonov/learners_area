import {api} from '../../js/api-client.js';
import {el, listen} from '../../js/dom.js';
import {BackLink} from './kit.js';
import {academyLookup} from './academy-groups.js';

const BASE = '/api/staff/academy';
const PAGE = '/app/management/leads';
const ZONE = 'Asia/Tashkent';
const STAGES = ['new','contacted','trial_scheduled','trial_completed','enrolled','lost'];
const TRANSITIONS = {
 new:['new','contacted','lost'], contacted:['contacted','trial_scheduled','lost'],
 trial_scheduled:['trial_scheduled','trial_completed','lost'], trial_completed:['trial_completed','lost'],
};
const en={
 title:'Admissions pipeline',create:'Add lead',details:'Lead details',notes:'Notes',note:'Add note',
 convert:'Enroll existing student',course:'Course interest',owner:'Assigned staff',student:'Existing student',
 group:'Destination group',name:'Name',email:'Email',phone:'International phone',source:'Lead source',
 follow:'Follow-up (Tashkent)',trial:'Trial lesson (Tashkent)',lostReason:'Reason for loss',
 all:'All stages',mine:'Assigned to me',search:'Search by name, email or phone',apply:'Search',
 empty:'No leads match these filters.',next:'Next',previous:'Previous',save:'Save',saved:'Saved',
 conversion:'Conversion rate of closed leads',due:'Follow-ups due',noNotes:'No notes yet.',
 students:'Student profile',fullGroup:'The group is full.',choose:'Choose a student and group.',
 new:'New',contacted:'Contacted',trial_scheduled:'Trial scheduled',trial_completed:'Trial completed',
 enrolled:'Enrolled',lost:'Lost',
 lead_already_exists:'This email or phone already belongs to an open lead.',
 lead_revision_conflict:'This lead changed. Reload and review the current details.',
 lead_invalid_transition:'This lead cannot move to that stage.',
 trial_not_started:'The scheduled trial has not started yet.',
 lead_course_mismatch:'The selected group is for a different course.',
 lead_membership_already_linked:'This enrollment already belongs to another lead.',
 group_full:'The selected group is full.',
 student_has_current_group:'The student already belongs to another group for this course.',
 invalid_input:'Check the contact and dates. A trial stage requires a trial date.',
};
const uz={
 title:'Qabul jarayoni',create:'Nomzod qo‘shish',details:'Nomzod ma’lumotlari',notes:'Izohlar',note:'Izoh qo‘shish',
 convert:'Mavjud o‘quvchini guruhga yozish',course:'Qiziqqan kursi',owner:'Mas’ul xodim',student:'Mavjud o‘quvchi',
 group:'Qabul qiluvchi guruh',name:'Ism',email:'Email',phone:'Xalqaro telefon',source:'Nomzod manbasi',
 follow:'Bog‘lanish vaqti (Toshkent)',trial:'Sinov darsi (Toshkent)',lostReason:'Yo‘qotish sababi',
 all:'Barcha bosqichlar',mine:'Menga biriktirilgan',search:'Ism, email yoki telefon bo‘yicha qidiring',apply:'Qidirish',
 empty:'Mos nomzod topilmadi.',next:'Keyingi',previous:'Oldingi',save:'Saqlash',saved:'Saqlandi',
 conversion:'Yopilgan nomzodlar orasida yozilish ulushi',due:'Bog‘lanish vaqti kelgan',noNotes:'Izoh yo‘q.',
 students:'O‘quvchi profili',fullGroup:'Guruh to‘lgan.',choose:'O‘quvchi va guruhni tanlang.',
 new:'Yangi',contacted:'Bog‘lanildi',trial_scheduled:'Sinov darsi rejalangan',trial_completed:'Sinov darsi o‘tildi',
 enrolled:'Guruhga yozildi',lost:'Yo‘qotildi',
 lead_already_exists:'Bu email yoki telefonga tegishli faol nomzod mavjud.',
 lead_revision_conflict:'Nomzod ma’lumotlari o‘zgargan. Sahifani yangilang.',
 lead_invalid_transition:'Nomzodni bu bosqichga o‘tkazib bo‘lmaydi.',
 trial_not_started:'Belgilangan sinov darsi hali boshlanmagan.',
 lead_course_mismatch:'Tanlangan guruh boshqa kursga tegishli.',
 lead_membership_already_linked:'Bu a’zolik boshqa nomzodga bog‘langan.',
 group_full:'Tanlangan guruhda bo‘sh joy yo‘q.',
 student_has_current_group:'O‘quvchi bu kursning boshqa guruhiga yozilgan.',
 invalid_input:'Kontakt va sanalarni tekshiring. Sinov darsi bosqichi uchun sana kerak.',
};
const btn=(caption,attrs={})=>el('button',{type:'submit',class:'btn-primary',...attrs},caption);
const label=(caption,input)=>el('label',{class:'flex flex-col gap-1 text-sm'},caption,input);
const field=(type,attrs)=>el('input',{type,class:'input',...attrs});
const opt=(value,caption)=>el('option',{value},caption);
const href=(query={})=>PAGE+'?'+new URLSearchParams(query);

function localTime(date) {
 if(!date)return '';
 const clock=new Intl.DateTimeFormat('sv-SE',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return clock.format(new Date(date)).replace(' ','T');
}

// Future bookings use the academy's present civil offset and an explicit timezone on the wire.
const wireTime=value=>value?value+'+05:00':null;

function saveForm(ctx,t,node,caption,handle){
 const submit=btn(caption),error=el('p',{role:'alert',hidden:true});
 node.append(submit,error);
 listen(node,'submit',async event=>{
  event.preventDefault();
  if(submit.disabled||ctx.signal.aborted||!node.reportValidity())return;
  error.hidden=true;submit.disabled=true;
  try{await handle();}
  catch(cause){
   if(ctx.signal.aborted)return;
   error.hidden=false;
   error.textContent=Object.hasOwn(t,cause.code)?t[cause.code]:ctx.dict.common.error;
  }finally{submit.disabled=false;}
 },ctx.signal);
 return node;
}

function options(ctx,request,title,kind,id,name){
 return academyLookup(ctx,title,async q=>(await request('/lookups/'+kind+'?'+new URLSearchParams({q}))).options,
  false,id?[{id,label:name??id}]:[]);
}

function leadForm(ctx,t,request,lead,completed){
 const id=lead?.id??crypto.randomUUID();
 const name=field('text',{required:true,maxlength:120,value:lead?.name});
 const email=field('email',{maxlength:254,value:lead?.email});
 const phone=field('tel',{maxlength:40,value:lead?.phone,placeholder:'+998901234567'});
 const source=field('text',{required:true,maxlength:120,value:lead?.source});
 const follow=field('datetime-local',{value:localTime(lead?.follow_up_at)});
 const trial=field('datetime-local',{value:localTime(lead?.trial_at)});
 const loss=field('text',{maxlength:300});
 const stage=el('select',{class:'input'},(TRANSITIONS[lead?.stage]??['new']).map(s=>opt(s,t[s])));
 const course=options(ctx,request,t.course,'courses',lead?.course_id,lead?.course_title);
 const assignee=options(ctx,request,t.owner,'lead-assignees',lead?.assigned_to,lead?.assignee);
 const lossLabel=label(t.lostReason,loss);lossLabel.hidden=true;
 listen(stage,'change',()=>{lossLabel.hidden=stage.value!=='lost';loss.required=!lossLabel.hidden;},ctx.signal);
 const form=el('form',{class:'space-y-3','data-academy-lead-form':''},
  el('div',{class:'grid gap-2 sm:grid-cols-2'},label(t.name,name),label(t.source,source),
   label(t.email,email),label(t.phone,phone),label(t.follow,follow),label(t.trial,trial)),
  course.node,assignee.node,lead?label(t.all,stage):null,lossLabel);
 return saveForm(ctx,t,form,t.save,async()=>{
  const data={name:name.value.trim(),source:source.value.trim(),email:email.value.trim()||null,
   phone:phone.value.trim()||null,courseId:course.ids()[0]??null,assignedTo:assignee.ids()[0]??null,
   followUpAt:wireTime(follow.value),trialAt:wireTime(trial.value)};
  if(lead)await request('/leads/'+id,{method:'PUT',body:{...data,revision:lead.revision,
   stage:stage.value,lostReason:loss.value.trim()||null}});
  else await request('/leads',{method:'POST',body:{...data,id}});
  if(!ctx.signal.aborted)await completed(id);
 });
}

function conversion(ctx,t,request,lead,completed){
 const student=options(ctx,request,t.student,'student');
 const group=academyLookup(ctx,t.group,async q=>{
  const query=new URLSearchParams({q,status:'active',...(lead.course_id?{courseId:lead.course_id}:{})});
  const data=await request('/groups?'+query);
  return data.groups.map(item=>({id:item.id,label:item.name+' · '+item.branch}));
 });
 const form=el('form',{class:'card space-y-3 p-4','data-academy-lead-convert':''},student.node,group.node);
 return saveForm(ctx,t,form,t.convert,async()=>{
  const [studentId]=student.ids(),[groupId]=group.ids();
  if(!studentId||!groupId)throw {code:'invalid_input'};
  await request('/leads/'+lead.id+'/convert',{method:'POST',body:{studentId,groupId,revision:lead.revision}});
  if(!ctx.signal.aborted)await completed();
 });
}

function noteForm(ctx,t,request,lead,reload){
 const id=crypto.randomUUID();
 const content=el('textarea',{required:true,maxlength:1200,rows:3,class:'input'});
 const form=el('form',{class:'space-y-2','data-academy-lead-note':''},label(t.note,content));
 return saveForm(ctx,t,form,t.save,async()=>{
  await request('/leads/'+lead.id+'/notes',{method:'POST',body:{id,body:content.value.trim()}});
  if(!ctx.signal.aborted)await reload();
 });
}

function pages(t,page,next,route){
 return el('nav',{class:'flex gap-2','aria-label':t.title},
  page>1?el('a',{href:route(page-1),class:'btn-secondary'},t.previous):null,
  next?el('a',{href:route(page+1),class:'btn-secondary'},t.next):null);
}

export async function mount(ctx){
 if(!['owner','admin'].includes(ctx.session?.user?.role)||ctx.signal.aborted)return;
 const t=ctx.locale==='uz'?uz:en;
 const params=ctx.url.searchParams,selected=params.get('lead');
 const page=Math.max(1,Math.min(4000,Number.parseInt(params.get('page'),10)||1));
 const section=el('div',{class:'space-y-4'});
 const status=el('p',{role:'status'});
 ctx.root.append(el('div',{class:'mx-auto max-w-6xl space-y-4','data-academy-leads':''},
  BackLink({fallbackHref:selected?PAGE:'/app/management',label:ctx.dict.common.back}),
  el('h1',{class:'font-display text-3xl'},t.title),status,section));
 const request=(path,options={})=>api.request(BASE+path,{...options,signal:ctx.signal,fresh:true});
 async function reload(){
  if(ctx.signal.aborted)return;
  status.textContent=ctx.dict.common.loading;
  try{
   const content=selected?await detail():await catalogue();
   if(ctx.signal.aborted)return;
   section.replaceChildren(...content);
   status.textContent='';
  }catch(error){
   if(ctx.signal.aborted)return;
   const retry=btn(ctx.dict.common.retry??t.apply,{type:'button'});
   listen(retry,'click',reload,ctx.signal);
   section.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
   status.textContent='';
  }
 }
 async function catalogue(){
  const q=field('search',{maxlength:120,value:params.get('q')??''});
  const stage=el('select',{class:'input'},opt('',t.all),STAGES.map(key=>opt(key,t[key])));
  stage.value=params.get('stage')??'';
  const mine=field('checkbox',{checked:params.get('mine')==='true'});
  const fields=()=>({q:q.value.trim(),...(stage.value?{stage:stage.value}:{}),...(mine.checked?{mine:'true'}:{})});
  const filter=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.search,q),label(t.all,stage),
   el('label',{class:'flex gap-2'},mine,t.mine),btn(t.apply));
  listen(filter,'submit',e=>{e.preventDefault();void ctx.navigate(href(fields()));},ctx.signal);
  const data=await request('/leads?'+new URLSearchParams({...fields(),page}));
  const done=(data.stages.enrolled??0)+(data.stages.lost??0);
  const rate=done?new Intl.NumberFormat(ctx.locale,{style:'percent',maximumFractionDigits:1})
   .format((data.stages.enrolled??0)/done):'—';
  return [filter,el('div',{class:'grid gap-2 sm:grid-cols-4'},
   STAGES.map(s=>el('p',{class:'card p-3'},t[s]+' · '+(data.stages[s]??0))),
   el('p',{class:'card p-3'},t.due+' · '+data.followUpDue),
   el('p',{class:'card p-3'},t.conversion+' · '+rate)),
   el('details',{class:'card p-4'},el('summary',{class:'cursor-pointer font-semibold'},t.create),
    leadForm(ctx,t,request,null,id=>ctx.navigate(href({lead:id})))),
   data.leads.length?el('ul',{class:'grid gap-2 sm:grid-cols-2'},data.leads.map(row=>el('li',{class:'card space-y-2 p-4'},
    el('a',{href:href({lead:row.id}),class:'font-semibold underline'},row.name),
    el('p',{},[t[row.stage],row.source,row.course_title,row.assignee].filter(Boolean).join(' · ')),
    row.follow_up_at?el('p',{class:'text-sm'},t.follow+' · '+localTime(row.follow_up_at).replace('T',' ')):null))):
    el('p',{},t.empty),
   pages(t,page,data.hasNext,next=>href({...fields(),page:next}))];
 }
 async function detail(){
  const data=await request('/leads/'+encodeURIComponent(selected)+'?page='+page);
  const row=data.lead;
  const finished=async()=>{await reload();if(!ctx.signal.aborted)status.textContent=t.saved;};
  return [el('section',{class:'card space-y-3 p-4'},el('h2',{class:'font-display text-xl'},row.name),
   el('p',{},[t[row.stage],row.source,row.email,row.phone].filter(Boolean).join(' · ')),
   row.trial_at?el('p',{},t.trial+' · '+localTime(row.trial_at).replace('T',' ')):null,
   row.lost_reason?el('p',{},t.lostReason+' · '+row.lost_reason):null,
   row.student_user_id?el('a',{href:'/app/admin/people/'+row.student_user_id,class:'btn-secondary'},t.students):null,
   TRANSITIONS[row.stage]?leadForm(ctx,t,request,row,finished):null),
   ...(row.stage==='trial_completed'?[conversion(ctx,t,request,row,finished)]:[]),
   el('section',{class:'card space-y-2 p-4'},el('h2',{class:'font-semibold'},t.notes),
    data.notes.length?el('ul',{},data.notes.map(note=>el('li',{class:'border-b border-ink-100 py-2'},
     el('p',{},note.body),el('p',{class:'text-sm'},[note.author,localTime(note.created_at).replace('T',' ')].filter(Boolean).join(' · '))))):el('p',{},t.noNotes),
    noteForm(ctx,t,request,row,finished),pages(t,page,data.hasNext,p=>href({lead:row.id,page:p})))];
 }
 await reload();
}
