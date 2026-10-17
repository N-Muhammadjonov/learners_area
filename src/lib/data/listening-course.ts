import 'server-only';
import {and,eq} from 'drizzle-orm';
import {db} from '@/db/client';
import {users,listeningAuthoredCheckpoints,listeningAttempts,listeningAnswers} from '@/db/schema';
import {COURSE_PROGRESS_KEY,originalCourseSpec,readCourseWork,mergeCourseAnswers,courseStatus,type CourseSpec,type CourseWork} from '@/lib/listening/course-progress';
import {originalListeningStorageKey} from '@/lib/listening/original-listening';

async function existingExam(userId:string,testId:string,sourceId:string,values:Record<string,string>,work:CourseWork,database:typeof db){
 if(work.exam)return work;
 let state;try{state=JSON.parse(values[originalListeningStorageKey(sourceId)]??'{}');}catch{return work;}
 if(state.attemptStatus!=='submitted')return work;
 const attempt=await database.query.listeningAttempts.findFirst({where:and(eq(listeningAttempts.userId,userId),eq(listeningAttempts.testId,testId),eq(listeningAttempts.status,'completed')),orderBy:(a,{desc})=>desc(a.submittedAt)});
 if(!attempt)return work;
 const answers=await database.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId,attempt.id));
 if(answers.length!==40)return work;
 const results:Array<{q:number;ok:boolean}>=state.lastResults??[];
 if(results.length!==40)return work;
 return {...work,exam:true,retry:results.filter(r=>!r.ok).map(r=>String(r.q))};
}
export async function originalCourseStatus(userId:string,testId:string,sourceId:string,database=db){
 if(!originalCourseSpec(sourceId))return null;
 const row=await database.query.listeningAuthoredCheckpoints.findFirst({where:and(eq(listeningAuthoredCheckpoints.userId,userId),eq(listeningAuthoredCheckpoints.testId,testId))});
 return originalCourseStatusFromValues(userId,testId,sourceId,row?.values??{},database);
}
/** Reuses the authoritative checkpoint already read by the hydration endpoint. */
export async function originalCourseStatusFromValues(userId:string,testId:string,sourceId:string,values:Record<string,string>,database=db){
 const spec=originalCourseSpec(sourceId);if(!spec)return null;
 return courseStatus(spec,await existingExam(userId,testId,sourceId,values,readCourseWork(values,spec),database));
}
export async function recordOriginalCourseWork(userId:string,testId:string,sourceId:string,activity:string,answers:Record<string,string>,database=db){
 const spec=originalCourseSpec(sourceId);if(!spec)throw Error('not_found');
 return database.transaction(async tx=>{
  // Same account-first lock as runtime saves: neither can overwrite the other's data.
  await tx.select({id:users.id}).from(users).where(eq(users.id,userId)).for('update');
  const old=await tx.query.listeningAuthoredCheckpoints.findFirst({where:and(eq(listeningAuthoredCheckpoints.userId,userId),eq(listeningAuthoredCheckpoints.testId,testId))});
  const values={...old?.values};
  const current=await existingExam(userId,testId,sourceId,values,readCourseWork(values,spec),tx as never);
  const work=mergeCourseAnswers(spec,current,activity,answers);
  values[COURSE_PROGRESS_KEY]=JSON.stringify(work);
  await tx.insert(listeningAuthoredCheckpoints).values({userId,testId,values}).onConflictDoUpdate({target:[listeningAuthoredCheckpoints.userId,listeningAuthoredCheckpoints.testId],set:{values,updatedAt:new Date()}});
  return courseStatus(spec,work);
 });
}
/** Called only after canonical grading has replaced raw.lastResults with server results. */
export function certifyCourseExam(values:Record<string,string>,previous:Record<string,string>,sourceId:string,state:{attemptStatus?:string;answers?:Record<string,string>;lastResults?:unknown}){
 const spec:CourseSpec|null=originalCourseSpec(sourceId);
 const safe={...values};delete safe[COURSE_PROGRESS_KEY];
 if(previous[COURSE_PROGRESS_KEY])safe[COURSE_PROGRESS_KEY]=previous[COURSE_PROGRESS_KEY]!;
 if(!spec||state.attemptStatus!=='submitted')return safe;
 const results=state.lastResults as Array<{q:number;ok:boolean}>|undefined;
 if(results?.length!==40)return safe;
 const work=readCourseWork(previous,spec);
 safe[COURSE_PROGRESS_KEY]=JSON.stringify({...work,exam:true,retry:results.filter(r=>!r.ok).map(r=>String(r.q))});
 return safe;
}
