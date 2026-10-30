import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {notificationRead} from '../shared/notification-read.js';
import {RegionFailureNotice} from '../shared/presentation.js';
/** Original: notifications/page.tsx; direct existing GET /api/notifications, not proposed view DTO. */
export function parseNotifications(payload){
 if(payload?.ok!==true||!Array.isArray(payload.notifications)||!Number.isSafeInteger(payload.unread)||payload.unread<0)throw TypeError('invalid_notifications_response');
 const ids=new Set();return {unread:payload.unread,rows:payload.notifications.map(n=>{
  if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id)||typeof n.title!=='string'||!n.title||!Number.isFinite(Date.parse(n.createdAt))||n.readAt!=null&&!Number.isFinite(Date.parse(n.readAt)))throw TypeError('invalid_notification_row');
  ids.add(n.id);return n;
 })};
}
export function internalHref(raw){
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//')||/[\\\u0000-\u001f]/.test(raw))return null;
 try{const u=new URL(raw,'https://example.test');if(u.origin!=='https://example.test'||u.username||u.password)return null;return u.pathname+u.search+u.hash;}catch{return null;}
}
export function localizedNotification(n,t){
 const payload=n?.payload&&typeof n.payload==='object'&&!Array.isArray(n.payload)?n.payload:{};
 const fill=(template,values={})=>String(template??'').replace(/\{([a-zA-Z]+)\}/g,(_,key)=>typeof values[key]==='string'?values[key]:'');
 const title=typeof payload.assignmentTitle==='string'?payload.assignmentTitle:'';
 if(n?.type==='ASSIGNMENT_ASSIGNED')return {title:t.assignmentAssignedTitle??n.title,body:fill(t.assignmentAssignedBody,{title})};
 if(n?.type==='ASSIGNMENT_DEADLINE_APPROACHING')return {title:t.assignmentDeadlineTitle??n.title,body:fill(t.assignmentDeadlineBody,{title})};
 if(n?.type==='ASSIGNMENT_OVERDUE')return {title:t.assignmentOverdueTitle??n.title,body:fill(t.assignmentOverdueBody,{title})};
 if(n?.type==='WRITING_REVIEW_REQUIRED')return {title:t.writingReviewTitle??n.title,body:fill(t.writingReviewBody,{student:typeof payload.studentName==='string'?payload.studentName:''})};
 if(n?.type==='TEACHER_FEEDBACK_RECEIVED')return {title:t.teacherFeedbackTitle??n.title,body:t.teacherFeedbackBody??n.body};
 return {title:n?.title,body:n?.body};
}
export function mount(ctx){const {root,dict,signal,locale}=ctx,t=dict.notifications;
 const host=el('div',{class:'mx-auto flex max-w-2xl flex-col gap-4','data-route-usable':'notifications'},el('h1',{class:'font-display text-2xl text-ink-900'},t.title));
 const body=el('div',{'data-notifications-host':''});host.append(body);root.append(host);let generation=0;
 async function load(){const id=++generation;body.replaceChildren(el('div',{role:'status','aria-busy':'true',class:'h-28 animate-pulse rounded-xl bg-ink-50','data-async-loading':'notifications'},dict.common.loading));
  try{const payload=await api.request('/api/notifications',{signal});const {rows}=parseNotifications(payload);
   if(signal.aborted||id!==generation)return;
   const result=el('div',{class:'flex flex-col gap-3','data-notification-content':''});
   if(rows.length){result.append(notificationRead({ids:rows.filter(n=>!n.readAt).map(n=>n.id),label:t.markRead,errorLabel:dict.common.error,signal}));
    const list=el('div',{class:'flex flex-col gap-2'});
    for(const n of rows){const copy=localizedNotification(n,t);const row=el('section',{class:'card flex flex-col gap-1 p-4','data-notification-id':n.id},
      el('div',{class:'flex items-center justify-between gap-2'},el('span',{class:'text-sm font-medium text-ink-900'},copy.title),el('span',{class:'text-xs text-ink-300'},new Date(n.createdAt).toLocaleString(locale==='uz'?'uz-UZ':'en-GB',{timeZone:'Asia/Tashkent'}))));
     if(copy.body)row.append(el('p',{class:'text-sm text-ink-500'},String(copy.body)));
     const href=internalHref(n.href);if(href)row.append(el('a',{href,class:'text-xs text-signal-700 underline'},dict.common.continue));list.append(row);
    }
    result.append(list);
   }else result.append(el('div',{'data-notifications-empty':'',class:'card p-5'},t.empty));
   body.replaceChildren(result);
  }catch(e){if(signal.aborted||id!==generation)return;
   if(e?.status===401){void ctx.navigate('/login',{replace:true});return;}
   body.replaceChildren(RegionFailureNotice({region:'notifications',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}));
  }}
 signal.addEventListener('abort',()=>{generation++;body.replaceChildren();},{once:true});void load();
}
