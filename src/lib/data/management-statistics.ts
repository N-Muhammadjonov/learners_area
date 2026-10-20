import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
export const RESULT_MODULES=['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','assignments','mocks'] as const;
export type ResultModule=typeof RESULT_MODULES[number];
export const resultModule=(value?:string)=>RESULT_MODULES.find(m=>m===value);
/** Fixed internal source inventory. Grades stay in their original units; drafts
 * never enter averages. No essays, recordings, answer keys or recall text leave SQL. */
export function learningResultsSql(userId?:string):SQL {
 const source=(module:ResultModule,activity:string,from:string,at:string,done:string,score='null',maximum='null',unit='percent',title='null::text')=>sql`select a.id,a.user_id,${module}::text module,${activity}::text activity,${sql.raw(at)} at,(${sql.raw(done)}) completed,(${sql.raw(score)})::float8 score,(${sql.raw(maximum)})::float8 maximum,${unit}::text unit,${sql.raw(title)} title from ${sql.raw(from)} ${userId?sql`where a.user_id=${userId}::uuid`:sql``}`;
 const band=(type:string)=>`(select e.overall_estimate from evaluations e where e.user_id=a.user_id and e.source_id=a.id and e.source_type='${type}' order by e.created_at desc,e.id desc limit 1)`;
 return sql.join([
  source('reading','academic','reading_attempts a join reading_passages p on p.id=a.passage_id','coalesce(a.submitted_at,a.started_at)',"a.status='completed'",'a.score','a.total_questions','percent','p.title'),
  source('reading','general','general_reading_progress a join reading_passages p on p.id=a.passage_id','a.updated_at','a.checked_at is not null','a.score','a.total','percent','p.title'),
  source('listening','academic','listening_attempts a','coalesce(a.submitted_at,a.started_at)',"a.status='completed'",'a.score','a.total_questions'),
  source('listening','activities','listening_activity_runs a','a.created_at','a.completed','a.score','a.total'),
  source('listening','mcq','listening_mcq_sessions a','a.updated_at',"a.stage='reasoned'"),
  source('writing','essays','writing_submissions a','coalesce(a.submitted_at,a.updated_at)','a.submitted_at is not null',band('writing_submission'),'9','band'),
  source('writing','typing','typing_runs a','a.created_at','a.typed_chars>0','a.accuracy','100','percent',"a.wpm::text||' WPM'"),
  source('writing','translation','writing_translation_attempts a','coalesce(a.completed_at,a.started_at)','a.completed_at is not null','a.overall_estimate','9','band'),
  source('writing','patterns','writing_stealing_sessions a','a.updated_at','a.completed_at is not null'),
  source('writing','patternPractice',"(select * from activity_events where type='WRITING_PATTERN_PRACTICE') a",'a.created_at','true'),
  source('speaking','speaking','speaking_attempts a','coalesce(a.submitted_at,a.created_at)','a.submitted_at is not null',band('speaking_attempt'),'9','band'),
  source('retention','retention','retention_attempts a','coalesce(a.completed_at,a.created_at)',"a.status in ('completed','timed_out')",'a.score','100','percent',"coalesce(a.retention_label_snapshot,a.level::text)"),
  source('grammar','grammar','grammar_attempts a','a.attempted_at','true',"case when a.is_correct then 1 else 0 end",'1'),
  source('video','video','video_lesson_progress a join video_lessons p on p.id=a.video_lesson_id','a.updated_at','a.completed_at is not null','(select count(*) from jsonb_each(coalesce(a.answers,\'{}\'::jsonb)) v where (v.value->>\'correct\')::boolean)','(select count(*) from jsonb_each(coalesce(a.answers,\'{}\'::jsonb)))','percent','p.title'),
  source('vocabulary','words','user_vocabulary a','a.created_at','true'),
  source('vocabulary','games',"(select * from activity_events where type='VOCAB_GAME_PRACTICED') a",'a.created_at','true',"case when a.payload->>'verified'='true' then case when a.payload->>'correct'='true' then 1 else 0 end end","case when a.payload->>'verified'='true' then 1 end",'percent',"case when a.payload->>'kind'='self' then 'Flashcards' else a.payload->>'kind' end"),
  source('vocabulary','revision',"(select * from activity_events where type='VOCAB_REVIEWED') a",'a.created_at','true'),
  source('writing','activation',"(select * from activity_events where type='WRITING_ACTIVATION_CHECK') a",'a.created_at',"a.payload->>'verdict' in ('correct','needs_revision')", "case when jsonb_typeof(a.payload->'activationScore')='number' then (a.payload->>'activationScore')::float8 end",'100'),
  source('writing','lessons',"(select lesson_id as id,user_id,completed_at from writing_lesson_progress) a",'a.completed_at','true'),
  source('lessons','lessons','lesson_progress a join lessons p on p.id=a.lesson_id','a.updated_at',"a.state='completed'",'null','null','percent','p.title'),
  source('assignments','assignments','assignment_responses a','a.updated_at',"length(trim(a.content))>0"),
  source('mocks','mocks','mock_attempts a','coalesce(a.finished_at,a.started_at)','a.finished_at is not null','a.estimated_band','9','band'),
 ],sql` union all `);
}
export type ResultRow={id:string;module:ResultModule;activity:string;at:string;completed:boolean;score:number|null;maximum:number|null;unit:string;title:string|null};
export async function learningSummary(userId?:string,executor:typeof db=db){
 const r=await executor.execute<{module:ResultModule;started:number;completed:number;learners:number;accuracy:number|null;band:number|null;latest:string|null}>(sql`with results as materialized (${learningResultsSql(userId)}) select module,count(*)::int started,count(*) filter(where completed)::int completed,count(distinct user_id)::int learners,avg(score/nullif(maximum,0)*100) filter(where completed and maximum>0 and unit='percent')::float8 accuracy,avg(score) filter(where completed and unit='band')::float8 band,max(at)::text latest from results r join users u on u.id=r.user_id ${userId?sql``:sql`where u.role='student' and u.account_status<>'rejected'`} group by module`);
 return RESULT_MODULES.map(module=>r.rows.find(r=>r.module===module)??{module,started:0,completed:0,learners:0,accuracy:null,band:null,latest:null});
}
export async function resultHistory(userId:string,module?:string,page=1,executor:typeof db=db){
 const selected=resultModule(module),where=selected?sql`where module=${selected}`:sql``;
 const [count]=(await executor.execute<{total:number}>(sql`with results as materialized (${learningResultsSql(userId)}) select count(*)::int total from results ${where}`)).rows;
 const total=count?.total??0,pages=Math.max(1,Math.ceil(total/25)),current=Math.min(pages,Math.max(1,Math.floor(page)||1));
 const rows=(await executor.execute<ResultRow>(sql`with results as materialized (${learningResultsSql(userId)}) select id,module,activity,at::text,completed,score,maximum,unit,title from results ${where} order by at desc nulls last,id desc limit 25 offset ${(current-1)*25}`)).rows;
 return {rows,total,pages,page:current,module:selected};
}
export async function centreStatistics(module?:string,executor:typeof db=db){
 const selected=resultModule(module),filter=selected?sql`where module=${selected}`:sql``;
 type Data={summary:Awaited<ReturnType<typeof learningSummary>>;daily:{day:string;count:number}[];students:{id:string;name:string;started:number;completed:number;accuracy:number|null;band:number|null}[];levels:{level:string;rounds:number;average:number|null}[]};
 const row=(await executor.execute<{data:Data}>(sql`with results as materialized (${learningResultsSql()}), scoped as materialized (select r.*,u.name from results r join users u on u.id=r.user_id where u.role='student' and u.account_status<>'rejected'), chosen as materialized(select * from scoped ${filter}) select jsonb_build_object(
 'summary',(select coalesce(jsonb_agg(s),'[]'::jsonb) from (select module,count(*)::int started,count(*) filter(where completed)::int completed,count(distinct user_id)::int learners,avg(score/nullif(maximum,0)*100) filter(where completed and maximum>0 and unit='percent')::float8 accuracy,avg(score) filter(where completed and unit='band')::float8 band,max(at)::text latest from scoped group by module) s),
 'daily',(select coalesce(jsonb_agg(d order by d."day"),'[]'::jsonb) from (select to_char(at at time zone 'Asia/Tashkent','YYYY-MM-DD') as "day",count(*)::int count from chosen where completed and at>=now()-interval '14 days' group by 1) d),
 'students',(select coalesce(jsonb_agg(s order by completed desc,name),'[]'::jsonb) from (select user_id id,name,count(*)::int started,count(*) filter(where completed)::int completed,avg(score/nullif(maximum,0)*100) filter(where completed and maximum>0 and unit='percent')::float8 accuracy,avg(score) filter(where completed and unit='band')::float8 band from chosen group by user_id,name order by completed desc,name limit 100) s),
 'levels',(select coalesce(jsonb_agg(l order by level),'[]'::jsonb) from (select a.level,count(*)::int rounds,avg(a.score)::float8 average from retention_attempts a join users u on u.id=a.user_id where u.role='student' and u.account_status<>'rejected' and a.status in ('completed','timed_out') group by a.level) l)
 ) data`)).rows[0]!.data;
 return {...row,summary:RESULT_MODULES.map(module=>row.summary.find(r=>r.module===module)??{module,started:0,completed:0,learners:0,accuracy:null,band:null,latest:null}),selected};
}

export async function retentionSummary(userId:string,executor:typeof db=db){return (await executor.execute<{level:string;rounds:number;average:number|null;best:number|null}>(sql`select level,count(*)::int rounds,avg(score)::float8 average,max(score)::float8 best from retention_attempts where user_id=${userId}::uuid and status in ('completed','timed_out') and score is not null group by level order by level`)).rows;}
