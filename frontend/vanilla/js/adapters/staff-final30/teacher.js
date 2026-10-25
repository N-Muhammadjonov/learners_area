import {bad,isObj,str,int,bool,oneOf,arr,date,staffData,call,ok,rawJson,UUID} from './core.js';
import {validateStudentResults} from './people.js';
/** Teacher/staff read DTOs are PROPOSED; mutations are the original handlers. Roster scoping is SERVER-side (teacher => own roster only). */
export function validateStudents(d){return {students:arr(d.students,5000).map(s=>{if(!isObj(s)||!UUID.test(s.id))throw bad();return {id:s.id,name:str(s.name,{max:300}),email:str(s.email,{nullable:true,max:320}),onboarded:s.onboardingCompletedAt!=null&&date(s.onboardingCompletedAt)instanceof Date};})};}
export const students=signal=>staffData('teacher-students',{},signal).then(validateStudents);
const band=v=>v==null?null:(typeof v==='number'&&v>=0&&v<=9?v:(()=>{throw bad();})());
export function validateStudentDetail(d){
 const s=d.student;if(!isObj(s)||!UUID.test(s.id))throw bad();
 const act=d.activation;
 const ev=e=>e==null?null:(()=>{if(!isObj(e))throw bad();return {overallEstimate:band(e.overallEstimate),checkedByName:str(e.checkedByName,{max:200}),provenanceLabel:str(e.provenanceLabel??'',{max:200}),confidence:(typeof e.confidence==='number'&&e.confidence>=0&&e.confidence<=1)?e.confidence:(()=>{throw bad();})(),weaknesses:arr(e.weaknesses??[],50).map(w=>str(w,{max:1000}))};})();
 return {student:{id:s.id,name:str(s.name,{max:300}),email:str(s.email,{nullable:true,max:320})},results:validateStudentResults({student:s,unavailable:d.results?.unavailable,testIds:d.results?.testIds,attempts:d.results?.attempts,practice:d.results?.practice}),
  activation:{wordsActivated:int(act?.wordsActivated??0),averageActivation:act?.averageActivation==null?null:(typeof act.averageActivation==='number'?act.averageActivation:(()=>{throw bad();})()),dayStreak:int(act?.dayStreak??0),lastSession:act?.lastSession==null?null:{accepted:int(act.lastSession.accepted),attempts:int(act.lastSession.attempts)}},
  prompts:arr(d.prompts??[],1000).map(p=>{if(!isObj(p)||!UUID.test(p.id))throw bad();return {id:p.id,label:str(p.label,{max:300})};}),
  submissions:arr(d.submissions,2000).map(x=>{if(!isObj(x)||!UUID.test(x.id))throw bad();return {id:x.id,status:oneOf(x.status,['draft','submitted','evaluated']),category:str(x.category??'',{max:200}),content:str(x.content??'',{max:200000}),evaluation:ev(x.evaluation),feedback:arr(x.feedback??[],200).map(f=>{if(!isObj(f))throw bad();return {id:str(f.id,{max:100}),source:str(f.source,{max:40}),overallBand:band(f.overallBand),comment:str(f.comment??'',{max:5000})};})};})};
}
export const studentDetail=(id,signal)=>UUID.test(id)?staffData('teacher-student',{id},signal).then(validateStudentDetail):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
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
