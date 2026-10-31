import {el,listen,mountStaff,BackLink,errorText,centreDateTime,put} from './kit.js';
import {liveClasses,liveClassDetail,createLiveClass,patchLiveClass,checkLiveClassRecording} from '../../js/adapters/staff-final30/teacher.js';

const STAFF=['teacher','admin','owner'];

function formatDurationMinutes(seconds,dict){
 const s=Number(seconds||0);
 if(!Number.isFinite(s)||s<=0)return null;
 const mins=Math.max(1,Math.round(s/60));
 return `${mins} ${dict.common.minutes}`;
}

function youtubeSetupGuide(dict){
 const t=dict.liveClasses,g=t.guideSteps||{};
 const steps=[g.s1,g.s2,g.s3,g.s4,g.s5,g.s6,g.s7,g.s8,g.s9].filter(Boolean);
 if(!steps.length)return null;
 return el('details',{class:'card p-4 text-sm text-ink-700','data-youtube-setup-guide':''},
  el('summary',{class:'cursor-pointer font-medium text-ink-900'},t.guideTitle||'YouTube Live & OBS Setup Guide'),
  el('ol',{class:'mt-3 flex flex-col gap-1.5 text-xs text-ink-700'},steps.map(step=>el('li',{},step))));
}

function newClassForm(ctx,view,availableStudents=[]){
 const {dict,signal}=ctx,f=dict.formCopy,t=dict.liveClasses;
 const S=(ctx.state.newClass??={
  open:false,title:'',topic:'',scheduledAt:'',duration:'60',meetingUrl:'',
  youtubeUrl:'',accessScope:'course',studentIds:[],error:'',pending:false
 });
 if(!S.open){
  const b=el('button',{type:'button',class:'btn-secondary','data-new-class':''},`+ ${t.newClass}`);
  listen(b,'click',()=>{S.open=true;view.rerender();},signal);
  return b;
 }
 const bind=(node,key)=>{node.value=S[key];listen(node,'input',()=>{S[key]=node.value;},signal);return node;};
 const lab=(id,txt)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},txt);

 const title=bind(el('input',{id:'title',class:'input',required:'','data-focus-key':'nc-title'}),'title');
 const topic=bind(el('textarea',{id:'topic',class:'input min-h-[60px]'}),'topic');
 const when=bind(el('input',{id:'scheduledAt',type:'datetime-local',required:'',class:'input'}),'scheduledAt');
 const dur=bind(el('input',{id:'durationMinutes',type:'number',min:'15',max:'240',class:'input'}),'duration');
 const ytInput=bind(el('input',{id:'youtubeUrl',type:'text',placeholder:'dQw4w9WgXcQ / youtube.com/live/...',class:'input','data-youtube-input':''}),'youtubeUrl');
 const url=bind(el('input',{id:'meetingUrl',type:'url',placeholder:'https://...',class:'input'}),'meetingUrl');

 const scopeSelect=el('select',{id:'accessScope',class:'input','data-access-scope-select':''},
  el('option',{value:'course'},t.scopeCourse||'All active IELTS students'),
  el('option',{value:'teacher_roster'},t.scopeRoster||'My assigned students'),
  el('option',{value:'assigned'},t.scopeAssigned||'Selected students only'));
 scopeSelect.value=S.accessScope||'course';
 listen(scopeSelect,'change',()=>{S.accessScope=scopeSelect.value;view.rerender();},signal);

 let studentPicker=null;
 if(S.accessScope==='assigned'&&availableStudents.length>0){
  const selectedSet=new Set(S.studentIds||[]);
  studentPicker=el('div',{class:'flex flex-col gap-1.5 rounded-lg border border-ink-100 p-3','data-student-picker':''},
   el('span',{class:'text-xs font-medium text-ink-700'},t.selectStudentsLabel||'Assigned students'),
   el('div',{class:'grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2'},
    availableStudents.map(stu=>{
     const cb=el('input',{type:'checkbox',value:stu.id,'data-assign-student':stu.id});
     cb.checked=selectedSet.has(stu.id);
     listen(cb,'change',()=>{
      if(cb.checked)selectedSet.add(stu.id);else selectedSet.delete(stu.id);
      S.studentIds=[...selectedSet];
     },signal);
     return el('label',{class:'flex items-center gap-2 text-xs text-ink-900'},cb,el('span',{},stu.name));
    })));
 }

 const save=el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save);
 const cancel=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);
 listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);

 const form=el('form',{class:'card flex flex-col gap-3 p-4','data-new-class-form':''},
  el('div',{},lab('title',f.title),title),
  el('div',{},lab('topic',f.topicOptional),topic),
  el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2'},
   el('div',{},lab('scheduledAt',f.dateTime),when),
   el('div',{},lab('durationMinutes',f.durationMin),dur)),
  el('div',{},lab('youtubeUrl',t.youtubeUrlLabel||'YouTube Live URL or Video ID (Unlisted)'),ytInput,
   t.youtubeUrlHint?el('p',{class:'mt-1 text-xs text-ink-500'},t.youtubeUrlHint):null),
  el('div',{},lab('accessScope',t.accessScopeLabel||'Student access'),scopeSelect),
  studentPicker,
  el('div',{},lab('meetingUrl',f.meetingLinkOptional),url),
  S.error?el('p',{class:'text-sm text-band-bad',role:'alert'},S.error):null,
  el('div',{class:'flex gap-2'},save,cancel));

 listen(form,'submit',async e=>{
  e.preventDefault();
  if(S.pending||signal.aborted||!form.checkValidity())return;
  S.pending=true;S.error='';view.rerender();
  try{
   await createLiveClass({
    title:S.title,
    topic:S.topic,
    scheduledAt:S.scheduledAt,
    durationMinutes:S.duration,
    meetingUrl:S.meetingUrl,
    youtubeUrl:S.youtubeUrl||undefined,
    accessScope:S.accessScope!=='course'?S.accessScope:undefined,
    studentIds:S.accessScope==='assigned'?S.studentIds:undefined,
   },signal);
   if(signal.aborted)return;
   Object.assign(S,{pending:false,open:false,title:'',topic:'',scheduledAt:'',meetingUrl:'',youtubeUrl:'',accessScope:'course',studentIds:[]});
   view.rerender();
   await view.reload({quiet:true});
  }catch(x){
   if(signal.aborted)return;
   S.pending=false;S.error=errorText(x,dict);view.rerender();
  }
 },signal);
 return form;
}

function statusControls(ctx,c,view){
 const {dict,signal}=ctx,t=dict.liveClasses;
 const S=((ctx.state.classCtl??={})[c.id]??={pending:false,error:false,recordingUrl:'',checkNote:''});
 async function patch(body){
  if(S.pending||signal.aborted)return;
  S.error=false;S.checkNote='';S.pending=true;view.rerender();
  try{
   await patchLiveClass(c.id,body,signal);
   if(signal.aborted)return;
   S.pending=false;
   await view.reload({quiet:true});
  }catch{
   if(signal.aborted)return;
   S.pending=false;S.error=true;view.rerender();
  }
 }
 async function checkRec(){
  if(S.pending||signal.aborted)return;
  S.error=false;S.pending=true;view.rerender();
  try{
   const res=await checkLiveClassRecording(c.id,signal);
   if(signal.aborted)return;
   S.pending=false;
   S.checkNote=res?.lifecycleStatus?t.status[res.lifecycleStatus]||res.lifecycleStatus:'';
   await view.reload({quiet:true});
  }catch{
   if(signal.aborted)return;
   S.pending=false;S.error=true;view.rerender();
  }
 }
 const btn=(label,body,attrs={})=>{
  const b=el('button',{type:'button',class:'btn-secondary',disabled:S.pending,...attrs},label);
  listen(b,'click',()=>void patch(body),signal);
  return b;
 };
 const box=el('div',{class:'flex flex-wrap items-center gap-2'},
  S.error?el('p',{role:'alert',class:'text-sm text-band-bad'},dict.common.error):null,
  S.checkNote?el('span',{class:'text-xs text-ink-500','data-recording-check-note':''},S.checkNote):null);

 if(c.status==='upcoming'||c.status==='scheduled'){
  put(box,btn(t.markLive,{status:'live'},{'data-mark-live':c.id}));
 }
 if(c.status==='live'){
  put(box,btn(t.markCompleted,{status:'completed'},{'data-mark-completed':c.id}));
 }
 if(c.status==='completed'||c.status==='ended'||c.status==='recorded'){
  const i=el('input',{class:'input w-56',placeholder:'https://... recording','aria-label':t.recording,'data-focus-key':'rec-'+c.id});
  i.value=S.recordingUrl;
  const add=el('button',{type:'submit',class:'btn-secondary',disabled:S.pending||!S.recordingUrl},t.addRecording);
  listen(i,'input',()=>{S.recordingUrl=i.value;add.disabled=S.pending||!i.value;},signal);
  const form=el('form',{class:'flex items-center gap-2'},i,add);
  listen(form,'submit',e=>{e.preventDefault();void patch({recordingUrl:S.recordingUrl,status:'recorded'});},signal);
  put(box,form);
  if(c.hasYoutubeVideo){
   const chk=el('button',{type:'button',class:'btn-secondary',disabled:S.pending,'data-check-recording':c.id},t.checkRecording||'Check Recording');
   listen(chk,'click',()=>void checkRec(),signal);
   put(box,chk);
   if(c.recordingStatus!=='ready'&&c.status!=='recorded'){
    put(box,btn(t.markRecordingReady||'Mark Recording Ready',{recordingStatus:'ready',status:'recorded'},{'data-mark-recording-ready':c.id}));
   }
   if(c.recordingStatus==='processing'){
    put(box,btn(t.markRecordingUnavailable||'Mark Recording Unavailable',{recordingStatus:'unavailable',status:'completed'},{'data-mark-recording-unavailable':c.id}));
   }
  }
 }
 return box;
}

/** Source: teacher/live-classes/page.tsx + NewLiveClassForm + ClassStatusControls. Roles: teacher, admin, owner. */
export const listMount=mountStaff({
 name:'management-live-classes',
 roles:STAFF,
 load:c=>liveClasses(c.signal),
 render(ctx,data,view){
  const {dict,locale}=ctx,t=dict.liveClasses;
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},
   el('div',{class:'flex items-center justify-between'},
    el('h1',{class:'font-display text-2xl text-ink-900'},t.manageTitle),
    newClassForm(ctx,view,data.availableStudents||[])),
   youtubeSetupGuide(dict),
   el('div',{class:'flex flex-col gap-3'},data.classes.map(c=>{
    const statusKey=c.lifecycleStatus&&t.status[c.lifecycleStatus]?c.lifecycleStatus:c.status;
    return el('div',{class:'card flex flex-col gap-2 p-5','data-live-class':c.id},
     el('div',{class:'flex items-center justify-between gap-2'},
      el('div',{class:'min-w-0'},
       el('p',{class:'text-sm font-medium text-ink-900'},c.title),
       c.description?el('p',{class:'text-xs text-ink-500'},c.description):null),
      el('span',{class:c.status==='live'?'badge-live':'badge bg-signal-100 text-signal-700','data-class-badge':statusKey},t.status[statusKey]||t.status[c.status])),
     el('p',{class:'text-xs text-ink-300'},
      `${centreDateTime(c.scheduledAt,locale)} · ${c.durationMinutes} ${dict.common.minutes} · ${c.attendees} ${t.attendees}`+
      (c.youtubeVideoId?` · YouTube ID: ${c.youtubeVideoId}`:'')),
     el('div',{class:'flex flex-wrap items-center justify-between gap-2'},
      statusControls(ctx,c,view),
      el('div',{class:'flex items-center gap-2'},
       c.status!=='cancelled'?el('a',{href:`/app/live-classes/${c.id}`,class:'btn-ghost text-xs','data-open-live-room':c.id},t.openLessonRoom||'Open Live Room'):null,
       el('a',{href:`/app/teacher/live-classes/${c.id}`,class:'btn-secondary','data-class-roster-link':c.id},`${t.attendance} →`))));
   })));
 }
});

/** Source: teacher/live-classes/[id]/page.tsx. Meeting/recording URLs are shown only as Set/Not set (never exposed as raw URLs). */
export const detailMount=mountStaff({
 name:'management-live-class',
 roles:STAFF,
 notFoundBack:null,
 load:ctx=>liveClassDetail(ctx.url.pathname.split('/').filter(Boolean).at(-1),ctx.signal),
 render(ctx,d,view){
  const {dict,locale,signal}=ctx,t=dict.liveClasses,c=d.liveClass;
  const row=(l,v,attrs={})=>el('div',{class:'flex justify-between gap-3'},el('dt',{class:'text-ink-500'},l),el('dd',{class:'text-ink-900',...attrs},v));
  const statusKey=c.lifecycleStatus&&t.status[c.lifecycleStatus]?c.lifecycleStatus:c.status;

  const editState=(ctx.state.editDetail??={
   open:false,
   title:c.title,
   description:c.description||c.topic||'',
   youtubeVideoId:c.youtubeVideoId||'',
   accessScope:c.accessScope||'course',
   pending:false,
   error:'',
  });

  let editSection=null;
  if(editState.open){
   const titleIn=el('input',{class:'input',value:editState.title,'data-edit-title':''});
   listen(titleIn,'input',()=>{editState.title=titleIn.value;},signal);
   const descIn=el('textarea',{class:'input min-h-[60px]','data-edit-description':''});
   descIn.value=editState.description;
   listen(descIn,'input',()=>{editState.description=descIn.value;},signal);
   const ytIn=el('input',{class:'input',value:editState.youtubeVideoId,placeholder:'11-char YouTube ID','data-edit-youtube':''});
   listen(ytIn,'input',()=>{editState.youtubeVideoId=ytIn.value;},signal);
   const saveBtn=el('button',{type:'submit',class:'btn-primary',disabled:editState.pending},editState.pending?dict.common.saving:dict.common.save);
   const cancelBtn=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);
   listen(cancelBtn,'click',()=>{editState.open=false;view.rerender();},signal);
   editSection=el('form',{class:'card flex flex-col gap-3 p-4','data-edit-class-form':''},
    el('div',{},el('label',{class:'mb-1 block text-xs font-medium text-ink-700'},dict.formCopy.title),titleIn),
    el('div',{},el('label',{class:'mb-1 block text-xs font-medium text-ink-700'},dict.formCopy.topicOptional),descIn),
    el('div',{},el('label',{class:'mb-1 block text-xs font-medium text-ink-700'},t.youtubeUrlLabel||'YouTube Video ID'),ytIn),
    editState.error?el('p',{role:'alert',class:'text-sm text-band-bad'},editState.error):null,
    el('div',{class:'flex gap-2'},saveBtn,cancelBtn));
   listen(editSection,'submit',async e=>{
    e.preventDefault();
    if(editState.pending||signal.aborted)return;
    editState.pending=true;editState.error='';view.rerender();
    try{
     await patchLiveClass(c.id,{
      title:editState.title,
      description:editState.description,
      youtubeUrl:editState.youtubeVideoId,
     },signal);
     if(signal.aborted)return;
     editState.pending=false;editState.open=false;
     await view.reload({quiet:true});
    }catch(err){
     if(signal.aborted)return;
     editState.pending=false;editState.error=errorText(err,dict);view.rerender();
    }
   },signal);
  }

  const editToggle=el('button',{type:'button',class:'btn-secondary text-xs','data-toggle-edit-class':''},t.editClass||'Edit class');
  listen(editToggle,'click',()=>{
   editState.open=!editState.open;
   editState.title=c.title;
   editState.description=c.description||c.topic||'';
   editState.youtubeVideoId=c.youtubeVideoId||'';
   view.rerender();
  },signal);

  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},
   el('div',{},
    BackLink({fallbackHref:'/app/teacher/live-classes',label:t.manageTitle,'data-class-back':true}),
    el('div',{class:'mt-2 flex flex-wrap items-center justify-between gap-2'},
     el('h1',{class:'font-display text-2xl text-ink-900'},c.title),
     el('div',{class:'flex items-center gap-2'},
      editToggle,
      el('a',{href:`/app/live-classes/${c.id}`,class:'btn-primary text-xs','data-open-live-room':c.id},t.openLessonRoom||'Open Live Room & Chat'))),
    c.topic?el('p',{class:'mt-1 text-sm text-ink-500'},c.topic):null),
   editSection,
   el('div',{class:'card p-5'},
    el('dl',{class:'grid grid-cols-1 gap-2 text-sm sm:grid-cols-2'},
     row(t.status[c.status]||t.status[statusKey],t.status[statusKey]||t.status[c.status],{'data-class-status':c.status,'data-class-lifecycle':statusKey}),
     row(t.scheduled,centreDateTime(c.scheduledAt,locale)),
     row(t.duration,`${c.durationMinutes} ${dict.common.minutes}`),
     row(t.joinWindow,centreDateTime(d.opensAt,locale),{'data-class-window':d.joinState}),
     row(t.meetingLink,c.hasMeetingUrl?t.linkSet:t.linkMissing,{'data-class-has-link':c.hasMeetingUrl?'yes':'no'}),
     row(t.recording,c.hasRecordingUrl?t.linkSet:t.linkMissing,{'data-class-has-recording':c.hasRecordingUrl?'yes':'no'}),
     c.youtubeVideoId?row('YouTube ID',c.youtubeVideoId,{'data-class-youtube-id':c.youtubeVideoId}):null)),
   el('div',{class:'card p-5','data-class-roster':''},
    el('div',{class:'flex items-center justify-between'},
     el('h2',{class:'font-display text-lg text-ink-900'},t.attendance),
     el('span',{class:'text-sm text-ink-500','data-attendee-count':String(d.roster.length)},`${d.roster.length} ${t.attendees}`)),
    t.attendanceNote?el('p',{class:'mt-1 text-xs text-ink-500','data-attendance-note':''},t.attendanceNote):null,
    d.roster.length===0
     ?el('p',{class:'mt-2 text-sm text-ink-500','data-roster-empty':''},t.noAttendees)
     :el('ul',{class:'mt-2 flex flex-col divide-y divide-ink-100'},d.roster.map(r=>{
      const est=formatDurationMinutes(r.estimatedDurationSeconds,dict);
      const lastAct=r.lastSeenAt?centreDateTime(r.lastSeenAt,locale):null;
      return el('li',{class:'flex flex-wrap items-center justify-between gap-2 py-2','data-attendee':r.email??''},
       el('div',{class:'flex flex-col'},
        el('span',{class:'text-sm text-ink-900'},r.name),
        est||lastAct?el('span',{class:'text-xs text-ink-500','data-attendee-activity':''},
         [lastAct?`${t.lastActivity||'Last activity'}: ${lastAct}`:null,est?`${t.estimatedDuration||'Est. attendance'}: ${est}`:null].filter(Boolean).join(' · ')):null),
       el('span',{class:'text-xs text-ink-300','data-attended-at':''},centreDateTime(r.joinedAt,locale)));
     }))));
 }
});
