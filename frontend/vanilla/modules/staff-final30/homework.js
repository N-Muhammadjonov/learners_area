import {el,listen,mountStaff,heading,BackLink,centreDateTime,pager} from './kit.js';
import {teacherHomework,teacherAssignment,teacherAssessment} from '../../js/adapters/staff-final30/teacher.js';
import {ACADEMIC_EN,ACADEMIC_UZ} from './monitoring-strings.js';

const text=ctx=>ctx.locale==='uz'?ACADEMIC_UZ:ACADEMIC_EN;
const modules=['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks','ted','lesson','other'];
const statuses=['not_started','in_progress','completed','overdue'];
const statusLabel=(t,s)=>({not_started:t.notStarted,in_progress:t.inProgress,completed:t.completed,overdue:t.overdue})[s]??s;
const asDate=(v,locale)=>v?centreDateTime(v,locale):'—';
function hrefFor(filters,studentPage=1,assignmentPage=1){
 const p=new URLSearchParams();for(const k of ['student','assignment','module','status','dueFrom','dueTo'])if(filters[k])p.set(k,filters[k]);
 if(studentPage>1)p.set('page',String(studentPage));if(assignmentPage>1)p.set('assignmentPage',String(assignmentPage));
 const query=p.toString();return '/app/teacher/homework'+(query?'?'+query:'');
}

export const homeworkMount=mountStaff({name:'teacher-homework',roles:['teacher','owner'],
 load:ctx=>teacherHomework({student:ctx.url.searchParams.get('student')??'',assignment:ctx.url.searchParams.get('assignment')??'',module:ctx.url.searchParams.get('module')??'',status:ctx.url.searchParams.get('status')??'',dueFrom:ctx.url.searchParams.get('dueFrom')??'',dueTo:ctx.url.searchParams.get('dueTo')??'',page:ctx.url.searchParams.get('page')??1,assignmentPage:ctx.url.searchParams.get('assignmentPage')??1},ctx.signal),
 render(ctx,data){
  const t=text(ctx),{dict,signal,navigate}=ctx;
  const student=el('input',{type:'search',name:'student',maxlength:'100',class:'input w-full','data-homework-filter':'student'});student.value=data.filters.student;
  const assignment=el('input',{type:'search',name:'assignment',maxlength:'100',class:'input w-full','data-homework-filter':'assignment'});assignment.value=data.filters.assignment;
  const module=el('select',{name:'module',class:'input w-full','data-homework-filter':'module'},el('option',{value:''},t.allModules),modules.map(m=>el('option',{value:m},m==='other'?t.module+': '+(ctx.locale==='uz'?'boshqa':'other'):(dict.nav[m]??m))));module.value=data.filters.module??'';
  const status=el('select',{name:'status',class:'input w-full','data-homework-filter':'status'},el('option',{value:''},t.allStatuses),statuses.map(s=>el('option',{value:s},statusLabel(t,s))));status.value=data.filters.status??'';
  const dueFrom=el('input',{type:'date',name:'dueFrom',class:'input w-full','data-homework-filter':'dueFrom'});dueFrom.value=data.filters.dueFrom??'';
  const dueTo=el('input',{type:'date',name:'dueTo',class:'input w-full','data-homework-filter':'dueTo'});dueTo.value=data.filters.dueTo??'';
  const label=(name,node,title)=>el('label',{class:'flex min-w-[10rem] flex-1 flex-col gap-1 text-sm'},el('span',{class:'font-medium text-ink-700'},title),node);
  const apply=el('button',{type:'submit',class:'btn-primary'},t.apply),form=el('form',{class:'card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3','data-homework-filters':''},
   label('student',student,t.filterStudent),label('assignment',assignment,t.filterAssignment),label('module',module,t.module),label('status',status,t.status),label('dueFrom',dueFrom,t.dueFrom),label('dueTo',dueTo,t.dueTo),
   el('div',{class:'flex items-end gap-2 sm:col-span-2 lg:col-span-3'},apply,el('a',{href:'/app/teacher/homework',class:'btn-secondary'},t.clear)));
  listen(form,'submit',e=>{e.preventDefault();const p=new URLSearchParams();for(const [k,v] of Object.entries({student:student.value.trim(),assignment:assignment.value.trim(),module:module.value,status:status.value,dueFrom:dueFrom.value,dueTo:dueTo.value}))if(v)p.set(k,v);const query=p.toString();void navigate('/app/teacher/homework'+(query?'?'+query:''));},signal);
  const s=data.summary;
  const summary=el('dl',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-5','data-homework-summary':''},[
   [t.assigned,s.assigned], [t.completed,s.completed], [t.inProgress,s.inProgress], [t.overdue,s.overdue], [t.completion,data.completionPercent==null?t.noAssignments:`${data.completionPercent.toFixed(1)}%`]
  ].map(([k,v])=>el('div',{class:'card p-4'},el('dt',{class:'text-xs uppercase tracking-wide text-ink-500'},k),el('dd',{class:'mt-2 font-display text-2xl text-ink-900'},String(v)))));
  const matrix=el('table',{class:'w-full min-w-[760px] text-left text-sm','data-homework-matrix':''},
   el('thead',{},el('tr',{class:'border-b border-ink-100 text-xs uppercase text-ink-500'},[t.student,t.assigned,t.completed,t.inProgress,t.notStarted,t.overdue,t.completion].map(x=>el('th',{scope:'col',class:'py-2 pr-3'},x)))),
   el('tbody',{},data.students.map(r=>el('tr',{class:'border-b border-ink-100 last:border-0'},
    el('th',{scope:'row',class:'py-3 pr-3 text-left font-medium'},el('a',{href:`/app/teacher/students/${r.id}`,class:'text-ink-900 underline'},r.name)),
    el('td',{class:'py-3 pr-3'},r.assigned),el('td',{class:'py-3 pr-3 text-band-good'},r.completed),el('td',{class:'py-3 pr-3'},r.inProgress),el('td',{class:'py-3 pr-3'},r.notStarted),el('td',{class:'py-3 pr-3 text-band-bad'},r.overdue),el('td',{class:'py-3 pr-3'},r.assigned===0?t.noAssignments:`${r.completionPercent.toFixed(1)}%`)))));
  const matrixSection=el('section',{class:'card space-y-3 p-4'},el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('h2',{class:'font-display text-xl text-ink-900'},t.matrix),el('span',{class:'text-xs text-ink-500'},`${data.studentPage} / ${data.studentPages} · ${data.totalStudents}`)),
   data.students.length?el('div',{class:'overflow-x-auto'},matrix):el('p',{class:'py-5 text-sm text-ink-500'},t.noMatchingStudents),
   pager({label:t.matrix,page:data.studentPage,totalPages:data.studentPages,href:n=>hrefFor(data.filters,n,data.assignmentPage),pageOf:t.pageOf,previous:t.previous,next:t.next,attr:'data-homework-students-pagination'}));
  const tasks=el('table',{class:'w-full min-w-[700px] text-left text-sm','data-homework-assignments':''},
   el('thead',{},el('tr',{class:'border-b border-ink-100 text-xs uppercase text-ink-500'},[t.dueDate,t.assignment,t.student,t.module,t.status].map(x=>el('th',{scope:'col',class:'py-2 pr-3'},x)))),
   el('tbody',{},data.assignments.map(r=>el('tr',{class:'border-b border-ink-100 last:border-0'},
    el('td',{class:'py-3 pr-3 whitespace-nowrap'},asDate(r.dueAt,ctx.locale)),
    el('td',{class:'py-3 pr-3'},el('a',{href:`/app/teacher/students/${r.studentId}/assignments/${r.id}`,class:'font-medium text-ink-900 underline'},r.title)),
    el('td',{class:'py-3 pr-3'},el('a',{href:`/app/teacher/students/${r.studentId}`,class:'underline'},r.studentName)),
    el('td',{class:'py-3 pr-3'},r.module?(dict.nav[r.module]??r.module):'—'),el('td',{class:'py-3 pr-3'},statusLabel(t,r.state))))));
  const assignmentSection=el('section',{class:'card space-y-3 p-4'},el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('h2',{class:'font-display text-xl text-ink-900'},`${t.assignmentList} · ${data.totalAssignments}`),el('span',{class:'text-xs text-ink-500'},`${data.assignmentPage} / ${data.assignmentPages}`)),
   data.assignments.length?el('div',{class:'overflow-x-auto'},tasks):el('p',{class:'py-5 text-sm text-ink-500'},t.noMatchingAssignments),
   pager({label:t.assignmentList,page:data.assignmentPage,totalPages:data.assignmentPages,href:n=>hrefFor(data.filters,data.studentPage,n),pageOf:t.pageOf,previous:t.previous,next:t.next,attr:'data-homework-assignments-pagination'}));
  return el('div',{class:'mx-auto flex max-w-7xl flex-col gap-4','data-teacher-homework':''},heading(t.homework,t.homeworkBody),
   el('p',{class:'text-xs text-ink-500'},ctx.session.user.role==='owner'?t.ownerScope:t.teacherScope),form,summary,matrixSection,assignmentSection);
 }});

export const assignmentMount=mountStaff({name:'teacher-assignment-review',roles:['teacher','owner'],notFoundBack:{href:'/app/teacher/homework',label:ACADEMIC_EN.backToHomework},
 load:ctx=>{const p=ctx.url.pathname.split('/').filter(Boolean);return teacherAssignment(p[3],p[5],ctx.signal);},
 render(ctx,d){
  const t=text(ctx),a=d.assignment,dict=ctx.dict;
  const evaluation=a.evaluation;
  return el('div',{class:'mx-auto flex max-w-4xl flex-col gap-4','data-teacher-assignment-review':''},BackLink({fallbackHref:'/app/teacher/homework',label:t.backToHomework}),
   el('div',{class:'card space-y-2 p-5'},el('p',{class:'text-xs text-ink-500'},d.student.name),el('h1',{class:'font-display text-2xl text-ink-900'},a.title),
    el('p',{class:'text-sm text-ink-500'},`${a.module?(dict.nav[a.module]??a.module):'—'}${a.contentType?` · ${a.contentType}`:''} · ${statusLabel(t,a.status)}`),
    el('p',{class:'text-xs text-ink-500'},`${t.due}: ${asDate(a.dueAt,ctx.locale)} · ${t.created}: ${asDate(a.createdAt,ctx.locale)}`),
    a.description?el('div',{class:'pt-2'},el('h2',{class:'font-semibold'},t.description),el('p',{class:'whitespace-pre-wrap text-sm'},a.description)):null,
    a.instructions?el('div',{},el('h2',{class:'font-semibold'},t.detail),el('p',{class:'whitespace-pre-wrap text-sm'},a.instructions)):null),
   el('section',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-xl text-ink-900'},t.response),a.response?el('p',{class:'whitespace-pre-wrap text-sm'},a.response.content):el('p',{class:'text-sm text-ink-500'},t.notSubmitted)),
   evaluation?el('section',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-xl text-ink-900'},t.evaluation),el('p',{class:'text-sm'},`${evaluation.verdict??'—'}${evaluation.overallEstimate==null?'':` · ${evaluation.overallEstimate.toFixed(1)}`}`),evaluation.strengths.length?el('ul',{class:'list-disc pl-5 text-sm'},evaluation.strengths.map(x=>el('li',{},x))):null,evaluation.weaknesses.length?el('ul',{class:'list-disc pl-5 text-sm'},evaluation.weaknesses.map(x=>el('li',{},x))):null):null);
 }});

export const assessmentMount=mountStaff({name:'teacher-assessment-review',roles:['teacher','owner'],notFoundBack:{href:'/app/teacher/students',label:ACADEMIC_EN.title},
 load:ctx=>{const p=ctx.url.pathname.split('/').filter(Boolean);return teacherAssessment(p[3],p[4],p[5],ctx.signal);},
 render(ctx,d){
  const t=text(ctx),a=d.attempt;
  const score=a.score!=null&&a.totalQuestions?`${a.score} / ${a.totalQuestions} · ${(100*a.score/a.totalQuestions).toFixed(1)}%`:d.module==='speaking'&&d.speaking?.evaluation?.overallEstimate!=null?`${d.speaking.evaluation.overallEstimate.toFixed(1)} band`:d.module==='mocks'&&a.estimatedBand!=null?`${a.estimatedBand.toFixed(1)} band${a.rawScore==null?'':` · ${a.rawScore} ${t.rawScore}`}`:'—';
  const speaking=d.speaking;
  const sectionRows=d.sectionResults;
  const mockRows=sectionRows.map(r=>el('tr',{class:'border-b border-ink-100 last:border-0'},
   el('th',{scope:'row',class:'py-2 pr-3'},dictModule(ctx,r.skill)),
   el('td',{class:'py-2 pr-3'},r.raw==null||r.total==null?'—':`${r.raw} / ${r.total}`),
   el('td',{class:'py-2'},r.band==null?'—':r.band.toFixed(1))));
  const mockTable=el('table',{class:'w-full text-left text-sm'},
   el('thead',{},el('tr',{class:'border-b border-ink-100 text-xs text-ink-500'},
    [t.module,t.result,t.band].map(x=>el('th',{scope:'col',class:'py-2 pr-3'},x)))),
   el('tbody',{},mockRows));
  const mockSections=sectionRows.length
   ?el('section',{class:'card space-y-3 p-5','data-mock-sections':''},
    el('h2',{class:'font-display text-xl text-ink-900'},t.sections),
    el('div',{class:'overflow-x-auto'},mockTable))
   :null;
  const speakingDetail=speaking?el('section',{class:'card space-y-3 p-5','data-speaking-review':''},
   speaking.prompt?el('div',{},el('h2',{class:'font-semibold'},t.prompt),el('p',{class:'whitespace-pre-wrap text-sm'},speaking.prompt)):null,
   speaking.cueCard?el('div',{},el('h3',{class:'font-semibold'},t.cueCard),el('p',{class:'whitespace-pre-wrap text-sm'},speaking.cueCard)):null,
   speaking.recordingUrl?el('div',{},el('h3',{class:'font-semibold'},t.recording),el('audio',{controls:true,preload:'none',src:speaking.recordingUrl,'data-speaking-recording':''})):el('p',{class:'text-sm text-ink-500'},t.noRecording),
   speaking.transcript?el('div',{},el('h3',{class:'font-semibold'},t.transcript),el('p',{class:'whitespace-pre-wrap text-sm'},speaking.transcript)):el('p',{class:'text-sm text-ink-500'},t.noTranscript),
   speaking.evaluation?el('div',{class:'space-y-2','data-speaking-evaluation':''},el('h3',{class:'font-semibold'},t.recordedEvaluation),el('p',{class:'text-sm'},`${speaking.evaluation.overallEstimate==null?'—':speaking.evaluation.overallEstimate.toFixed(1)} · ${speaking.evaluation.verdict??'—'}`),speaking.evaluation.strengths.length?el('ul',{class:'list-disc pl-5 text-sm'},speaking.evaluation.strengths.map(x=>el('li',{},x))):null,speaking.evaluation.weaknesses.length?el('ul',{class:'list-disc pl-5 text-sm'},speaking.evaluation.weaknesses.map(x=>el('li',{},x))):null):null):null;
  return el('div',{class:'mx-auto flex max-w-4xl flex-col gap-4','data-assessment-review':''},BackLink({fallbackHref:`/app/teacher/students/${d.student.id}`,label:d.student.name}),
   el('div',{class:'card space-y-2 p-5'},el('p',{class:'text-xs text-ink-500'},d.student.name),el('h1',{class:'font-display text-2xl text-ink-900'},d.title??t.assessment),el('p',{class:'text-sm text-ink-500'},`${dictModule(ctx,d.module)} · ${t.attempt}: ${statusLabel(t,a.status)}`),el('p',{class:'text-xs text-ink-500'},`${t.score}: ${score} · ${asDate(a.submittedAt??a.startedAt,ctx.locale)}`)),
   ['reading','listening'].includes(d.module)&&!d.answerKeyAvailable?el('p',{class:'card p-4 text-sm text-ink-500'},t.reviewLocked):null,
   speakingDetail,mockSections,
   d.questions.map(q=>el('article',{class:'card space-y-2 p-4','data-assessment-question':q.number},el('h2',{class:'font-semibold'},`${t.question} ${q.number} · ${q.type}`),el('p',{class:'whitespace-pre-wrap text-sm'},q.prompt),
    el('p',{class:'text-sm'},`${t.yourAnswer}: ${q.studentAnswer??t.noAnswer}${q.isCorrect===true?' · ✓':q.isCorrect===false?' · ✗':''}`),
    q.correctAnswer!==null?el('p',{class:'text-sm'},`${t.correctAnswer}: ${q.correctAnswer}`):null,q.explanation?el('p',{class:'text-xs text-ink-500'},`${t.explanation}: ${q.explanation}`):null)));
 }});
function dictModule(ctx,module){return ctx.dict.nav[module]??module;}
/** Source POST /api/teacher/feedback {submissionId,comment(1..2000),overallBand?:0..9 step input}. */