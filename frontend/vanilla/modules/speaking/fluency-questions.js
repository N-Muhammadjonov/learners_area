import {api} from '../../js/api-client.js';
/** Read a bounded, authorized existing bank. No generated or bundled questions. */
export function createQuestionPicker(){
 let pool=[],seen=new Set(),lastId=null;
 return {async next(signal){
  if(!pool.length){
   for(const part of ['part3','part2','part1']){
    const data=await api.request('/api/speaking/practice/questions?'+new URLSearchParams({part,channel:'practice_alone'}),{signal,timeoutMs:12000,fresh:true});
    if(!Array.isArray(data.prompts)||data.prompts.length>100)throw Object.assign(Error('question_unavailable'),{code:'question_unavailable'});
    pool=data.prompts.filter(q=>typeof q.id==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(q.id)&&q.part===part&&typeof q.promptText==='string'&&q.promptText.trim().length>=15&&q.promptText.length<=4000)
     .map(q=>({id:q.id,part:q.part,promptText:q.promptText,cueCard:typeof q.cueCard==='string'?q.cueCard.slice(0,8000):null}))
     .sort((a,b)=>Number(/^(how|why|what|describe|explain)/i.test(b.promptText))-Number(/^(how|why|what|describe|explain)/i.test(a.promptText)));
    if(pool.length)break;
   }
  }
  if(!pool.length)throw Object.assign(Error('question_empty'),{code:'question_empty'});
  if(pool.every(q=>seen.has(q.id)))seen.clear();
  const question=pool.find(q=>!seen.has(q.id)&&q.id!==lastId)??pool.find(q=>q.id!==lastId)??pool[0];
  seen.add(question.id);lastId=question.id;return {...question};
 }};
}
