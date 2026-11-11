import {el,listen,mountStaff,heading,errorText,centreDateTime,fill,badge,confirmSelect,pager,pageParam} from './kit.js';
import {confirmAction} from '../shared/confirm-action.js';
import {directory,changeRole,changeStatus,deleteStudent} from '../../js/adapters/staff-final30/people.js';
import {ROLES,STATUSES,ROLE_LABELS,STATUS_LABELS} from '../../js/adapters/staff-final30/core.js';
/** Source: admin/people/page.tsx + PeopleTable.tsx + RoleSelect.tsx. Roles: admin, owner. */
export function peopleHref(filters,page){const p=new URLSearchParams();if(filters.q)p.set('q',filters.q);if(filters.role)p.set('role',filters.role);if(filters.status)p.set('status',filters.status);if(filters.online)p.set('online','1');if(page>1)p.set('page',String(page));const q=p.toString();return q?`/app/admin/people?${q}`:'/app/admin/people';}
export const queryOf=url=>{const g=k=>url.searchParams.get(k)??'';const role=g('role'),status=g('status');return {q:g('q').trim().slice(0,100),role:ROLES.includes(role)?role:'',status:STATUSES.includes(status)?status:'',online:g('online')==='1',page:pageParam(url)};};
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
   const locked=p.id===data.actorId||p.role==='owner'||!data.grantableRoles.length;
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
  const nameNode=p=>data.actorRole==='owner'&&p.role==='student'?el('a',{href:`/app/admin/people/${p.id}`,class:'font-medium text-ink-900','data-people-name':''},p.name):el('span',{'data-people-name':'',class:'font-medium text-ink-900'},p.name);
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
  const onlineControls=data.actorRole==='owner'?el('div',{class:'flex flex-wrap items-center gap-3'},el('a',{href:peopleHref({...f,status:undefined,online:!f.online},1),class:f.online?'btn-primary':'btn-secondary','data-people-online':'','aria-current':f.online?'page':null},`Online · ${data.onlineCount??'—'}`),el('span',{class:'text-xs text-ink-500'},t.presenceNote)):null;
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
