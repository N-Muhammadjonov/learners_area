import {el,listen,mountStaff,heading,errorText,centreDateTime,fill,badge,confirmSelect,pager,pageParam} from './kit.js';
import {confirmAction} from '../shared/confirm-action.js';
import {directory,ownerPresence,changeRole,changeStatus,deleteStudent} from '../../js/adapters/staff-final30/people.js';
import {ROLES,STATUSES,ROLE_LABELS,STATUS_LABELS} from '../../js/adapters/staff-final30/core.js';
/** Source: admin/people/page.tsx + PeopleTable.tsx + RoleSelect.tsx. Roles: admin, owner. */
export function peopleHref(filters,page){const p=new URLSearchParams();if(filters.q)p.set('q',filters.q);if(filters.role)p.set('role',filters.role);if(filters.status)p.set('status',filters.status);if(filters.online)p.set('online','1');if(page>1)p.set('page',String(page));const q=p.toString();return q?`/app/admin/people?${q}`:'/app/admin/people';}
export const queryOf=url=>{const g=k=>url.searchParams.get(k)??'';const role=g('role'),status=g('status');return {q:g('q').trim().slice(0,100),role:ROLES.includes(role)?role:'',status:STATUSES.includes(status)?status:'',online:g('online')==='1',page:pageParam(url)};};
/** The owner-only presence window shows real samples, not inferred past traffic. */
export function onlinePresenceWindow(ctx){
 const {locale,signal,navigate}=ctx;
 const uz=locale==='uz';
 const caption=(u,e)=>uz?u:e;
 const dialog=el('dialog',{class:'interaction-confirm-dialog','data-online-presence-dialog':'',
  'aria-label':caption('Hozir platformada','Currently on the platform'),
  style:{width:'min(1040px, calc(100vw - 24px))',maxWidth:'1040px',maxHeight:'min(90vh, 900px)',overflowY:'auto',padding:'22px'}});
 const close=el('button',{type:'button',class:'btn-secondary','data-online-presence-close':''},caption('Yopish','Close'));
 const refresh=el('button',{type:'button',class:'btn-secondary','data-online-presence-refresh':''},caption('Yangilash','Refresh'));
 const content=el('div',{'data-online-presence-content':'',role:'status'},caption('Yuklanmoqda…','Loading…'));
 const header=el('div',{class:'flex flex-wrap items-center justify-between gap-3'},
  el('h2',{class:'font-display text-2xl'},caption('Hozir platformada','Currently on the platform')),
  el('div',{class:'flex gap-2'},refresh,close));
 dialog.append(header,content);
 const open=()=>{if(!dialog.isConnected)document.body.append(dialog);
  if(!dialog.open){typeof dialog.showModal==='function'?dialog.showModal():dialog.setAttribute('open','');}
  void load();};
 const dismiss=()=>{if(dialog.open&&typeof dialog.close==='function')dialog.close();dialog.remove();};
 const routeLabel=path=>{
  const part=(path||'').split('/').filter(Boolean)[1]||'dashboard';
  const labels={reading:'Reading',listening:'Listening',writing:'Writing',
   speaking:'Speaking',vocabulary:'Vocabulary',grammar:'Grammar',
   assignments:'Assignments',admin:'Management',games:'Games',statistics:'Statistics'};
  return labels[part]||'Dashboard';
 };
 const duration=seconds=>seconds<60?caption('Hozirgina','Just now'):Math.floor(seconds/60)+caption(' daqiqa','m');
 const makeChip=p=>{
  const label=el('span',{class:'text-xs text-ink-500'},routeLabel(p.path)+' · '+duration(p.visitSeconds));
  const name=p.role==='student'
   ?el('a',{href:'/app/admin/people/'+p.id,class:'font-medium underline-offset-2 hover:underline',
     'data-online-student-progress':p.id},p.name)
   :el('span',{class:'font-medium'},p.name);
  return el('li',{class:'flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2 text-sm'},
   name,label);
 };
 function render(data){
  const stat=(heading,value,footnote)=>el('div',{class:'card flex-1 p-4'},
   el('p',{class:'text-xs font-semibold uppercase tracking-wider text-ink-500'},heading),
   el('strong',{class:'mt-1 block font-display text-3xl text-ink-900'},String(value)),
   el('p',{class:'mt-1 text-xs text-ink-500'},footnote));
  const counts=el('div',{class:'grid gap-3 sm:grid-cols-3'},
   stat(caption('HOZIR PLATFORMADA','ONLINE NOW'),data.onlineNow,caption('Oxirgi 90 soniyada faol','Active within 90 seconds')),
   stat(caption('BUGUN KIRGAN','VISITORS TODAY'),data.todayVisitors,caption('Kuzatuv boshlanganidan beri','Since sampling began')),
   stat(caption('ENG KO‘P (5 DAQIQA)','PEAK PER 5 MIN'),data.peakFiveMinute,caption('Bugungi eng yuqori 5 daqiqalik hisob','Highest sampled 5-minute window')));
  const buckets=new Map(data.buckets.map(b=>[Math.floor(b.bucketStart.getTime()/300000),b.activeUsers]));
  const now=new Date();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const midnight=new Date(today+'T00:00:00+05:00');
  const numberOfBuckets=Math.max(1,Math.min(288,Math.floor((now.getTime()-midnight.getTime())/300000)+1));
  const max=Math.max(1,data.peakFiveMinute);
  const bars=el('div',{class:'flex items-end gap-px overflow-hidden rounded-lg bg-ink-50 p-2',
    style:{height:'128px'},'data-online-presence-chart':''},
    Array.from({length:numberOfBuckets},(_,i)=>{
     const count=buckets.get(Math.floor(midnight.getTime()/300000)+i)||0;
     const bar=el('span',{title:count+' · '+String(i*5)+' min',
       class:'block min-w-0 flex-1 rounded-t-sm bg-signal-500',
       'data-online-presence-bar':'','data-count':String(count),
       style:{height:count?Math.max(3,Math.round(100*count/max))+'%':'1px',opacity:count?'0.85':'0.16'}});
     return bar;
    }));
  const history=el('section',{class:'space-y-2'},el('div',{class:'flex flex-wrap justify-between gap-2 text-xs text-ink-500'},
    el('strong',{},caption('BUGUN — HAR 5 DAQIQADA','TODAY — EVERY 5 MINUTES')),
    el('span',{},caption('Kuzatilgan faol foydalanuvchilar','Sampled active users'))),bars,
    el('p',{class:'text-xs text-ink-500'},caption(
     'Grafik faqat yozib olingan 5 daqiqalik faollikni ko‘rsatadi. Avvalgi kunlar ma’lumoti qayta yaratilmaydi.',
     'Chart shows recorded 5-minute activity only. Previous history is not invented.')));
  const list=el('ul',{class:'flex flex-wrap gap-2','data-online-presence-people':''},
   data.people.length?data.people.map(makeChip):el('li',{class:'text-sm text-ink-500'},
    caption('Hozir faol foydalanuvchi yo‘q','No active users right now')));
  const members=el('section',{class:'space-y-2'},el('h3',{class:'font-display text-lg'},
   caption('Hozir onlayn','Currently online')+' · '+data.onlineNow),
   list,data.truncated?el('p',{class:'text-xs text-ink-500'},
    caption('Birinchi 500 ta foydalanuvchi ko‘rsatilmoqda','Showing the first 500 users')):null);
  content.replaceChildren(counts,history,members);
  content.className='mt-4 space-y-5';
  content.removeAttribute('role');
 }
 async function load(){
  if(signal.aborted||refresh.disabled)return;
  refresh.disabled=true;
  try{
   const data=await ownerPresence(signal);
   if(!signal.aborted&&dialog.isConnected)render(data);
  }catch{
   if(!signal.aborted&&dialog.isConnected){
    content.className='mt-4 text-sm text-band-bad';
    content.setAttribute('role','alert');
    content.textContent=caption('Onlayn ma’lumotlarni yuklab bo‘lmadi. Qayta urinib ko‘ring.',
     'Unable to load presence data. Try again.');
   }
  }finally{refresh.disabled=false;}
 }
 listen(close,'click',dismiss,signal);
 listen(dialog,'cancel',e=>{e.preventDefault();dismiss();},signal);
 listen(refresh,'click',()=>void load(),signal);
 listen(dialog,'click',e=>{
  const a=e.target.closest?.('[data-online-student-progress]');
  if(!a||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  e.preventDefault();dismiss();void navigate(a.getAttribute('href'));
 },signal);
 signal.addEventListener('abort',()=>dialog.remove(),{once:true});
 return {dialog,open};
}
export const mount=mountStaff({name:'management-people',roles:['admin','owner'],pollMs:30000,
 load:ctx=>directory(queryOf(ctx.url),ctx.signal),
 render(ctx,data,view){
  const {dict,locale,signal,navigate}=ctx,t={...(locale==='uz'?{notTracked:'Kuzatilmagan',visitTime:'Tashrif',totalTime:'Jami vaqt',presenceNote:'Faollik 90 soniya ichida yangilanadi.'}:{notTracked:'Not tracked',visitTime:'Visit time',totalTime:'Total time',presenceNote:'Online activity is refreshed from the server.'}),...dict.people},L=locale==='en'?'en':'uz',S=(ctx.state.people??={busy:null,error:null,askId:null,reason:''});
  const label=(map,k)=>map[k][L];
  async function run(kind,person,value){
   S.busy=person.id;S.error=null;view.rerender();
   try{if(kind==='role')await changeRole(person.id,value,signal);else await changeStatus(person.id,value,S.reason,signal);if(kind==='status'){S.reason='';S.askId=null;}S.busy=null;await view.reload({quiet:true});}
   catch(e){if(signal.aborted)throw e;S.busy=null;S.error=`${t.failed} ${errorText(e,dict)}`;view.rerender();throw e;}
  }
  const roleControl=p=>{
   const locked=p.id===data.actorId||['owner','guardian'].includes(p.role)||!data.grantableRoles.length;
   if(locked)return el('span',{class:'text-xs text-ink-500'},label(ROLE_LABELS,p.role));
   const roles=[...new Set([p.role,...data.grantableRoles])];
   return confirmSelect({signal,value:p.role,disabled:S.busy===p.id,ariaLabel:`${t.role} for ${p.name}`,options:roles.map(r=>({value:r,label:label(ROLE_LABELS,r)})),title:t.confirmRoleTitle,description:t.confirmRoleBody,confirmLabel:dict.common.confirm,cancelLabel:dict.common.cancel,pendingLabel:dict.loadingPage.label,failureMessage:t.failed,onConfirm:v=>run('role',p,v)}).node;
  };
  const statusBadge=p=>badge(label(STATUS_LABELS,p.accountStatus),STATUS_LABELS[p.accountStatus].tone,{'data-account-status':p.accountStatus});
  const statusControl=p=>{
   if(p.id===data.actorId||p.role==='owner')return el('span',{class:'text-xs text-ink-300'},t.cannotChangeSelf);
   if(S.askId===p.id){
    const reason=el('input',{class:'input w-40 text-xs',placeholder:t.reason,maxlength:'500','aria-label':t.reason,'data-focus-key':'reason-'+p.id});reason.value=S.reason;listen(reason,'input',()=>{S.reason=reason.value;},signal);
    const go=el('button',{type:'button',class:'btn-primary text-xs',disabled:S.busy===p.id,'aria-busy':S.busy===p.id?'true':null,'data-interaction-type':'destructive'},t.suspend);
    listen(go,'click',()=>{void run('status',p,'suspended').catch(()=>undefined);},signal);
    const cancel=el('button',{type:'button',class:'btn-ghost text-xs'},dict.common.cancel);listen(cancel,'click',()=>{S.askId=null;view.rerender();},signal);
    return el('div',{class:'flex flex-wrap items-center gap-2'},reason,go,cancel);
   }
   if(['suspended','rejected'].includes(p.accountStatus)){
    const reactivate=confirmAction({signal,trigger:t.reactivate,triggerClassName:'btn-secondary text-xs',triggerDisabled:S.busy===p.id,title:t.confirmStatusTitle,description:t.confirmStatusBody,confirmLabel:dict.common.confirm,cancelLabel:dict.common.cancel,pendingLabel:dict.loadingPage.label,failureMessage:t.failed,onConfirm:()=>run('status',p,'active')}).node;
    if(p.accountStatus!=='suspended'||p.role!=='student'||data.actorRole!=='owner')return reactivate;
    const deleteLabel=L==='uz'?'Butunlay o‘chirish':'Delete permanently';
    const deleteDescription=L==='uz'?'${p.name} va unga tegishli ma’lumotlar butunlay o‘chiriladi. Bu amalni bekor qilib bo‘lmaydi.': '${p.name} and their data will be permanently deleted. This cannot be undone.';
    const remove=confirmAction({signal,trigger:deleteLabel,triggerClassName:'btn-secondary text-xs text-band-bad border-band-bad/50',triggerDisabled:S.busy===p.id,title:deleteLabel,description:deleteDescription.replace('${p.name}',p.name),confirmLabel:deleteLabel,cancelLabel:dict.common.cancel,pendingLabel:dict.loadingPage.label,failureMessage:t.failed,onConfirm:async()=>{
     S.busy=p.id;S.error=null;
     try{await deleteStudent(p.id,signal);S.busy=null;await view.reload({quiet:true});}
     catch(error){S.busy=null;S.error=`${t.failed} ${errorText(error,dict)}`;view.rerender();throw error;}
    }}).node;
    return el('div',{class:'flex flex-wrap items-center gap-2'},reactivate,remove);
   }
   const ask=el('button',{type:'button',class:'btn-secondary text-xs',disabled:S.busy===p.id},t.suspend);listen(ask,'click',()=>{S.askId=p.id;view.rerender();},signal);return ask;
  };
  const nameNode=p=>['owner','admin'].includes(data.actorRole)&&p.role==='student'?el('a',{href:`/app/admin/people/${p.id}`,class:'font-medium text-ink-900','data-people-name':''},p.name):el('span',{'data-people-name':'',class:'font-medium text-ink-900'},p.name);
  const you=p=>p.id===data.actorId?el('span',{class:'ml-2 badge bg-signal-100 text-signal-700'},t.you):null;
  const contact=p=>el('span',{class:'block text-xs text-ink-500'},el('span',{class:'block'},p.username?'@'+p.username:p.email??(p.telegramLinked?'Telegram':'—')),p.phoneNumber?el('span',{class:'block'},p.phoneNumber):null);
  const presence=p=>{
   if(data.actorRole!=='owner')return el('span',{'data-person-presence':'',class:'text-xs text-ink-300'},t.notTracked);
   const duration=secs=>secs==null?'—':`${Math.floor(secs/3600)}${L==='uz'?' soat':'h'} ${Math.floor(secs%3600/60)}${L==='uz'?' daq.':'m'} ${Math.floor(secs%60)}s`;
   const at=centreDateTime(p.seenAt??p.lastActiveAt,locale);
   return el('div',{'data-person-presence':'',class:'space-y-1 text-xs'},
    el('p',{'data-presence-state':p.online===true?'online':'offline'},p.online===true?'● Online':p.seenAt?'○ Offline':t.notTracked),
    el('p',{},`${L==='uz'?"So'nggi faollik":'Last activity'}: ${at||'—'}`),
    el('p',{},`${p.online?(L==='uz'?'Hozirgi tashrif':'Current visit'):t.visitTime}: ${duration(p.visitSeconds)}`),
    el('p',{},`${t.totalTime}: ${duration(p.totalSeconds)}`),
    el('p',{class:'text-ink-300'},L==='uz'?'Veb-sayt vaqti o‘qish vaqti emas.':'Website time is not study time.'));
  };
  const attrs=p=>({'data-person-id':p.id,'data-person-role':p.role,'data-person-status':p.accountStatus});
  const f=data.filters;
  const q=el('input',{id:'people-search',name:'q',type:'search',autocomplete:'off',maxlength:'100',class:'input w-full',placeholder:t.searchPlaceholder});q.value=f.q;
  const role=el('select',{id:'people-role',name:'role',class:'input w-full'},el('option',{value:''},t.allRoles),ROLES.map(r=>el('option',{value:r},label(ROLE_LABELS,r))));role.value=f.role??'';
  const status=el('select',{id:'people-status',name:'status',class:'input w-full'},el('option',{value:''},t.allStatuses),STATUSES.map(s=>el('option',{value:s},label(STATUS_LABELS,s))));status.value=f.status??'';
  const lab=(id,text)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},text);
  const form=el('form',{class:'panel flex flex-wrap items-end gap-3','data-people-search-form':''},f.online?el('input',{type:'hidden',name:'online',value:'1'}):null,el('div',{class:'min-w-[min(100%,16rem)] flex-1'},lab('people-search',t.searchLabel),q),el('button',{type:'submit',class:'btn-primary'},t.searchAction),el('div',{class:'min-w-[9rem] flex-1 sm:flex-none'},lab('people-role',t.role),role),el('div',{class:'min-w-[9rem] flex-1 sm:flex-none'},lab('people-status',t.status),status),el('a',{href:'/app/admin/people',class:'btn-secondary'},t.clearFilters));
  const onlineWindow=data.actorRole==='owner'?onlinePresenceWindow(ctx):null;
  const onlineButton=onlineWindow?el('button',{type:'button',class:'btn-secondary','data-people-online':'','aria-haspopup':'dialog'},`Online · ${data.onlineCount??'—'}`):null;
  if(onlineButton)listen(onlineButton,'click',onlineWindow.open,signal);
  const onlineControls=onlineWindow?el('div',{class:'flex flex-wrap items-center gap-3'},onlineButton,
   el('span',{class:'text-xs text-ink-500'},t.presenceNote)):null;
  listen(form,'submit',e=>{e.preventDefault();void navigate(peopleHref({q:q.value.trim().slice(0,100),role:role.value||undefined,status:status.value||undefined,online:f.online},1));},signal);
  const range=fill(t.showingRange,{start:data.total===0?0:(data.page-1)*data.pageSize+1,end:Math.min(data.page*data.pageSize,data.total),total:data.total});
  const empty=tag=>tag==='tr'?el('tr',{},el('td',{colspan:'5',class:'py-8 text-center text-sm text-ink-500','data-people-empty':''},t.noResults)):el('p',{class:'card text-sm text-ink-500','data-people-empty':''},t.noResults);
  const table=el('table',{class:'w-full text-left text-sm'},el('thead',{},el('tr',{class:'border-b border-ink-100 text-xs uppercase tracking-wide text-ink-300'},[t.name,t.role,t.status,t.activity,t.actions].map(x=>el('th',{class:'py-2 pr-3'},x)))),el('tbody',{},data.people.length===0?empty('tr'):data.people.map(p=>el('tr',{class:'border-b border-ink-100/70 last:border-0',...attrs(p)},el('td',{class:'py-2 pr-3'},nameNode(p),you(p),contact(p)),el('td',{class:'py-2 pr-3'},roleControl(p)),el('td',{class:'py-2 pr-3'},statusBadge(p),p.statusReason?el('span',{class:'block text-xs text-ink-300'},p.statusReason):null),el('td',{class:'py-2 pr-3 text-xs text-ink-500'},presence(p)),el('td',{class:'py-2'},statusControl(p))))));
  const cards=el('div',{class:'flex flex-col gap-3 md:hidden'},data.people.length===0?empty('p'):data.people.map(p=>el('div',{class:'card flex flex-col gap-2 p-4',...attrs(p)},el('div',{},el('p',{class:'text-sm font-medium text-ink-900'},nameNode(p),you(p)),contact(p)),el('div',{class:'flex flex-wrap items-center gap-2'},roleControl(p),statusBadge(p)),presence(p),statusControl(p))));
  return el('div',{class:'mx-auto flex flex-col gap-4','data-people-directory':''},heading(t.title,t.subtitle),
   el('div',{class:'flex flex-col gap-3'},S.error?el('p',{role:'alert',class:'text-xs text-band-bad'},S.error):null,
    onlineControls,
    form,
    el('div',{class:'flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500','aria-live':'polite'},el('span',{},fill(t.resultsCount,{count:data.total})),el('span',{},range)),
    el('div',{class:'hidden overflow-x-auto md:block'},table),cards,
    pager({label:t.title,page:data.page,totalPages:data.totalPages,href:n=>peopleHref(f,n),pageOf:t.pageOf,previous:t.previousPage,next:t.nextPage,attr:'data-people-pagination'})));
 }});
