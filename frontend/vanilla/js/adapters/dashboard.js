import {safeNextPath} from '../safe-next.js';
import {ApiError} from '../api-client.js';
const skills=['listening','reading','writing','speaking'];
const bad=()=>{throw new ApiError(502,'invalid_dashboard_adapter');};
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x),text=x=>typeof x==='string',number=x=>typeof x==='number'&&Number.isFinite(x),count=x=>Number.isSafeInteger(x)&&x>=0;
const date=x=>x==null||((text(x)||x instanceof Date)&&Number.isFinite(new Date(x).getTime()));
const path=x=>text(x)&&/^\/app(?:\/|$)/.test(x)&&safeNextPath(x)===x;
/** Narrow safe presentation projection of getDashboardData, never DB rows/answers. */
export function dashboardDTO(d){
 if(!object(d)||!object(d.unavailable)||Object.entries(d.unavailable).some(([k,v])=>!['profile','latestEvaluation','vocabDue','streak','writingAttempts','readingAttempts','listeningAttempts','speakingAttempts','assignments','nextLiveClass','lastActivity'].includes(k)||typeof v!=='boolean')||!object(d.skillCounts)||skills.some(k=>d.skillCounts[k]!==null&&!count(d.skillCounts[k])))bad();
 for(const k of ['streak','writingAttempts','vocabDueCount'])if(d[k]!==null&&!count(d[k]))bad();
 if(d.profile!==null&&(!object(d.profile)||d.profile.targetBand!==null&&(!number(d.profile.targetBand)||d.profile.targetBand<0||d.profile.targetBand>9)))bad();
 if(d.lastActivity!==null&&(!object(d.lastActivity)||!['reading','listening','writing','speaking','vocabulary'].includes(d.lastActivity.module)||!path(d.lastActivity.href)||!d.lastActivity.at||!date(d.lastActivity.at)))bad();
 if(d.openAssignments!==null&&(!Array.isArray(d.openAssignments)||d.openAssignments.some(a=>!object(a)||!text(a.id)||a.mockTestId!=null&&!text(a.mockTestId)||!text(a.title)||!date(a.dueAt))))bad();
 if(d.nextLiveClass!==null&&(!object(d.nextLiveClass)||!text(d.nextLiveClass.id)||!text(d.nextLiveClass.title)||!d.nextLiveClass.scheduledAt||!date(d.nextLiveClass.scheduledAt)))bad();
 if(d.latestEvaluation!==null&&(!object(d.latestEvaluation)||d.latestEvaluation.overallEstimate!==null&&(!number(d.latestEvaluation.overallEstimate)||d.latestEvaluation.overallEstimate<0||d.latestEvaluation.overallEstimate>9)||!Array.isArray(d.latestEvaluation.weaknesses)||d.latestEvaluation.weaknesses.some(x=>!text(x))||!text(d.latestEvaluation.checkedByName)))bad();
 return d;
}
export function openLessonsDTO(d){if(!object(d)||typeof d.ok!=='boolean')bad();if(d.ok&&(!Array.isArray(d.lessons)||d.lessons.some(l=>!object(l)||!text(l.id)||!(/^[A-Za-z0-9_-]+$/).test(l.id)||!text(l.title)||!text(l.moduleTitle)||!text(l.unitTitle)||!['available','assigned','in_progress'].includes(l.state))))bad();return d;}
/** Presentation-only mocks; scores remain server supplied, never recomputed here. */
export function mockDTO(d){
 if(!object(d)||!Array.isArray(d.tests)||!Array.isArray(d.attempts)||d.tests.length>5000||d.attempts.length>5000||['catalogueUnavailable','attemptsUnavailable','attemptTitlesUnavailable'].some(k=>typeof d[k]!=='boolean')||d.catalogueTruncated!==undefined&&typeof d.catalogueTruncated!=='boolean'||d.attemptsTruncated!==undefined&&typeof d.attemptsTruncated!=='boolean'||!count(d.finishedCount))bad();
 if(d.tests.some(t=>!object(t)||!text(t.id)||!text(t.title)||!['full',...skills].includes(t.skill)))bad();
 if(new Set(d.tests.map(t=>t.id)).size!==d.tests.length||new Set(d.attempts.map(a=>a.id)).size!==d.attempts.length||d.attempts.some(a=>a&&['snapshot','mockSnapshot','questions','answers'].some(k=>k in a)))bad();
 const attempts=d.attempts.map(a=>{if(!object(a)||!text(a.id)||a.mockTestId!=null&&!text(a.mockTestId)||a.title!=null&&!text(a.title)||a.skill!=null&&!['full',...skills].includes(a.skill)||!date(a.startedAt)||!date(a.finishedAt)||a.estimatedBand!=null&&(!number(a.estimatedBand)||a.estimatedBand<0||a.estimatedBand>9)||a.rawScore!=null&&!number(a.rawScore))bad();return {...a,mockTestId:a.mockTestId??null,startedAt:a.startedAt?new Date(a.startedAt):null,finishedAt:a.finishedAt?new Date(a.finishedAt):null};});
 return {...d,catalogueTruncated:d.catalogueTruncated??false,attemptsTruncated:d.attemptsTruncated??false,attempts};
}
