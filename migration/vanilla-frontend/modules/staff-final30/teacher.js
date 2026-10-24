import {el,listen,mountStaff,BackLink,errorText,centreDateTime,badge} from './kit.js';
import {students,studentDetail,sendFeedback,assignable,createAssignment,support,resolveReport} from '../../js/adapters/staff-final30/teacher.js';
import {renderResults} from './people-detail.js';
import {studentLearningPanel} from './learning-results.js';
import {UUID} from '../../js/adapters/staff-final30/core.js';
const STAFF=['teacher','admin','owner'];
const emptyState=(title)=>el('div',{class:'panel flex flex-col items-center gap-2 py-12 text-center','data-empty-state':''},el('span',{'aria-hidden':'true',class:'flex h-11 w-11 items-center justify-center text-[22px] text-ink-300'},'○'),el('p',{class:'font-medium text-ink-900'},title));
export const bandBadge=b=>b===null||b===undefined?el('span',{class:'badge-locked'},'—'):el('span',{class:`badge bg-paper-sunken font-mono ${b>=7?'text-band-good':b>=5.5?'text-band-warn':'text-band-bad'}`},b.toFixed(1));
/** Source: teacher/students/page.tsx. Roles: teacher, admin, owner (server scopes a teacher to own roster). */
export const studentsMount=mountStaff({name:'management-students',roles:STAFF,load:c=>students(c.signal),
 render(ctx,data){const {dict}=ctx;return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('h1',{class:'font-display text-2xl text-ink-900'},dict.nav.people),data.students.length===0?emptyState(dict.teacher.noStudents):null,
  el('div',{class:'flex flex-col gap-2'},data.students.map(s=>el('a',{href:`/app/teacher/students/${s.id}`},el('div',{class:'card flex items-center justify-between p-5 hover:border-signal-400'},el('div',{},el('p',{class:'text-sm font-medium text-ink-900'},s.name),el('p',{class:'text-xs text-ink-300'},s.email??'Telegram account')),el('span',{class:'text-xs text-ink-300'},s.onboarded?'Onboarded':'New'))))));}});
/** Source: components/support/ResolveReportButton.tsx + teacher/support/page.tsx. */
export const supportMount=mountStaff({name:'management-support',roles:STAFF,load:c=>support(c.signal),
 render(ctx,data,view){const {dict,signal,locale}=ctx,t=dict.support,S=(ctx.state.support??={errors:{},busy:null});
  const card=r=>{const btn=el('button',{type:'button',class:'btn-secondary','data-report-resolve':r.id,disabled:S.busy===r.id},t.resolved);
   listen(btn,'click',async()=>{if(S.busy)return;S.busy=r.id;delete S.errors[r.id];view.rerender();try{await resolveReport(r.id,signal);if(signal.aborted)return;S.busy=null;await view.reload({quiet:true});}catch(e){if(signal.aborted)return;S.busy=null;if(e?.status===409||e?.status===404){await view.reload({quiet:true});}else{S.errors[r.id]=true;view.rerender();}}},signal);
   return el('div',{class:'card p-5','data-report-id':r.id},el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('p',{class:'text-sm font-medium text-ink-900'},`${r.route} · ${r.module}`),el('span',{class:`badge ${r.status==='resolved'?'bg-band-good/10 text-band-good':'bg-signal-100 text-signal-700'}`,'data-report-status':r.status},r.status==='resolved'?t.statusResolved:t.statusOpen)),
    el('p',{class:'mt-2 text-sm text-ink-700'},r.message),el('p',{class:'mt-2 text-xs text-ink-300'},`${r.reporterName} · ${centreDateTime(r.createdAt,locale)}${r.viewport?` · ${t.viewport}: ${r.viewport}`:''}${r.lastErrorCode?` · ${t.lastError}: ${r.lastErrorCode}`:''}`),
    r.status!=='resolved'?el('div',{class:'mt-2'},S.errors[r.id]?el('p',{role:'alert',class:'text-sm text-band-bad'},dict.common.error):null,btn):null);};
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},t.inbox),el('p',{class:'text-sm text-ink-500'},t.subtitle)),data.reports.length===0?emptyState(t.nothingYet):el('div',{class:'flex flex-col gap-3'},data.reports.map(card)));}});
function feedbackForm(ctx,sub,view){
 const {dict,signal}=ctx,S=((ctx.state.feedback??={})[sub.id]??={open:false,comment:'',band:'',sent:false});
 if(S.sent)return el('p',{class:'text-sm text-band-good'},`${dict.teacher.feedbackSent} ✓`);
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary'},dict.teacher.leaveFeedback);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const ta=el('textarea',{id:`comment-${sub.id}`,required:'',class:'input min-h-[100px]',maxlength:'2000','data-focus-key':'fb-'+sub.id});ta.value=S.comment;listen(ta,'input',()=>{S.comment=ta.value;},signal);
 const band=el('input',{type:'number',step:'0.5',min:'0',max:'9',class:'input',placeholder:dict.formCopy.overallBandOptional});band.value=S.band;listen(band,'input',()=>{S.band=band.value;},signal);
 const err=el('p',{role:'alert',hidden:true,class:'text-sm text-band-bad'},dict.common.error),save=el('button',{type:'submit',class:'btn-primary'},dict.common.save),cancel=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);
 listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 const form=el('form',{class:'flex flex-col gap-2'},el('label',{for:`comment-${sub.id}`,class:'mb-1.5 block text-sm font-medium text-ink-700'},dict.teacher.leaveFeedback),ta,band,err,el('div',{class:'flex gap-2'},save,cancel));
 let busy=false;listen(form,'submit',async e=>{e.preventDefault();if(busy||signal.aborted||!form.checkValidity())return;busy=true;err.hidden=true;save.disabled=true;save.textContent=dict.common.saving;
  try{await sendFeedback({submissionId:sub.id,comment:ta.value,overallBand:band.value},signal);if(signal.aborted)return;S.sent=true;view.rerender();await view.reload({quiet:true});}
  catch(x){if(signal.aborted)return;err.hidden=false;}finally{busy=false;if(!signal.aborted&&!S.sent){save.disabled=false;save.textContent=dict.common.save;}}},signal);
 return form;
}
function assignmentForm(ctx,studentId,prompts,view){
 const {dict,signal}=ctx,t=dict.teacher,S=(ctx.state.assignment??={open:false,title:'',description:'',promptId:'',contentKey:'',items:null,contentFailed:false,busy:false,error:null,saved:false});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary'},t.newAssignment);listen(b,'click',()=>{S.open=true;view.rerender();if(S.items===null)void load();},signal);return b;}
 async function load(){try{const items=await assignable(signal);if(signal.aborted)return;S.items=items;}catch{if(signal.aborted)return;S.items=[];S.contentFailed=true;}view.rerender();}
 const key=i=>`${i.module}:${i.contentType}:${i.sourceRef}`,chosen=(S.items??[]).find(i=>key(i)===S.contentKey)??null;
 const title=el('input',{id:'assignment-title',class:'input',disabled:S.busy,maxlength:'200','data-focus-key':'asg-title'});title.value=S.title;listen(title,'input',()=>{S.title=title.value;save.disabled=S.busy||title.value.trim().length<3;},signal);
 const desc=el('textarea',{id:'assignment-description',class:'input min-h-[80px]',disabled:S.busy});desc.value=S.description;listen(desc,'input',()=>{S.description=desc.value;},signal);
 const sel=el('select',{id:'assignment-content',class:'input','data-assignment-content-select':'',disabled:S.busy||S.items===null},el('option',{value:''},t.assignmentNoCanonical),(S.items??[]).map(i=>el('option',{value:key(i)},`${i.title} · ${i.module}/${i.contentType}`)));sel.value=S.contentKey;listen(sel,'change',()=>{S.contentKey=sel.value;view.rerender();},signal);
 const prompt=el('select',{id:'assignment-prompt',class:'input',disabled:S.busy||!!chosen},el('option',{value:''},t.assignmentNoPrompt),prompts.map(p=>el('option',{value:p.id},p.label)));prompt.value=S.promptId;listen(prompt,'change',()=>{S.promptId=prompt.value;},signal);
 const save=el('button',{type:'button',class:'btn-primary',disabled:S.busy||S.title.trim().length<3},S.busy?dict.common.saving:dict.common.save),cancel=el('button',{type:'button',class:'btn-ghost',disabled:S.busy},dict.common.cancel);
 listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 listen(save,'click',async()=>{if(S.busy||signal.aborted)return;S.busy=true;S.error=null;view.rerender();try{await createAssignment({title:S.title,description:S.description,studentId,chosen,promptId:S.promptId},signal);if(signal.aborted)return;Object.assign(S,{busy:false,saved:true,title:'',description:'',promptId:'',contentKey:''});view.rerender();await view.reload({quiet:true});}catch(e){if(signal.aborted)return;S.busy=false;S.error=errorText(e,dict);view.rerender();}},signal);
 const lab=(id,text)=>el('label',{for:id,class:'text-sm text-ink-700'},text);
 return el('div',{class:'card flex flex-col gap-3 p-5','data-assignment-form':''},el('p',{class:'text-sm font-medium text-ink-900'},t.newAssignment),lab('assignment-title',t.assignmentTitle),title,lab('assignment-description',t.assignmentDescription),desc,lab('assignment-content',t.assignmentCanonical),sel,
  el('p',{class:'text-xs text-ink-300','data-assignment-content-hint':''},S.items===null?t.assignmentLoadingContent:S.items.length===0?t.assignmentNoContent:t.assignmentCanonicalHint),S.contentFailed?el('p',{class:'text-xs text-ink-300','data-assignment-content-unavailable':''},dict.common.error):null,
  chosen?el('p',{class:'text-xs text-ink-500','data-assignment-pinned-revision':''},`${chosen.sourceRef} · ${chosen.versionId.slice(0,8)}`):null,lab('assignment-prompt',t.assignmentPrompt),prompt,el('p',{class:'text-xs text-ink-300'},t.assignmentPromptHint),
  S.error?el('p',{class:'text-xs text-band-bad'},S.error):null,S.saved?el('p',{class:'text-xs text-band-good'},t.assignmentCreated):null,el('div',{class:'flex gap-2'},save,cancel));
}
/** Source: teacher/students/[id]/page.tsx + TeacherFeedbackForm + NewAssignmentForm + StudentResults. Roster authority is server-side (404 for others). */
export const studentMount=mountStaff({name:'management-student',roles:STAFF,notFoundBack:null,
 load:ctx=>{const id=ctx.url.pathname.split('/').filter(Boolean).at(-1);return studentDetail(id,ctx.signal);},
 render(ctx,d,view){const {dict}=ctx,a=dict.writingWorkspace.activation;
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-6'},BackLink({fallbackHref:'/app/teacher/students',label:dict.common.back}),
   el('div',{class:'flex flex-wrap items-start justify-between gap-3'},el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},d.student.name),el('p',{class:'text-sm text-ink-500'},d.student.email??'Telegram account')),assignmentForm(ctx,d.student.id,d.prompts,view)),
   renderResults(dict,d.results),
   studentLearningPanel(ctx,d.student.id,`/app/teacher/students/${d.student.id}`),
   el('div',{class:'card flex flex-col gap-2 p-5','data-teacher-activation':''},el('h2',{class:'font-display text-lg text-ink-900'},a.mentorTitle),d.activation.lastSession?el('dl',{class:'grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'},[[a.wordsActivated,d.activation.wordsActivated],[a.averageActivation,d.activation.averageActivation??'—'],[a.dayStreak,d.activation.dayStreak],[a.lastSession,`${d.activation.lastSession.accepted}/${d.activation.lastSession.attempts}`]].map(([l,v])=>el('div',{},el('dt',{class:'text-ink-500'},l),el('dd',{class:'font-semibold text-ink-900'},String(v))))):el('p',{class:'text-sm text-ink-500'},a.mentorEmpty)),
   el('div',{},el('h2',{class:'mb-3 font-display text-lg text-ink-900'},dict.teacher.submissionsTitle),el('div',{class:'flex flex-col gap-3'},d.submissions.map(s=>el('div',{class:'card flex flex-col gap-2 p-5','data-submission':s.id},
    el('div',{class:'flex items-center justify-between'},el('p',{class:'text-sm font-medium text-ink-900'},s.category),el('span',{class:'text-xs text-ink-300'},dict.writing.status[s.status]??s.status)),el('p',{class:'line-clamp-2 text-sm text-ink-500'},s.content||'—'),
    s.evaluation?el('div',{class:'flex flex-col gap-1 rounded-sm bg-paper-sunken px-3 py-2'},el('div',{class:'flex items-center gap-2'},bandBadge(s.evaluation.overallEstimate),el('span',{class:'badge bg-signal-100 text-signal-700','data-checked-by':s.evaluation.checkedByName},`${dict.coach.checkedBy} ${s.evaluation.checkedByName}`),el('span',{class:'text-xs text-ink-300','data-staff-provenance':''},s.evaluation.provenanceLabel),el('span',{class:'text-xs text-ink-300'},`${dict.coach.confidence} ${(s.evaluation.confidence*100).toFixed(0)}%`)),s.evaluation.weaknesses.slice(0,2).map(w=>el('p',{class:'text-xs text-ink-500'},w))):el('p',{class:'text-xs text-ink-300'},dict.coach.noEvaluation),
    s.feedback.map(f=>el('div',{class:'flex items-center gap-2 rounded-sm bg-paper-sunken px-3 py-2 text-sm'},el('span',{class:'text-xs uppercase text-ink-300'},f.source),bandBadge(f.overallBand),f.comment?el('span',{class:'text-ink-700'},f.comment):null)),
    s.status!=='draft'?feedbackForm(ctx,s,view):null)))));}});
