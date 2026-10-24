import {bad,isObj,str,int,bool,oneOf,arr,date,ROLES,STATUSES,UUID,staffData,call,ok} from './core.js';
/** Source: src/lib/data/people.ts PersonRow + listPeople result; src/lib/data/admission.ts. */
const person=p=>{if(!isObj(p)||!UUID.test(p.id))throw bad();return {id:p.id,name:str(p.name,{max:300}),email:str(p.email,{nullable:true,max:320}),role:oneOf(p.role,ROLES),accountStatus:oneOf(p.accountStatus,STATUSES),statusReason:str(p.statusReason,{nullable:true,max:1000}),createdAt:date(p.createdAt),lastActiveAt:p.lastActiveAt==null?null:date(p.lastActiveAt),telegramLinked:bool(p.telegramLinked),username:p.username==null?null:str(p.username,{max:100}),phoneNumber:p.phoneNumber==null?null:str(p.phoneNumber,{max:40}),online:p.online===undefined?null:bool(p.online),seenAt:p.seenAt==null?null:date(p.seenAt),visitSeconds:p.visitSeconds==null?null:int(p.visitSeconds),totalSeconds:p.totalSeconds==null?null:int(p.totalSeconds)};};
export function validateDirectory(d){
 const total=int(d.total),pageSize=int(d.pageSize,{min:1,max:500}),page=int(d.page,{min:1,max:100000}),totalPages=int(d.totalPages,{min:0});
 const f=d.filters;if(!isObj(f))throw bad();
 if(!UUID.test(d.actorId))throw bad();
 return {people:arr(d.people,500).map(person),filters:{q:str(f.q??'',{max:100}),role:f.role==null?undefined:oneOf(f.role,ROLES),status:f.status==null?undefined:oneOf(f.status,STATUSES),online:f.online===undefined?false:bool(f.online)},page,pageSize,total,totalPages,onlineCount:d.onlineCount==null?null:int(d.onlineCount),actorId:d.actorId,actorRole:oneOf(d.actorRole,ROLES),grantableRoles:arr(d.grantableRoles,4).map(r=>oneOf(r,ROLES))};
}
export const directory=(query,signal)=>staffData('people',query,signal).then(validateDirectory);
export function validateAdmissions(d){
 const req=r=>{if(!isObj(r)||!UUID.test(r.id))throw bad();return {id:r.id,applicantName:str(r.applicantName,{max:300}),applicantEmail:str(r.applicantEmail,{nullable:true,max:320}),message:str(r.message,{nullable:true,max:5000}),createdAt:date(r.createdAt)};};
 const rec=r=>{if(!isObj(r)||!UUID.test(r.id))throw bad();return {id:r.id,applicantName:str(r.applicantName,{max:300}),decidedAt:date(r.decidedAt,{nullable:true})};};
 return {pending:arr(d.pending,1000).map(req),recent:arr(d.recent,50).map(rec)};
}
export const admissions=signal=>staffData('admissions',{},signal).then(validateAdmissions);
/** Source POST /api/admin/admission/:id/decide — {decision:'approve'|'reject',note:string|null}; note max 500. */
export async function decide(id,decision,note,signal){
 if(!UUID.test(id)||!['approve','reject'].includes(decision))throw new TypeError('invalid');
 const n=(note??'').trim();if(n.length>500)throw new TypeError('note too long');
 return ok(await call('POST',`/api/admin/admission/${id}/decide`,{decision,note:n||null},signal));
}
/** Source PATCH /api/admin/users/:id/role — {role}. */
export async function changeRole(id,role,signal){if(!UUID.test(id)||!ROLES.includes(role))throw new TypeError('invalid');return ok(await call('PATCH',`/api/admin/users/${id}/role`,{role},signal));}
/** Source POST /api/admin/users/:id/status — {status,reason:string|null}; reason max 500. */
export async function changeStatus(id,status,reason,signal){if(!UUID.test(id)||!STATUSES.includes(status))throw new TypeError('invalid');const r=(reason??'').trim();if(r.length>500)throw new TypeError('reason too long');return ok(await call('POST',`/api/admin/users/${id}/status`,{status,reason:r||null},signal));}
/** Student results (admin people/:id). Source: getMockOverview + getProgressData; attempt rows only, no answers/keys. */
const SKILLS=['reading','listening','speaking','writing','full'];
export function validateStudentResults(d){
 const s=d.student;if(!isObj(s)||!UUID.test(s.id))throw bad();
 const band=v=>v===null?null:(typeof v==='number'&&v>=0&&v<=9?v:(()=>{throw bad();})());
 const raw=v=>v==null?null:(typeof v==='number'||typeof v==='string'?v:(()=>{throw bad();})());
 return {student:{id:s.id,name:str(s.name,{max:300}),email:str(s.email,{nullable:true,max:320})},unavailable:d.unavailable===undefined?false:bool(d.unavailable),
  testIds:arr(d.testIds??[],5000).map(x=>str(x,{max:100})),
  attempts:arr(d.attempts??[],5000).map(a=>{if(!isObj(a))throw bad();return {id:str(a.id,{max:100}),mockTestId:a.mockTestId==null?null:str(a.mockTestId,{max:100}),title:str(a.title,{nullable:true,max:300}),skill:a.skill==null?null:oneOf(a.skill,SKILLS),finishedAt:date(a.finishedAt,{nullable:true}),estimatedBand:band(a.estimatedBand??null),rawScore:raw(a.rawScore)};}),
  practice:Object.fromEntries(SKILLS.map(k=>[k,d.practice?.[k]==null?null:int(d.practice[k])]))};
}
export const studentResults=(id,signal)=>{if(!UUID.test(id))return Promise.reject(Object.assign(new Error('not_found'),{status:404}));return staffData('student-results',{id},signal).then(validateStudentResults);};
/** Teacher rosters. Source: roster page + POST /api/admin/roster (FORM post, 303 redirect — native form kept). */
export function validateRoster(d){
 const one=x=>{if(!isObj(x)||!UUID.test(x.id))throw bad();return {id:x.id,name:str(x.name,{max:300})};};
 return {teachers:arr(d.teachers,1000).map(one),selected:d.selected==null?null:one(d.selected),roster:arr(d.roster??[],1000).map(one),candidates:arr(d.candidates??[],1000).map(one),listCap:int(d.listCap??1000,{min:1}),rosterCap:int(d.rosterCap??500,{min:1}),query:str(d.query??'',{max:60})};
}
export const roster=(query,signal)=>staffData('roster',query,signal).then(validateRoster);
