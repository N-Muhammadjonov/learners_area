import {api} from '../../js/api-client.js';
import {el, listen} from '../../js/dom.js';

const choices = ['not_marked','present','late','absent','excused'];

function translations(ctx) {
 return ctx.locale==='uz' ? {
  title:'Davomat',not_marked:'Belgilanmagan',present:'Qatnashdi',late:'Kechikdi',absent:'Qatnashmadi',
  excused:'Uzrli',reason:'Tuzatish sababi',eligible:'O‘tilgan darslar',attended:'Qatnashgan',
  empty:'Davomat yozuvi yo‘q.',prev:'Oldingi',next:'Keyingi',saved:'Davomat saqlandi',
  conflict:'Davomat o‘zgargan. Ro‘yxatni yangilang.',refresh:'Yangilash',
  required:'Oldingi belgini o‘zgartirish uchun sabab kiriting.',
  closed:'O‘qituvchi uchun tuzatish muddati tugagan.',
 } : {
  title:'Attendance',not_marked:'Not marked',present:'Present',late:'Late',absent:'Absent',
  excused:'Excused',reason:'Correction reason',eligible:'Held lessons',attended:'Attended',
  empty:'No attendance records.',prev:'Previous',next:'Next',saved:'Attendance saved',
  conflict:'Attendance has changed. Reload the roster.',refresh:'Reload',
  required:'Enter a reason to change a saved mark.',
  closed:'The teacher correction window has closed.',
 };
}

const btn = (text, attrs = {}) => el('button',{class:'btn-secondary',type:'button',...attrs},text);
const card = (title, body) => el('details',{class:'card space-y-2 p-3'},
 el('summary',{class:'cursor-pointer font-semibold'},title),body);

export function attendanceRoster(ctx, groupId, sessionId) {
 const t=translations(ctx), signal=ctx.signal, endpoint='/api/staff/academy/groups/'+groupId+'/sessions/'+sessionId+'/attendance';
 const body=el('div',{class:'space-y-2'}), panel=card(t.title,body);
 panel.dataset.academyAttendance='';
 const request=(path,options={})=>api.request(endpoint+path,{...options,signal});
 async function load(page, saved=false) {
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try {
   const data=await request('?page='+page);
   if(signal.aborted)return;
   if(!data.attendance.length){body.replaceChildren(el('p',{},t.empty));return;}
   const reason=el('input',{class:'input',minlength:3,maxlength:300});
   const error=el('p',{role:'alert',hidden:true});
   const selectors=new Map();
   const rows=data.attendance.map(row=>{
    const field=el('select',{class:'input'},choices.map(value=>el('option',{value,disabled:value==='not_marked'},t[value])));
    field.value=row.status;
    selectors.set(row,field);
    return el('label',{class:'grid items-center gap-2 sm:grid-cols-2'},row.name||row.student_user_id,field);
   });
   const save=btn(ctx.dict.common.save,{type:'submit',class:'btn-primary'});
   const form=el('form',{class:'space-y-3'},rows,el('label',{class:'block'},t.reason,reason),error,save);
   const prev=btn(t.prev,{disabled:page===1}), next=btn(t.next,{disabled:!data.hasNext});
   const reload=btn(t.refresh);
   let lastPayload='', commandId='';
   listen(prev,'click',()=>void load(page-1),signal);
   listen(next,'click',()=>void load(page+1),signal);
   listen(reload,'click',()=>void load(page),signal);
   listen(form,'submit',async event=>{
    event.preventDefault();
    if(save.disabled||signal.aborted)return;
    const changed=[...selectors].filter(([row,field])=>row.status!==field.value);
    if(!changed.length)return;
    if(changed.some(([row])=>row.status!=='not_marked')&&reason.value.trim().length<3){
     error.hidden=false;error.textContent=t.required;return;
    }
    const payload={marks:changed.map(([row,field])=>({studentId:row.student_user_id,revision:row.revision,status:field.value})),
     reason:reason.value.trim()||null};
    const serialized=JSON.stringify(payload);
    if(lastPayload!==serialized){lastPayload=serialized;commandId=crypto.randomUUID();}
    save.disabled=true;
    prev.disabled=true;
    next.disabled=true;
    reload.disabled=true;
    error.hidden=true;
    try {
     await request('',{method:'PUT',body:{...payload,id:commandId}});
     if(!signal.aborted)await load(page,true);
    }catch(cause){
     if(signal.aborted)return;
     error.hidden=false;
     error.textContent=({attendance_revision_conflict:t.conflict,attendance_reason_required:t.required,
      attendance_correction_window_closed:t.closed})[cause.code]??ctx.dict.common.error;
    }finally{
     save.disabled=false;prev.disabled=page===1;next.disabled=!data.hasNext;reload.disabled=false;
    }
   },signal);
   body.replaceChildren(...[saved?el('p',{role:'status'},t.saved):null,form,
    el('div',{class:'flex flex-wrap gap-2'},prev,next,reload)].filter(Boolean));
  } catch {
   if(signal.aborted)return;
   const retry=btn(t.refresh);
   listen(retry,'click',()=>load(page),signal);
   body.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }
 }
 listen(panel,'toggle',()=>{if(panel.open&&!body.childNodes.length)void load(1);},signal);
 return panel;
}

export function studentAttendance(ctx, endpoint, signal=ctx.signal) {
 const t=translations(ctx), body=el('div',{class:'space-y-2'}), panel=card(t.title,body);
 const clock=new Intl.DateTimeFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',{dateStyle:'medium',timeZone:'Asia/Tashkent'});
 async function load() {
  if(signal.aborted)return;
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try {
   const data=await api.request(endpoint,{signal});
   if(signal.aborted)return;
   const {counts,history}=data;
   body.replaceChildren(el('p',{},t.eligible+' '+counts.eligible+' · '+t.attended+' '+counts.attended),
    history.length?el('ul',{class:'space-y-2'},history.map(row=>el('li',{},
     [clock.format(new Date(row.starts_at)),row.group_name,t[row.status]].join(' · ')))):el('p',{},t.empty));
  }catch{
   if(signal.aborted)return;
   const retry=btn(t.refresh);
   listen(retry,'click',load,signal);
   body.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }
 }
 listen(panel,'toggle',()=>{if(panel.open&&!body.childNodes.length)void load();},signal);
 return panel;
}
