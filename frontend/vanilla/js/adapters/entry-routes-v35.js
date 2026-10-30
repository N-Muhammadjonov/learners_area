/** Minimized read-only consumers of the EXISTING PROPOSED view boundary.
 * Server must enforce current user, publication and ownership. DTOs do not grant access.
 * No client grading, mastery calculation, curriculum data or fallback records. */
import {ApiError} from '../api-client.js';import {uuid} from './listening-v7.js';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),text=x=>typeof x==='string',nullable=x=>x===null||text(x),count=x=>Number.isSafeInteger(x)&&x>=0;
const bad=()=>{throw new ApiError(502,'invalid_entry_view');};
const clean=x=>obj(x)&&!['answers','answerKey','correctAnswer','payload','runtime','notes','userId','email'].some(k=>Object.hasOwn(x,k));
const states=new Set(['locked','scheduled','available','assigned','in_progress','completed']);
export function roadmapDTO(data){
 if(!clean(data)||!Object.hasOwn(data,'roadmap'))bad();if(data.roadmap===null)return null;
 const r=data.roadmap;if(!clean(r)||!clean(r.course)||!text(r.course.title)||!nullable(r.course.description)||!Array.isArray(r.modules))bad();const seen=new Set();
 function identity(v){if(!clean(v)||!uuid(v.id)||seen.has(v.id)||!text(v.title))bad();seen.add(v.id);}
 return {course:{title:r.course.title,description:r.course.description},modules:r.modules.map(m=>{identity(m);if(!Array.isArray(m.units))bad();return {id:m.id,title:m.title,units:m.units.map(u=>{identity(u);if(!Array.isArray(u.lessons))bad();return {id:u.id,title:u.title,lessons:u.lessons.map(l=>{identity(l);if(!nullable(l.summary)||!states.has(l.state))bad();return {id:l.id,title:l.title,summary:l.summary,state:l.state};})};})};})};
}
export function grammarArea(url){const tab=url.searchParams.get('tab');return !tab?null:tab==='speaking'?'speaking':'writing';}
export function grammarDTO(data){
 if(!clean(data)||!Array.isArray(data.rows))bad();const seen=new Set();return data.rows.map(r=>{
  const t=r?.topic,m=r?.mastery;if(!clean(r)||!clean(t)||!uuid(t.id)||seen.has(t.id)||!text(t.title)||!['writing','speaking'].includes(t.skillArea)||!count(r.totalExercises)||typeof r.masteryUnavailable!=='boolean'||(m===null)!==r.masteryUnavailable)bad();seen.add(t.id);
  if(m!==null&&(!clean(m)||!Number.isFinite(m.scorePercent)||m.scorePercent<0||m.scorePercent>100||!count(m.sessions)||typeof m.mastered!=='boolean'))bad();
  return {topic:{id:t.id,title:t.title,skillArea:t.skillArea},totalExercises:r.totalExercises,masteryUnavailable:r.masteryUnavailable,mastery:m===null?null:{scorePercent:m.scorePercent,sessions:m.sessions,mastered:m.mastered}};
 });
}
