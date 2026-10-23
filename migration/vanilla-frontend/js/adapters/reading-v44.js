import {ApiError} from '../api-client.js';
import {lessonDTO} from './listening-lessons-v10.js';
/** Reading read-projections. These are PROPOSED view adapters (same contract family as viewData): no backend
 * route is created here. Writes use the existing POST/PATCH endpoints. A disconnected server returns 503, and
 * nothing is synthesised. Validation mirrors the listening lesson DTO; the area label is the only difference. */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),bad=code=>{throw new ApiError(502,code);};
/** Reading lesson detail. The listening validator checks shape, blocks, quiz answers and media URLs; it is run on
 * an area-normalised copy so the original listening code is untouched. */
export function readingLessonDTO(d,id){
 if(!obj(d)||!obj(d.lesson)||d.lesson.learningArea!=='reading')bad('invalid_reading_lesson');
 if(!obj(d.progress)||typeof d.progress.state!=='string'||(d.progress.completedAt!==null&&d.progress.completedAt!==undefined&&typeof d.progress.completedAt!=='string'))bad('invalid_reading_lesson');
 lessonDTO({...d,lesson:{...d.lesson,learningArea:'listening'}},id);
 return d;
}
const str=x=>typeof x==='string',int=x=>Number.isSafeInteger(x)&&x>=0,nullable=x=>x===null||x===undefined;
const STATUSES=['not_started','in_progress','completed'];
/** Academic catalogue projection: `{sets:[{id,title,locked,assessmentStatus,attemptId,passages:[{passageNo,title}]}]}`. */
export function readingAcademicCatalogueDTO(raw){
 if(!obj(raw)||!Array.isArray(raw.sets))bad('invalid_reading_academic');
 for(const s of raw.sets){
  if(!obj(s)||!str(s.id)||!str(s.title)||typeof s.locked!=='boolean'||!STATUSES.includes(s.assessmentStatus)||!(nullable(s.attemptId)||str(s.attemptId))||!Array.isArray(s.passages))bad('invalid_reading_academic');
  for(const p of s.passages)if(!obj(p)||!int(p.passageNo)||!str(p.title))bad('invalid_reading_academic');
 }
 return raw;
}
/** One Academic set's intro: `{set:{id,title}, passages:[{passageNo,title}]}` or `{kind:'not_found'}`. */
export function readingAcademicSetDTO(raw,setId){
 if(!obj(raw)||!obj(raw.set)||raw.set.id!==setId||!str(raw.set.title)||!Array.isArray(raw.passages)||raw.passages.length!==3)bad('invalid_reading_academic_set');
 return {title:raw.set.title,passages:raw.passages.map(p=>{if(!obj(p)||!int(p.passageNo)||!str(p.title))bad('invalid_reading_academic_set');return {passageNo:p.passageNo,title:p.title};})};
}
/** Attempt projection (the server-computed getAttemptDetail): attempt, passage, sections, questions, groups,
 * paragraphs, answers and occurrences. Answer keys exist only after submit; the exam reads public fields only. */
export function readingAttemptDTO(raw,id){
 if(!obj(raw)||raw.kind!=='attempt'||!obj(raw.detail))bad('invalid_reading_attempt');
 const d=raw.detail,a=d.attempt;
 if(!obj(a)||a.id!==id||!['in_progress','completed'].includes(a.status)||!str(a.startedAt)||!obj(d.passage)||!str(d.passage.title)||!str(d.passage.bodyText)||!int(d.passage.suggestedMinutes))bad('invalid_reading_attempt');
 for(const k of ['sections','questions','groups','paragraphs','answers','occurrences'])if(!Array.isArray(d[k]))bad('invalid_reading_attempt');
 return d;
}
