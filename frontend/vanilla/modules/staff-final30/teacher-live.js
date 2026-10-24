import {el,listen,mountStaff,BackLink,errorText,centreDateTime,put} from './kit.js';
import {liveClasses,liveClassDetail,createLiveClass,patchLiveClass} from '../../js/adapters/staff-final30/teacher.js';
const STAFF=['teacher','admin','owner'];
function newClassForm(ctx,view){
 const {dict,signal}=ctx,f=dict.formCopy,S=(ctx.state.newClass??={open:false,title:'',topic:'',scheduledAt:'',duration:'60',meetingUrl:'',error:'',pending:false});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary','data-new-class':''},`+ ${dict.liveClasses.newClass}`);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const bind=(node,key)=>{node.value=S[key];listen(node,'input',()=>{S[key]=node.value;},signal);return node;};
 const lab=(id,t)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},t);
 const title=bind(el('input',{id:'title',class:'input',required:'','data-focus-key':'nc-title'}),'title'),topic=bind(el('textarea',{id:'topic',class:'input min-h-[60px]'}),'topic'),when=bind(el('input',{id:'scheduledAt',type:'datetime-local',required:'',class:'input'}),'scheduledAt'),dur=bind(el('input',{id:'durationMinutes',type:'number',min:'15',max:'240',class:'input'}),'duration'),url=bind(el('input',{id:'meetingUrl',type:'url',placeholder:'https://...',class:'input'}),'meetingUrl');
 const save=el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save),cancel=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 const form=el('form',{class:'card flex flex-col gap-3 p-4','data-new-class-form':''},el('div',{},lab('title',f.title),title),el('div',{},lab('topic',f.topicOptional),topic),el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2'},el('div',{},lab('scheduledAt',f.dateTime),when),el('div',{},lab('durationMinutes',f.durationMin),dur)),el('div',{},lab('meetingUrl',f.meetingLinkOptional),url),S.error?el('p',{class:'text-sm text-band-bad',role:'alert'},S.error):null,el('div',{class:'flex gap-2'},save,cancel));
 listen(form,'submit',async e=>{e.preventDefault();if(S.pending||signal.aborted||!form.checkValidity())return;S.pending=true;S.error='';view.rerender();
  try{await createLiveClass({title:S.title,topic:S.topic,scheduledAt:S.scheduledAt,durationMinutes:S.duration,meetingUrl:S.meetingUrl},signal);if(signal.aborted)return;Object.assign(S,{pending:false,open:false,title:'',topic:'',scheduledAt:'',meetingUrl:''});view.rerender();await view.reload({quiet:true});}
  catch(x){if(signal.aborted)return;S.pending=false;S.error=errorText(x,dict);view.rerender();}},signal);
 return form;
}
function statusControls(ctx,c,view){
 const {dict,signal}=ctx,S=((ctx.state.classCtl??={})[c.id]??={pending:false,error:false,recordingUrl:''});
 async function patch(body){if(S.pending||signal.aborted)return;S.error=false;S.pending=true;view.rerender();try{await patchLiveClass(c.id,body,signal);if(signal.aborted)return;S.pending=false;await view.reload({quiet:true});}catch{if(signal.aborted)return;S.pending=false;S.error=true;view.rerender();}}
 const btn=(label,body)=>{const b=el('button',{type:'button',class:'btn-secondary',disabled:S.pending},label);listen(b,'click',()=>void patch(body),signal);return b;};
 const box=el('div',{class:'flex flex-wrap items-center gap-2'},S.error?el('p',{role:'alert',class:'text-sm text-band-bad'},dict.common.error):null);
 if(c.status==='upcoming')put(box,btn(dict.liveClasses.markLive,{status:'live'}));
 if(c.status==='live')put(box,btn(dict.liveClasses.markCompleted,{status:'completed'}));
 if(c.status==='completed'||c.status==='recorded'){const i=el('input',{class:'input w-56',placeholder:'https://... recording','aria-label':dict.liveClasses.recording,'data-focus-key':'rec-'+c.id});i.value=S.recordingUrl;const add=el('button',{type:'submit',class:'btn-secondary',disabled:S.pending||!S.recordingUrl},dict.liveClasses.addRecording);
  listen(i,'input',()=>{S.recordingUrl=i.value;add.disabled=S.pending||!i.value;},signal);const form=el('form',{class:'flex items-center gap-2'},i,add);listen(form,'submit',e=>{e.preventDefault();void patch({recordingUrl:S.recordingUrl,status:'recorded'});},signal);put(box,form);}
 return box;
}
/** Source: teacher/live-classes/page.tsx + NewLiveClassForm + ClassStatusControls. Roles: teacher, admin, owner. */
export const listMount=mountStaff({name:'management-live-classes',roles:STAFF,load:c=>liveClasses(c.signal),
 render(ctx,data,view){const {dict,locale}=ctx,t=dict.liveClasses;
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('div',{class:'flex items-center justify-between'},el('h1',{class:'font-display text-2xl text-ink-900'},t.manageTitle),newClassForm(ctx,view)),
   el('div',{class:'flex flex-col gap-3'},data.classes.map(c=>el('div',{class:'card flex flex-col gap-2 p-5','data-live-class':c.id},el('div',{class:'flex items-center justify-between'},el('p',{class:'text-sm font-medium text-ink-900'},c.title),el('span',{class:'badge bg-signal-100 text-signal-700'},t.status[c.status])),
    el('p',{class:'text-xs text-ink-300'},`${centreDateTime(c.scheduledAt,locale)} · ${c.durationMinutes} ${dict.common.minutes} · ${c.attendees} ${t.attendees}`),
    el('div',{class:'flex items-center justify-between gap-2'},statusControls(ctx,c,view),el('a',{href:`/app/teacher/live-classes/${c.id}`,class:'btn-secondary','data-class-roster-link':c.id},`${t.attendance} →`))))));}});
/** Source: teacher/live-classes/[id]/page.tsx. Meeting/recording URLs are shown only as Set/Not set (never exposed). */
export const detailMount=mountStaff({name:'management-live-class',roles:STAFF,notFoundBack:null,load:ctx=>liveClassDetail(ctx.url.pathname.split('/').filter(Boolean).at(-1),ctx.signal),
 render(ctx,d){const {dict,locale}=ctx,t=dict.liveClasses,c=d.liveClass,row=(l,v,attrs={})=>el('div',{class:'flex justify-between gap-3'},el('dt',{class:'text-ink-500'},l),el('dd',{class:'text-ink-900',...attrs},v));
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('div',{},BackLink({fallbackHref:'/app/teacher/live-classes',label:t.manageTitle,'data-class-back':true}),el('h1',{class:'mt-2 font-display text-2xl text-ink-900'},c.title),c.topic?el('p',{class:'text-sm text-ink-500'},c.topic):null),
   el('div',{class:'card p-5'},el('dl',{class:'grid grid-cols-1 gap-2 text-sm sm:grid-cols-2'},row(t.status[c.status],t.status[c.status],{'data-class-status':c.status}),row(t.scheduled,centreDateTime(c.scheduledAt,locale)),row(t.duration,`${c.durationMinutes} ${dict.common.minutes}`),row(t.joinWindow,centreDateTime(d.opensAt,locale),{'data-class-window':d.joinState}),row(t.meetingLink,c.hasMeetingUrl?t.linkSet:t.linkMissing,{'data-class-has-link':c.hasMeetingUrl?'yes':'no'}),row(t.recording,c.hasRecordingUrl?t.linkSet:t.linkMissing,{'data-class-has-recording':c.hasRecordingUrl?'yes':'no'}))),
   el('div',{class:'card p-5','data-class-roster':''},el('div',{class:'flex items-center justify-between'},el('h2',{class:'font-display text-lg text-ink-900'},t.attendance),el('span',{class:'text-sm text-ink-500','data-attendee-count':String(d.roster.length)},`${d.roster.length} ${t.attendees}`)),
    d.roster.length===0?el('p',{class:'mt-2 text-sm text-ink-500','data-roster-empty':''},t.noAttendees):el('ul',{class:'mt-2 flex flex-col divide-y divide-ink-100'},d.roster.map(r=>el('li',{class:'flex items-center justify-between py-2','data-attendee':r.email??''},el('span',{class:'text-sm text-ink-900'},r.name),el('span',{class:'text-xs text-ink-300','data-attended-at':''},centreDateTime(r.joinedAt,locale)))))));}});
