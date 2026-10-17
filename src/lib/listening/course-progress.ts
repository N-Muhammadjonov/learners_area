import specifications from './original-listening-course.json';

/** Reserved server-owned checkpoint entry. Runtime storage writes cannot change it. */
export const COURSE_PROGRESS_KEY='la-course-progress-v1';
export type CourseSpec={version:string;activities:Record<string,{units:string[];minimum:number;choices?:Record<string,number>}>};
export type CourseWork={version:string;exam:boolean;retry:string[];units:Record<string,string[]>};
export type CourseStatus={complete:boolean;completed:number;total:number;activities:Record<string,{done:number;total:number;complete:boolean;available:boolean}>};
export function sequentialLocks(items:{complete:boolean}[]):boolean[]{let previousComplete=true;return items.map(item=>{const locked=!previousComplete;previousComplete=previousComplete&&item.complete;return locked;});}
export function originalCourseSpec(sourceId:string):CourseSpec|null {
 return Object.hasOwn(specifications,sourceId)?(specifications as Record<string,CourseSpec>)[sourceId]!:null;
}
export function readCourseWork(values:Record<string,string>,spec:CourseSpec):CourseWork {
 try{const value=JSON.parse(values[COURSE_PROGRESS_KEY]??'null');
  if(value?.version===spec.version&&typeof value.exam==='boolean'&&Array.isArray(value.retry)&&value.units&&typeof value.units==='object')return value;
 }catch{}
 return {version:spec.version,exam:false,retry:[],units:{}};
}
/** Existing submitted canonical exams still count when the new course tracking starts. */
export function savedCourseStatus(sourceId:string,raw:string|null,examSubmitted:boolean,runtime:string|null):CourseStatus|null{
 const spec=originalCourseSpec(sourceId);if(!spec)return null;
 let work=readCourseWork({[COURSE_PROGRESS_KEY]:raw??''},spec);
 if(!work.exam&&examSubmitted){try{const state=JSON.parse(runtime??'{}');if(state.attemptStatus==='submitted'&&Array.isArray(state.lastResults)&&state.lastResults.length===40)work={...work,exam:true,retry:state.lastResults.filter((row:{ok:boolean})=>!row.ok).map((row:{q:number})=>String(row.q))};}catch{}}
 return courseStatus(spec,work);
}
export function courseStatus(spec:CourseSpec,work:CourseWork):CourseStatus {
 const activities:CourseStatus['activities']={};
 for(const [key,required]of Object.entries(spec.activities)){
  const units=key==='retry'?(work.exam?work.retry:required.units):required.units;
  const total=key==='retry'?units.length:required.minimum;
  const submitted=new Set(work.units[key]??[]);
  const done=key==='exam'?(work.exam?total:0):Math.min(total,units.filter(id=>submitted.has(id)).length);
  activities[key]={done,total,complete:key==='retry'?!work.exam?false:done===total:done===total,available:total>0};
 }
 const completed=Object.values(activities).filter(a=>a.available&&a.complete).length;
 const total=Object.values(activities).filter(a=>a.available).length;
 return {activities,completed,total,complete:Object.values(activities).every(a=>a.complete)&&work.exam};
}
export function mergeCourseAnswers(spec:CourseSpec,work:CourseWork,activity:string,answers:Record<string,string>):CourseWork {
 const expected=spec.activities[activity];
 if(!expected||activity==='exam')throw Error('invalid_activity');
 const ids=activity==='retry'?(work.exam?work.retry:expected.units):expected.units;
 const entries=Object.entries(answers);
 if(activity==='multi'&&entries.some(([key,value])=>new Set(value.split(',').map(v=>v.trim()).filter(Boolean)).size!==(expected.choices?.[key]??2)))throw Error('invalid_answers');
 if(!entries.length||entries.some(([key,value])=>!ids.includes(key)||typeof value!=='string'||!value.trim()||value.length>4000))throw Error('invalid_answers');
 return {...work,units:{...work.units,[activity]:[...new Set([...(work.units[activity]??[]),...entries.map(([key])=>key)])]}};
}
