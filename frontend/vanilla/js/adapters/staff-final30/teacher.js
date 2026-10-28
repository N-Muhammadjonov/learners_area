import {bad,isObj,str,int,bool,oneOf,arr,date,staffData,call,ok,rawJson,UUID} from './core.js';
import {validateStudentResults} from './people.js';
/** Teacher/Owner monitoring DTOs. The server is authoritative for roster scope and task state. */
const count=v=>int(v,{min:0,max:1000000000});
const percent=v=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)throw bad();return v;};
const nullableDate=v=>v==null?null:date(v);
function homeworkCounts(h){if(!isObj(h))throw bad();const o={assigned:count(h.assigned),completed:count(h.completed),inProgress:count(h.inProgress),notStarted:count(h.notStarted),overdue:count(h.overdue),completionPercent:h.completionPercent==null?null:percent(h.completionPercent)};if(o.completed+o.inProgress+o.notStarted+o.overdue!==o.assigned||o.assigned===0&&o.completionPercent!==null||o.assigned>0&&o.completionPercent===null)throw bad();return o;}
function actionItem(x,recent=false){if(!isObj(x)||!UUID.test(x.id)||!UUID.test(x.studentId))throw bad();return {id:x.id,studentId:x.studentId,studentName:str(x.studentName,{max:300}),category:str(x.category??'',{max:80}),title:str(x.title??'',{max:300}),status:oneOf(x.status,['submitted','evaluated']),submittedAt:date(x.submittedAt)};}
function overdueItem(x){if(!isObj(x)||!UUID.test(x.id)||!UUID.test(x.studentId))throw bad();return {id:x.id,title:str(x.title,{max:200}),studentId:x.studentId,studentName:str(x.studentName,{max:300}),module:str(x.module??null,{nullable:true,max:40}),dueAt:nullableDate(x.dueAt),status:oneOf(x.status,['not_started','in_progress','completed','overdue']),completedAt:nullableDate(x.completedAt)};}
function validateActionQueue(q){if(!isObj(q))throw bad();return {pendingReviews:count(q.pendingReviews),overdueAssignments:count(q.overdueAssignments),recentWritingSubmissions:count(q.recentWritingSubmissions),reviewItems:arr(q.reviewItems,8).map(x=>actionItem(x)),overdueItems:arr(q.overdueItems,8).map(overdueItem),recentItems:arr(q.recentItems,8).map(x=>actionItem(x,true))};}
export function validateStudents(d){
 const students=arr(d.students,25).map(s=>{if(!isObj(s)||!UUID.test(s.id)||!isObj(s.homework))throw bad();return {id:s.id,name:str(s.name,{max:300}),email:str(s.email,{nullable:true,max:320}),onboarded:s.onboardingCompletedAt!=null&&date(s.onboardingCompletedAt)instanceof Date,online:bool(s.online),lastSeenAt:nullableDate(s.lastSeenAt),currentVisitSeconds:s.currentVisitSeconds==null?null:int(s.currentVisitSeconds),totalWebsiteSeconds:s.totalWebsiteSeconds==null?null:int(s.totalWebsiteSeconds),homework:homeworkCounts(s.homework)};});
 const page=int(d.page,{min:1,max:100000}),pageSize=int(d.pageSize,{min:1,max:100}),total=count(d.total),totalPages=int(d.totalPages,{min:1,max:100000});if(page>totalPages||students.length>pageSize||totalPages!==Math.max(1,Math.ceil(total/pageSize)))throw bad();
 return {students,page,pageSize,total,totalPages,actionQueue:validateActionQueue(d.actionQueue),scope:oneOf(d.scope,['owner','assigned'])};
}
export const students=(signal,page=1)=>staffData('teacher-students',{page},signal).then(validateStudents);
const band=v=>v==null?null:(typeof v==='number'&&v>=0&&v<=9?v:(()=>{throw bad();})());
const ratio=v=>v==null?null:(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:(()=>{throw bad();})());
const nullableNumber=(v,min,max)=>v==null?null:(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:(()=>{throw bad();})());
function validateWeaknesses(w){
 if(!isObj(w)||!isObj(w.questionTypes)||!isObj(w.vocabulary))throw bad();
 const types=key=>arr(w.questionTypes[key],20).map(x=>{if(!isObj(x))throw bad();const attempts=count(x.attempts),correct=count(x.correct),accuracy=ratio(x.accuracy);if(correct>attempts||attempts<5&&accuracy!==null||attempts>=5&&accuracy===null)throw bad();return {type:str(x.type,{max:60}),attempts,correct,accuracy};});
 const grammar=arr(w.grammar,30).map(x=>{if(!isObj(x))throw bad();const attempts=count(x.attempts),correct=count(x.correct);if(correct>attempts)throw bad();return {topic:str(x.topic,{max:200}),activity:str(x.activity,{max:60}),attempts,correct,accuracy:attempts>=5?percent(100*correct/attempts):null};});
 const v=w.vocabulary;const repeated=arr(v.repeated,10).map(x=>{if(!isObj(x))throw bad();return {term:str(x.term,{max:300}),incorrectCount:count(x.incorrectCount),correctCount:count(x.correctCount),mastery:str(x.mastery,{max:20}),nextReviewAt:nullableDate(x.nextReviewAt),lastReviewedAt:nullableDate(x.lastReviewedAt)};});
 return {questionTypes:{reading:types('reading'),listening:types('listening')},grammar,vocabulary:{dueCount:count(v.dueCount),masteredCount:count(v.masteredCount),trackedCount:count(v.trackedCount),repeated}};
}
export function validateStudentDetail(d){
 const s=d.student;if(!isObj(s)||!UUID.test(s.id))throw bad();
 const submissionsPage=int(d.submissionsPage,{min:1,max:100000}),submissionsPages=int(d.submissionsPages,{min:1,max:100000}),submissionsTotal=count(d.submissionsTotal);
 if(submissionsPage>submissionsPages||submissionsPages!==Math.max(1,Math.ceil(submissionsTotal/25))||!Array.isArray(d.submissions)||d.submissions.length>25)throw bad();
 const act=d.activation;
 const ev=e=>e==null?null:(()=>{if(!isObj(e))throw bad();return {overallEstimate:band(e.overallEstimate),checkedByName:str(e.checkedByName,{max:200}),provenanceLabel:str(e.provenanceLabel??'',{max:200}),confidence:(typeof e.confidence==='number'&&e.confidence>=0&&e.confidence<=1)?e.confidence:(()=>{throw bad();})(),weaknesses:arr(e.weaknesses??[],50).map(w=>str(w,{max:1000}))};})();
 return {student:{id:s.id,name:str(s.name,{max:300}),email:str(s.email,{nullable:true,max:320})},weaknesses:validateWeaknesses(d.weaknesses),results:validateStudentResults({student:s,unavailable:d.results?.unavailable,testIds:d.results?.testIds,attempts:d.results?.attempts,attemptsTruncated:d.results?.attemptsTruncated,practice:d.results?.practice}),
  activation:{wordsActivated:int(act?.wordsActivated??0),averageActivation:act?.averageActivation==null?null:(typeof act.averageActivation==='number'?act.averageActivation:(()=>{throw bad();})()),dayStreak:int(act?.dayStreak??0),lastSession:act?.lastSession==null?null:{accepted:int(act.lastSession.accepted),attempts:int(act.lastSession.attempts)}},
  prompts:arr(d.prompts??[],1000).map(p=>{if(!isObj(p)||!UUID.test(p.id))throw bad();return {id:p.id,label:str(p.label,{max:300})};}),
  submissionsPage,submissionsPages,submissionsTotal,submissions:arr(d.submissions,25).map(x=>{if(!isObj(x)||!UUID.test(x.id))throw bad();return {id:x.id,status:oneOf(x.status,['draft','submitted','evaluated']),category:str(x.category??'',{max:200}),content:str(x.content??'',{max:200000}),evaluation:ev(x.evaluation),feedback:arr(x.feedback??[],200).map(f=>{if(!isObj(f))throw bad();return {id:str(f.id,{max:100}),source:str(f.source,{max:40}),overallBand:band(f.overallBand),comment:str(f.comment??'',{max:5000})};})};})};
}
export const studentDetail=(id,signal,submission)=>UUID.test(id)&&(!submission||UUID.test(submission))?staffData('teacher-student',{id,...(submission?{submission}: {})},signal).then(validateStudentDetail):Promise.reject(Object.assign(new Error('not_found'),{status:404}));

const matrixRow=x=>{if(!isObj(x)||!UUID.test(x.id))throw bad();return {id:x.id,name:str(x.name,{max:300}),...homeworkCounts(x)};};
export function validateHomework(d){
 if(!isObj(d)||!isObj(d.summary)||!isObj(d.filters))throw bad();
 const summary=homeworkCounts({...d.summary,completionPercent:d.completionPercent});
 if(d.summary.assigned===0&&d.completionPercent!==null||d.summary.assigned>0&&d.completionPercent===null)throw bad();
 const page=(v,k)=>int(v,{min:1,max:100000});
 const studentPage=page(d.studentPage),studentPages=page(d.studentPages),assignmentPage=page(d.assignmentPage),assignmentPages=page(d.assignmentPages),totalStudents=count(d.totalStudents),totalAssignments=count(d.totalAssignments);
 if(studentPage>studentPages||assignmentPage>assignmentPages||studentPages!==Math.max(1,Math.ceil(totalStudents/25))||assignmentPages!==Math.max(1,Math.ceil(totalAssignments/25)))throw bad();
 const filters={student:str(d.filters.student??'',{max:100}),assignment:str(d.filters.assignment??'',{max:100}),module:d.filters.module==null?null:oneOf(d.filters.module,['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks','ted','lesson','other']),status:d.filters.status==null?null:oneOf(d.filters.status,['not_started','in_progress','completed','overdue']),dueFrom:str(d.filters.dueFrom??null,{nullable:true,max:10}),dueTo:str(d.filters.dueTo??null,{nullable:true,max:10})};
 const students=arr(d.students,25).map(matrixRow);
 const assignments=arr(d.assignments,25).map(x=>{if(!isObj(x)||!UUID.test(x.id)||!UUID.test(x.studentId))throw bad();return {id:x.id,title:str(x.title,{max:200}),studentId:x.studentId,studentName:str(x.studentName,{max:300}),module:str(x.module??null,{nullable:true,max:40}),contentType:str(x.contentType??null,{nullable:true,max:40}),sourceRef:str(x.sourceRef??null,{nullable:true,max:100}),status:oneOf(x.status,['not_started','in_progress','completed','overdue']),state:oneOf(x.state,['not_started','in_progress','completed','overdue']),dueAt:nullableDate(x.dueAt),completedAt:nullableDate(x.completedAt),createdAt:date(x.createdAt)};});
 return {filters,summary,completionPercent:d.completionPercent==null?null:percent(d.completionPercent),students,studentPage,studentPages,totalStudents,assignments,assignmentPage,assignmentPages,totalAssignments};
}
export const teacherHomework=(filters,signal)=>staffData('teacher-homework',filters,signal).then(validateHomework);
function evaluationDTO(e){if(e==null)return null;if(!isObj(e))throw bad();return {verdict:str(e.verdict??null,{nullable:true,max:80}),overallEstimate:band(e.overallEstimate),strengths:arr(e.strengths??[],20).map(x=>str(x,{max:1000})),weaknesses:arr(e.weaknesses??[],20).map(x=>str(x,{max:1000})),createdAt:nullableDate(e.createdAt)};}
export function validateAssignmentDetail(d){
 if(!isObj(d)||!isObj(d.student)||!UUID.test(d.student.id)||!isObj(d.assignment)||!UUID.test(d.assignment.id))throw bad();const a=d.assignment,r=a.response;
 return {student:{id:d.student.id,name:str(d.student.name,{max:300}),email:str(d.student.email??null,{nullable:true,max:320})},assignment:{id:a.id,title:str(a.title,{max:200}),description:str(a.description??null,{nullable:true,max:10000}),instructions:str(a.instructions??null,{nullable:true,max:20000}),module:str(a.module??null,{nullable:true,max:40}),contentType:str(a.contentType??null,{nullable:true,max:40}),sourceRef:str(a.sourceRef??null,{nullable:true,max:100}),contentVersionId:str(a.contentVersionId??null,{nullable:true,max:100}),createdAt:date(a.createdAt),dueAt:nullableDate(a.dueAt),completedAt:nullableDate(a.completedAt),status:oneOf(a.status,['not_started','in_progress','completed','overdue']),response:r==null?null:(()=>{if(!isObj(r))throw bad();return {content:str(r.content,{max:20000}),createdAt:date(r.createdAt),updatedAt:date(r.updatedAt)};})(),evaluation:evaluationDTO(a.evaluation)}};
}
export const teacherAssignment=(studentId,id,signal)=>UUID.test(studentId)&&UUID.test(id)?staffData('teacher-assignment',{student:studentId,id},signal).then(validateAssignmentDetail):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
export function validateAssessment(d){
 if(!isObj(d)||!isObj(d.student)||!UUID.test(d.student.id)||!isObj(d.attempt)||!UUID.test(d.attempt.id))throw bad();
 const module=oneOf(d.module,['reading','listening','speaking','mocks']);
 const questions=arr(d.questions??[],100).map(q=>{if(!isObj(q)||!UUID.test(q.id))throw bad();return {id:q.id,number:int(q.number,{min:1,max:1000}),type:str(q.type,{max:60}),prompt:str(q.prompt,{max:10000}),studentAnswer:str(q.studentAnswer??null,{nullable:true,max:2000}),correctAnswer:str(q.correctAnswer??null,{nullable:true,max:2000}),isCorrect:q.isCorrect==null?null:bool(q.isCorrect),explanation:str(q.explanation??null,{nullable:true,max:5000})};});
 const commonAttempt={id:d.attempt.id,startedAt:nullableDate(d.attempt.startedAt),submittedAt:nullableDate(d.attempt.submittedAt),
  score:d.attempt.score==null?null:int(d.attempt.score),totalQuestions:d.attempt.totalQuestions==null?null:int(d.attempt.totalQuestions),
  rawScore:nullableNumber(d.attempt.rawScore,0,100000),estimatedBand:band(d.attempt.estimatedBand)};
 if(module==='reading'||module==='listening'){
  const available=bool(d.answerKeyAvailable),status=oneOf(d.attempt.status,['in_progress','completed']);
  if(available&&status!=='completed'||!available&&questions.length)throw bad();
  return {student:{id:d.student.id,name:str(d.student.name,{max:300})},module,title:str(d.title??null,{nullable:true,max:300}),
   attempt:{...commonAttempt,status},questions,answerKeyAvailable:available,speaking:null,sectionResults:[]};
 }
 if(questions.length||d.answerKeyAvailable!==false)throw bad();
 if(module==='speaking'){
  const s=d.speaking,a=d.attempt;if(!isObj(s))throw bad();
  const status=oneOf(a.status,['recording','submitted','reviewed']);
  const evaluation=s.evaluation==null?null:(()=>{const e=s.evaluation;if(!isObj(e))throw bad();return {overallEstimate:band(e.overallEstimate),confidence:nullableNumber(e.confidence,0,1),verdict:str(e.verdict??null,{nullable:true,max:80}),strengths:arr(e.strengths??[],20).map(x=>str(x,{max:1000})),weaknesses:arr(e.weaknesses??[],20).map(x=>str(x,{max:1000})),createdAt:nullableDate(e.createdAt)};})();
  const recordingUrl=s.recordingUrl==null?null:str(s.recordingUrl,{max:500});
  if(recordingUrl!==null&&(!recordingUrl.startsWith('/api/resources/')||recordingUrl.includes('..')||recordingUrl.includes('?')||recordingUrl.includes('#')))throw bad();
  return {student:{id:d.student.id,name:str(d.student.name,{max:300})},module,title:str(d.title??null,{nullable:true,max:300}),
   attempt:{...commonAttempt,status},questions,answerKeyAvailable:false,sectionResults:[],
   speaking:{part:str(s.part,{max:20}),topic:str(s.topic??null,{nullable:true,max:300}),prompt:str(s.prompt??null,{nullable:true,max:10000}),
    cueCard:str(s.cueCard??null,{nullable:true,max:10000}),transcript:str(s.transcript??null,{nullable:true,max:20000}),
    transcriptOrigin:str(s.transcriptOrigin??null,{nullable:true,max:30}),recordingUrl,evaluation}};
 }
 const status=oneOf(d.attempt.status,['in_progress','submitted','abandoned']);
 const sectionResults=arr(d.sectionResults??[],100).map(r=>{if(!isObj(r))throw bad();return {skill:str(r.skill,{max:40}),sourceRef:str(r.sourceRef,{max:100}),raw:nullableNumber(r.raw,0,100000),total:nullableNumber(r.total,0,100000),band:band(r.band),contentVersionId:str(r.contentVersionId??null,{nullable:true,max:100}),attemptId:str(r.attemptId??null,{nullable:true,max:100})};});
 return {student:{id:d.student.id,name:str(d.student.name,{max:300})},module,title:str(d.title??null,{nullable:true,max:300}),
  attempt:{...commonAttempt,status},questions,answerKeyAvailable:false,speaking:null,sectionResults};
}
export const teacherAssessment=(studentId,module,id,signal)=>UUID.test(studentId)&&UUID.test(id)&&['reading','listening','speaking','mocks'].includes(module)?staffData('teacher-assessment',{student:studentId,module,id},signal).then(validateAssessment):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
/** Source POST /api/teacher/feedback {submissionId,comment(1..2000),overallBand?:0..9 step input}. */
export async function sendFeedback({submissionId,comment,overallBand},signal){
 if(!UUID.test(submissionId))throw new TypeError('invalid');const c=String(comment??'');if(c.length<1||c.length>2000)throw new TypeError('comment length');
 const body={submissionId,comment:c};if(overallBand!==''&&overallBand!==undefined&&overallBand!==null){const n=Number(overallBand);if(!Number.isFinite(n)||n<0||n>9)throw new TypeError('band');body.overallBand=n;}
 return ok(await call('POST','/api/teacher/feedback',body,signal));
}
/** Existing GET /api/assignments/assignable => {items:[{module,contentType,sourceRef,title,versionId}]}. */
export async function assignable(signal){const r=await rawJson('GET','/api/assignments/assignable',undefined,signal);if(!r.ok||!isObj(r.data))throw Object.assign(new Error('unavailable'),{status:r.status});
 return arr(r.data.items??[],2000).map(i=>{if(!isObj(i))throw bad();return {module:str(i.module,{max:60}),contentType:str(i.contentType,{max:60}),sourceRef:str(i.sourceRef,{max:200}),title:str(i.title,{max:300}),versionId:str(i.versionId,{max:100})};});}
/** Source POST /api/assignments. Canonical content wins; the legacy prompt link is then NOT sent. */
export async function createAssignment({title,description,studentId,chosen,promptId},signal){
 const t=String(title??'').trim();if(t.length<3)throw new TypeError('title');if(!UUID.test(studentId))throw new TypeError('student');
 const d=String(description??'').trim();
 const body={title:t,description:d||null,targetUserId:studentId,...(chosen?{module:chosen.module,contentType:chosen.contentType,sourceRef:chosen.sourceRef,contentVersionId:chosen.versionId}:{relatedWritingPromptId:promptId||null})};
 const r=await rawJson('POST','/api/assignments',body,signal);
 if(!r.ok)throw Object.assign(new Error('assignment'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:(typeof r.data?.error?.code==='string'?r.data.error.code:'request_failed')});
 return r.data;
}
export function validateSupport(d){return {reports:arr(d.reports,2000).map(r=>{if(!isObj(r)||!UUID.test(r.id))throw bad();return {id:r.id,route:str(r.route,{max:500}),module:str(r.module??'',{max:100}),status:oneOf(r.status,['open','resolved']),message:str(r.message,{max:10000}),reporterName:str(r.reporterName,{max:300}),createdAt:date(r.createdAt),viewport:str(r.viewport??null,{nullable:true,max:50}),lastErrorCode:str(r.lastErrorCode??null,{nullable:true,max:100})};})};}
export const support=signal=>staffData('support-inbox',{},signal).then(validateSupport);
/** Source PATCH /api/support/reports/:id (no body). 409 already_resolved is a state conflict, 404 gone. */
export async function resolveReport(id,signal){if(!UUID.test(id))throw new TypeError('invalid');return ok(await call('PATCH',`/api/support/reports/${id}`,undefined,signal));}
/** Live classes. Read DTOs PROPOSED (server computes joinState/opensAt with ITS clock, attendance counts by one grouped COUNT). */
const CLASS_STATUS=['upcoming','live','completed','recorded','cancelled'];
export function validateClasses(d){return {classes:arr(d.classes,2000).map(c=>{if(!isObj(c)||!UUID.test(c.id))throw bad();return {id:c.id,title:str(c.title,{max:200}),status:oneOf(c.status,CLASS_STATUS),scheduledAt:date(c.scheduledAt),durationMinutes:int(c.durationMinutes,{min:1,max:1440}),attendees:int(c.attendees??0)};})};}
export const liveClasses=signal=>staffData('teacher-live-classes',{},signal).then(validateClasses);
export function validateClassDetail(d){const c=d.liveClass;if(!isObj(c)||!UUID.test(c.id))throw bad();
 return {liveClass:{id:c.id,title:str(c.title,{max:200}),topic:str(c.topic??null,{nullable:true,max:500}),status:oneOf(c.status,CLASS_STATUS),scheduledAt:date(c.scheduledAt),durationMinutes:int(c.durationMinutes,{min:1,max:1440}),hasMeetingUrl:bool(c.hasMeetingUrl),hasRecordingUrl:bool(c.hasRecordingUrl)},
  joinState:oneOf(d.joinState,['cancelled','open','too_early','closed']),opensAt:date(d.opensAt),
  roster:arr(d.roster??[],5000).map(r=>{if(!isObj(r))throw bad();return {name:str(r.name,{max:300}),email:str(r.email??null,{nullable:true,max:320}),joinedAt:date(r.joinedAt)};})};}
export const liveClassDetail=(id,signal)=>UUID.test(id)?staffData('teacher-live-class',{id},signal).then(validateClassDetail):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
const urlOk=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol);}catch{return false;}};
/** Source POST /api/teacher/live-classes. scheduledAt is the browser-local datetime-local value converted with new Date().toISOString(). */
export async function createLiveClass({title,topic,scheduledAt,durationMinutes,meetingUrl},signal){
 const when=new Date(scheduledAt);if(!Number.isFinite(when.getTime()))throw Object.assign(new TypeError('date'),{status:400,code:'invalid_input'});
 const dur=Number(durationMinutes);if(!Number.isInteger(dur)||dur<15||dur>240)throw Object.assign(new TypeError('duration'),{status:400,code:'invalid_input'});
 if(String(title??'').length<3||String(title).length>200)throw Object.assign(new TypeError('title'),{status:400,code:'invalid_input'});
 if(meetingUrl&&!urlOk(meetingUrl))throw Object.assign(new TypeError('url'),{status:400,code:'invalid_input'});
 const r=await rawJson('POST','/api/teacher/live-classes',{title,topic:topic||undefined,scheduledAt:when.toISOString(),durationMinutes:String(dur),meetingUrl:meetingUrl||undefined},signal);
 if(!r.ok)throw Object.assign(new Error('create'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});return ok(r.data);
}
/** Source PATCH /api/teacher/live-classes/:id — {status} or {recordingUrl,status:'recorded'}. Ownership is enforced by the server (404 for another teacher's class). */
export async function patchLiveClass(id,body,signal){
 if(!UUID.test(id))throw new TypeError('invalid');const b={};
 if(body.status!==undefined){if(!CLASS_STATUS.includes(body.status))throw new TypeError('status');b.status=body.status;}
 if(body.recordingUrl!==undefined){if(!urlOk(body.recordingUrl))throw new TypeError('url');b.recordingUrl=body.recordingUrl;}
 if(!Object.keys(b).length)throw new TypeError('empty');return ok(await call('PATCH',`/api/teacher/live-classes/${id}`,b,signal));
}
