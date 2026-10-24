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
const STATUS3=['not_started','in_progress','completed'];
/** General library projection: `{filter, facets:{topics,types}, library:{items,total,page,pageCount}}` plus the two
 * region flags the original reports as `unavailable` (facets, library). Rows carry no answer keys. */
export function readingGeneralLibraryDTO(raw){
 if(!obj(raw)||!obj(raw.filter)||!obj(raw.facets)||!Array.isArray(raw.facets.topics)||!Array.isArray(raw.facets.types)||!obj(raw.library))bad('invalid_reading_general');
 const lib=raw.library;
 if(!Array.isArray(lib.items)||!int(lib.total)||!int(lib.page)||!int(lib.pageCount))bad('invalid_reading_general');
 for(const item of lib.items){
  if(!obj(item)||!str(item.id)||!str(item.title)||!STATUS3.includes(item.status)||!int(item.questionCount)||!int(item.suggestedMinutes)||!(nullable(item.setId)||str(item.setId))||!(nullable(item.topicCode)||str(item.topicCode)))bad('invalid_reading_general');
 }
 return {...raw,facetsUnavailable:raw.facetsUnavailable===true,libraryUnavailable:raw.libraryUnavailable===true,facets:{topics:raw.facets.topics.map(t=>({code:t.code,count:t.count})),types:raw.facets.types.map(t=>({code:t.code,count:t.count}))}};
}
/** General set projection: the selected passages as the original session consumes them, plus the progress rows the
 * server has already reconciled (`initialProgress`, keyed by passage id). Keys never appear before a check. */
export function readingGeneralSetDTO(raw,setId){
 if(!obj(raw)||raw.kind==='not_found'||!obj(raw.set)||raw.set.id!==setId||!Array.isArray(raw.passages)||!obj(raw.initialProgress))bad('invalid_reading_general_set');
 for(const p of raw.passages){
  if(!obj(p)||!int(p.passageNo)||!str(p.passageId)||!str(p.title)||!str(p.body)||!Array.isArray(p.paragraphs)||!Array.isArray(p.questions)||!Array.isArray(p.groups)||!Array.isArray(p.occurrences))bad('invalid_reading_general_set');
 }
 return raw;
}
/** Retention hub projection: the live attempt (already server-checked), the overview reads and the first history page.
 * `sessionFailed`, `summary` and `history` are null when that read is unavailable, as the original region failures. */
export function readingRetentionDTO(raw){
 if(!obj(raw)||!('initial' in raw)||(raw.initial!==null&&(!obj(raw.initial)||!str(raw.initial.phase))))bad('invalid_reading_retention');
 if(raw.summary!==null&&raw.summary!==undefined&&(!obj(raw.summary)||!int(raw.summary.completedCount)||!int(raw.summary.lastTenCount)))bad('invalid_reading_retention');
 if(raw.history!==null&&raw.history!==undefined&&(!obj(raw.history)||!Array.isArray(raw.history.rows)||!int(raw.history.page)||!int(raw.history.pageCount)||!int(raw.history.total)))bad('invalid_reading_retention');
 return {initial:raw.initial??null,sessionFailed:raw.sessionFailed===true,summary:raw.summary??null,history:raw.history??null};
}
/** Reading attempt history: `{rows:[{attempt:{id,status,score,totalQuestions}, passage:{title}}]}`. */
export function readingHistoryDTO(raw){
 if(!obj(raw)||!Array.isArray(raw.rows))bad('invalid_reading_history');
 for(const r of raw.rows){if(!obj(r)||!obj(r.attempt)||!str(r.attempt.id)||!['in_progress','completed'].includes(r.attempt.status)||!obj(r.passage)||!str(r.passage.title))bad('invalid_reading_history');}
 return raw;
}
/** Retention result permalink: `{kind:'result', payload}` (terminal, learner-safe), `{kind:'live'}`, or unavailable. */
export function readingRetentionResultDTO(raw){
 if(!obj(raw)||!['result','live','unavailable'].includes(raw.kind))bad('invalid_retention_result');
 return raw;
}
