/** Typed presentation projections. The original is server-only SQL, NEVER browser-side aggregation. */
import {bad,isObj,str,int,bool,arr,staffData,UUID,date} from './core.js';
export const RESULT_MODULES=Object.freeze(['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks']);
const moduleValue=x=>{if(!RESULT_MODULES.includes(x))throw bad();return x;};
const count=x=>int(x,{min:0,max:1000000000});
const nullableNumber=(x,min=0,max=100)=>x==null?null:(typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max?x:(()=>{throw bad();})());
const optionalDate=x=>x==null?null:date(x).toISOString();
const summaryItem=x=>{
 if(!isObj(x))throw bad();const module=moduleValue(x.module),started=count(x.started),completed=count(x.completed);
 if(completed>started)throw bad();const learners=count(x.learners);
 if(learners>started)throw bad();
 return {module,started,completed,learners,accuracy:nullableNumber(x.accuracy),band:nullableNumber(x.band,0,9),latest:optionalDate(x.latest)};
};
export function validateSummary(s){
 const list=arr(s,RESULT_MODULES.length).map(summaryItem),seen=new Set();
 for(const row of list){if(seen.has(row.module))throw bad();seen.add(row.module);}
 // The original presents every module, including genuinely empty modules.
 if(seen.size!==RESULT_MODULES.length)throw bad();
 return RESULT_MODULES.map(module=>list.find(x=>x.module===module));
}
export function validateCentreStatistics(d){
 if(!isObj(d))throw bad();const summary=validateSummary(d.summary);
 const selected=d.selected==null?null:moduleValue(d.selected);
 const daily=arr(d.daily,14).map(row=>{
  if(!isObj(row)||typeof row.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||Number.isNaN(Date.parse(row.day+'T00:00:00Z')))throw bad();
  return {day:row.day,count:count(row.count)};
 });
 if(new Set(daily.map(x=>x.day)).size!==daily.length)throw bad();
 const students=arr(d.students,100).map(x=>{
  if(!isObj(x)||!UUID.test(x.id))throw bad();const started=count(x.started),completed=count(x.completed);if(completed>started)throw bad();
  return {id:x.id,name:str(x.name,{max:300}),started,completed,accuracy:nullableNumber(x.accuracy),band:nullableNumber(x.band,0,9)};
 });
 const levels=arr(d.levels??[],30).map(x=>{if(!isObj(x))throw bad();return {level:str(x.level,{max:100}),rounds:count(x.rounds),average:nullableNumber(x.average)};});
 return {summary,selected,daily,students,levels};
}
export function validateResultHistory(d){
 if(!isObj(d))throw bad();const module=d.module==null?null:moduleValue(d.module);const total=count(d.total),pages=int(d.pages,{min:1}),page=int(d.page,{min:1});
 if(page>pages||pages!==Math.max(1,Math.ceil(total/25)))throw bad();
 const rows=arr(d.rows,25).map(x=>{
  if(!isObj(x)||!UUID.test(x.id))throw bad();const m=moduleValue(x.module),at=optionalDate(x.at),completed=bool(x.completed),score=nullableNumber(x.score,0,100000),maximum=nullableNumber(x.maximum,0,100000),unit=str(x.unit,{max:40});
  if(module&&m!==module)throw bad();
  if(unit==='band'&&(score!=null&&score>9||maximum!=null&&maximum>9))throw bad();
  return {id:x.id,module:m,activity:str(x.activity,{max:100}),at,completed,score,maximum,unit,title:x.title==null?null:str(x.title,{max:300})};
 });
 return {module,total,pages,page,rows};
}
export const centreStatistics=(selected,signal)=>staffData('centre-statistics',selected?{module:selected}:{},signal).then(validateCentreStatistics);
export const learningHistory=(id,selected,page,signal)=>{if(!UUID.test(id))return Promise.reject(bad());return staffData('student-learning',{id,...selected?{module:selected}:{},page},signal).then(d=>{
 if(!isObj(d))throw bad();return {summary:validateSummary(d.summary),history:validateResultHistory(d.history)};
 });};
