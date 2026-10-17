import 'server-only';
import {and,asc,eq,sql} from 'drizzle-orm';
import {db} from '@/db/client';
import {listeningTests,listeningPackages,listeningAuthoredCheckpoints} from '@/db/schema';
import {isStaff,type Role} from '@/lib/auth/roles';
import {liveWhere} from '@/lib/services/cms/publication';
import {originalListeningBatchSequence,hasOriginalListeningRuntime,originalListeningStorageKey} from '@/lib/listening/original-listening';
import {COURSE_PROGRESS_KEY,savedCourseStatus,sequentialLocks} from '@/lib/listening/course-progress';
import {MCQ_PROGRAM_REF} from '@/lib/listening/mcq-program';
import {mcqProgramDays} from './listening-mcq';

/** One order shared by the single catalogue and every server access check. */
export function listeningSequenceOrder(){
 const ordinal=sql<number|null>`case ${sql.join(originalListeningBatchSequence.map(([sourceId,number])=>sql`when ${listeningPackages.sourceId}=${sourceId} then ${number}::integer`),sql` `)} else null end`;
 return [asc(listeningTests.createdAt),asc(ordinal),asc(listeningTests.sourceRef),asc(listeningTests.id)];
}
export function originalCourseColumns(userId:string){
 const storageKey=sql<string>`case ${sql.join(['listening-test-1',...originalListeningBatchSequence.map(([id])=>id)].map(id=>sql`when ${listeningPackages.sourceId}=${id} then ${originalListeningStorageKey(id)}`),sql` `)} else '' end`;
 return {courseWork:sql<string|null>`${listeningAuthoredCheckpoints.values}->>${COURSE_PROGRESS_KEY}`,runtimeState:sql<string|null>`${listeningAuthoredCheckpoints.values}->>${storageKey}`,originalExamSubmitted:sql<boolean>`exists(select 1 from listening_attempts a where a.test_id=${listeningTests.id} and a.user_id=${userId} and a.status='completed')`};
}
export async function listeningSequenceAccess(user:{id?:string;role:Role},testId:string,database=db):Promise<boolean>{
 if(isStaff(user.role))return true;
 if(!user.id)return false;
 const target=await database.query.listeningTests.findFirst({where:eq(listeningTests.id,testId)});
 if(!target)return false;
 if(target.programRef===MCQ_PROGRAM_REF){
  const catalogue=await mcqProgramDays({id:user.id,role:user.role},{},database);
  return catalogue.days.some(day=>day.testId===testId&&!day.locked);
 }
 const rows=await database.select({id:listeningTests.id,sourceId:listeningPackages.sourceId,...originalCourseColumns(user.id)})
  .from(listeningPackages).innerJoin(listeningTests,eq(listeningTests.id,listeningPackages.testId))
  .leftJoin(listeningAuthoredCheckpoints,and(eq(listeningAuthoredCheckpoints.testId,listeningTests.id),eq(listeningAuthoredCheckpoints.userId,user.id)))
  .where(liveWhere(listeningTests)).orderBy(...listeningSequenceOrder());
 const course=rows.filter(row=>hasOriginalListeningRuntime(row.id,row.sourceId));
 const index=course.findIndex(row=>row.id===testId);
 if(index<0)return true; // Other products retain their existing access rules.
 return !sequentialLocks(course.map(row=>({complete:savedCourseStatus(row.sourceId,row.courseWork,row.originalExamSubmitted,row.runtimeState)!.complete})))[index];
}
