import {api} from '../../js/api-client.js';
/** Read a bounded, authorized existing bank. No generated or bundled questions. */
export function createQuestionPicker(){
 // Remember recent questions across route remounts in this browser tab.
 // Keep the history bounded so a small, authorized bank never becomes unusable.
 const HISTORY_KEY='la-speak-or-die-recent-v2',HISTORY_LIMIT=300;
 let pool=[],seen=new Set(),lastId=null;
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
 return {async next(signal){
  if(!pool.length){
   for(const part of ['part3','part2','part1']){
    const data=await api.request('/api/speaking/practice/questions?'+new URLSearchParams({part,channel:'practice_alone'}),{signal,timeoutMs:12000,fresh:true});
    if(!Array.isArray(data.prompts)||data.prompts.length>100)throw Object.assign(Error('question_unavailable'),{code:'question_unavailable'});
    pool=data.prompts.filter(q=>typeof q.id==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(q.id)&&q.part===part&&typeof q.promptText==='string'&&q.promptText.trim().length>=15&&q.promptText.length<=4000)
     .map(q=>({id:q.id,part:q.part,promptText:q.promptText,cueCard:typeof q.cueCard==='string'?q.cueCard.slice(0,8000):null}));
    if(pool.length)break;
   }
  }
  if(!pool.length)throw Object.assign(Error('question_empty'),{code:'question_empty'});
  const history=new Set(recentIds());
  let choices=pool.filter(q=>!seen.has(q.id)&&!history.has(q.id)&&q.id!==lastId);
  if(!choices.length)choices=pool.filter(q=>!seen.has(q.id)&&q.id!==lastId);
  if(!choices.length){seen.clear();choices=pool.filter(q=>q.id!==lastId);}
  if(!choices.length)choices=[pool[0]];
  const index=Math.floor(Math.random()*choices.length);
  const question=choices[index];
  seen.add(question.id);lastId=question.id;remember(question.id);
  return {...question};
 }};

}
