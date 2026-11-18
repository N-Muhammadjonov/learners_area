import {api} from '../../js/api-client.js';

const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const pick=items=>items[Math.floor(Math.random()*items.length)];
const bankError=code=>Object.assign(Error(code),{code});

/** Fetch only the selected part. A topic can span several catalogue pages. */
async function loadQuestions(part,signal){
 const params=new URLSearchParams({part,channel:'practice_alone'});
 const questions=new Map(),cursors=new Set();
 for(;;){
  const page=await api.request('/api/speaking/practice/questions?'+params,{signal,timeoutMs:12000,fresh:true});
  signal?.throwIfAborted();
  if(!Array.isArray(page.prompts)||page.prompts.length>100)throw bankError('question_unavailable');
  for(const row of page.prompts){
   if(!UUID.test(row?.id)||row.part!==part||typeof row.promptText!=='string')continue;
   const promptText=row.promptText.trim();
   if(!promptText||promptText.length>4000)continue;
   const topic=typeof row.topic==='string'?row.topic.trim():'';
   questions.set(row.id,{id:row.id,part,topic,topicKey:topic.toLowerCase(),promptText,
    cueCard:typeof row.cueCard==='string'?row.cueCard.slice(0,8000):null});
  }
  if(!page.hasMore)break;
  if(typeof page.nextCursor!=='string'||!page.nextCursor||cursors.has(page.nextCursor))throw bankError('question_unavailable');
  cursors.add(page.nextCursor);
  params.set('cursor',page.nextCursor);
 }
 if(!questions.size)throw bankError('question_empty');
 return questions;
}

/** Each part keeps its own cycle, including when a learner remounts this route. */
export function createQuestionPicker(userId=''){
 const banks=new Map(),histories=new Map();
 const key=part=>'la-fluency-cycle-v3:'+userId+':'+part;
 function readHistory(part){
  if(histories.has(part))return histories.get(part);
  try{
   const saved=JSON.parse(window.sessionStorage.getItem(key(part)));
   if(Array.isArray(saved))return saved.filter(id=>typeof id==='string');
  }catch{}
  return [];
 }

 return {async next(part,signal){
  let bank=banks.get(part);
  if(!bank){
   bank=await loadQuestions(part,signal);
   banks.set(part,bank);
  }
  signal?.throwIfAborted();
  const history=new Set(readHistory(part).filter(id=>bank.has(id)));
  const previous=bank.get([...history].at(-1));
  let choices=[...bank.values()].filter(row=>!history.has(row.id));
  const newCycle=!choices.length;
  if(newCycle){
   history.clear();
   choices=[...bank.values()];
  }

  if(part!=='part2'){
   let topics=[...new Set(choices.map(row=>row.topicKey))];
   if(newCycle&&previous&&topics.length>1)topics=topics.filter(topic=>topic!==previous.topicKey);
   const topic=!newCycle&&previous&&topics.includes(previous.topicKey)?previous.topicKey:pick(topics);
   choices=choices.filter(row=>row.topicKey===topic);
  }
  if(newCycle&&previous&&choices.length>1)choices=choices.filter(row=>row.id!==previous.id);
  const question=pick(choices);
  history.add(question.id);
  const ids=[...history];
  histories.set(part,ids);
  try{window.sessionStorage.setItem(key(part),JSON.stringify(ids));}catch{}
  return question;
 }};
}
