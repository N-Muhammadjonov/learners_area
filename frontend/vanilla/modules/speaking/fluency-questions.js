import {api} from '../../js/api-client.js';
/** Read a bounded, authorized existing bank. No generated or bundled questions. */
export function createQuestionPicker(){
 // Remember recent questions across route remounts in this browser tab.
 // Keep the history bounded so a small, authorized bank never becomes unusable.
 const HISTORY_KEY='la-speak-or-die-recent-v2',HISTORY_LIMIT=300;
 let pool=[],loadedLevel=null;
 function recentIds(){
  try{
   const saved=JSON.parse(globalThis.sessionStorage?.getItem(HISTORY_KEY)??'[]');
   return Array.isArray(saved)?saved.filter(id=>typeof id==='string').slice(-HISTORY_LIMIT):[];
  }catch{return [];}
 }
 function remember(id){
  try{
   const previous=recentIds().filter(item=>item!==id);
   globalThis.sessionStorage?.setItem(HISTORY_KEY,JSON.stringify([...previous,id].slice(-HISTORY_LIMIT)));
  }catch{}
 }
 return {async next(signal,{level='intermediate'}={}){
  if(!['beginner','intermediate','advanced'].includes(level))throw Object.assign(Error('invalid_level'),{code:'invalid_level'});
  if(loadedLevel!==level){pool=[];loadedLevel=level;}
  if(!pool.length){
   const query=new URLSearchParams({level,exclude:recentIds().slice(-80).join(',')});
   const data=await api.request('/api/speaking/fluency/session?'+query,{signal,timeoutMs:12000,fresh:true});
   if(data.level!==level||!Array.isArray(data.questions)||data.questions.length>100)throw Object.assign(Error('question_unavailable'),{code:'question_unavailable'});
   pool=data.questions.filter(q=>typeof q.id==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(q.id)&&['part1','part2','part3'].includes(q.part)&&q.difficulty===level&&typeof q.topic==='string'&&typeof q.promptText==='string'&&q.promptText.trim().length>=5&&q.promptText.length<=4000)
    .map(q=>({...q,cueCard:typeof q.cueCard==='string'?q.cueCard.slice(0,8000):null}));
   if(pool.length!==data.questions.length)throw Object.assign(Error('question_unavailable'),{code:'question_unavailable'});
  }
  if(!pool.length)throw Object.assign(Error('question_empty'),{code:'question_empty'});
  const question=pool.shift();remember(question.id);return {...question};
 }};
}
