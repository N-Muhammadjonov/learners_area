import {el,listen} from '../../js/dom.js';
import {BackLink} from '../shared/presentation.js';
import {localAnswerRecorder} from './recorder.js';

// New owner-supplied topics can be added here without changing IELTS part IDs.
// Load the selected topic only; images are requested only for the selected story.
export const situationTopics=[{id:'shopping',title:'SHOPPING',count:16,load:()=>import('./situations-shopping.js')}];
export const situationLabels=locale=>locale==='uz'?{
 pictures:'Rasmli hikoyalar',intro:'Rasmdagi vaziyatni tushuntiring va javobingizni yozib oling.',
 count:n=>`${n} ta rasmli hikoya`,choose:'Hikoyani tanlang',story:n=>`Hikoya ${n}`,
 hold:'Vocabulary va Sample answer uchun 3 soniya ushlab turing',holding:'Ushlab turing…',
 frames:'1 dan 4 gacha rasmlar bo‘yicha hikoya qiling.',missing:'Bu mavzu topilmadi.',
 imageError:'Rasm yuklanmadi. Qayta yuklab ko‘ring.',retry:'Rasmni qayta yuklash'
}:{
 pictures:'Picture stories',intro:'Explain the situation in the pictures and record your answer.',
 count:n=>`${n} picture stories`,choose:'Choose a story',story:n=>`Story ${n}`,
 hold:'Hold for 3 seconds to see Vocabulary and Sample answer',holding:'Keep holding…',
 frames:'Follow the story from picture 1 to 4.',missing:'This topic was not found.',
 imageError:'The picture could not load. Please try again.',retry:'Reload picture'
};
const href=topic=>'/app/speaking/practice?'+new URLSearchParams({part:'situations',...(topic?{topic}:{})});
function button(label,fn,attrs={}){const b=el('button',{type:'button',...attrs},label);b.addEventListener('click',fn);return b;}

/** Same continuous three-second reveal as the IELTS parts. Every new story starts
 * locked. Switching tabs, releasing, hiding the page or leaving cancels a hold. */
export function createSituationSupport({story,dict,locale,signal}){
 const t=situationLabels(locale),study=dict.speakingStudy;
 const panel=el('section',{class:'card relative min-h-96 space-y-5 p-5','data-study-support':'','data-situation-support':story.id});
 const tabs=el('div',{role:'tablist','aria-label':study.supportLabel,class:'flex flex-wrap gap-2'});
 const content=el('div',{role:'tabpanel',class:'space-y-4',id:`${story.id}-support-content`});
 let tab='vocabulary',revealed=false,renderController=null,timer=null;
 const clearHold=()=>{clearTimeout(timer);timer=null;};
 const destroy=()=>{clearHold();renderController?.abort();};
 signal.addEventListener('abort',destroy,{once:true});
 function show(){
  destroy();if(signal.aborted)return;renderController=new AbortController();const events=renderController.signal;
  tabs.replaceChildren();
  for(const [name,label] of [['vocabulary',study.vocabulary],['sample','Sample answer']]){
   const id=`${story.id}-support-${name}`;
   const b=button(label,()=>{tab=name;show();},{id,class:tab===name?'btn-primary':'btn-secondary',role:'tab','aria-selected':String(tab===name),'aria-controls':content.id,'data-situation-tab':name});
   listen(b,'keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();tab=e.key==='Home'?'vocabulary':e.key==='End'?'sample':tab==='vocabulary'?'sample':'vocabulary';show();tabs.querySelector('[aria-selected="true"]').focus();},events);
   b.tabIndex=tab===name?0:-1;tabs.append(b);
  }
  content.setAttribute('aria-labelledby',`${story.id}-support-${tab}`);content.replaceChildren();
  if(revealed){
   if(tab==='vocabulary'){
    const list=el('dl',{class:'space-y-3','data-situation-vocabulary':''});
    for(const word of story.vocabulary)list.append(el('div',{class:'space-y-1'},el('dt',{class:'font-semibold'},word.term),el('dd',{class:'text-ink-500'},word.translationUz)));
    content.append(list);
   }else for(const paragraph of story.sampleAnswer)content.append(el('p',{class:'text-base leading-relaxed','data-situation-sample':''},paragraph));
   return;
  }
  const hint=el('span',{class:'mt-3 block'},t.hold);
  const trigger=button('',()=>{},{class:'situation-reveal rounded-3xl border-2 border-accent-500 bg-paper p-8 text-center text-xl font-semibold select-none','data-situation-reveal':''});
  trigger.append(el('span',{class:'block text-sm uppercase tracking-widest'},study.answerFirst),hint);
  const clear=()=>{clearHold();hint.textContent=t.hold;};
  const hold=()=>{if(timer||revealed||signal.aborted)return;hint.textContent=t.holding;timer=setTimeout(()=>{timer=null;if(signal.aborted||events.aborted)return;revealed=true;show();},3000);};
  listen(trigger,'pointerdown',e=>{if(e.button!==0)return;try{trigger.setPointerCapture(e.pointerId);}catch{}hold();},events);
  for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])listen(trigger,event,clear,events);
  listen(trigger,'contextmenu',e=>e.preventDefault(),events);
  listen(trigger,'keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();hold();}},events);
  listen(trigger,'keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();clear();}},events);
  listen(document,'visibilitychange',()=>{if(document.hidden)clear();},events);
  events.addEventListener('abort',clearHold,{once:true});
  content.append(el('div',{class:'flex min-h-72 items-center justify-center'},trigger));
 }
 panel.append(tabs,content);show();return {node:panel,destroy};
}

export async function mountSituations(context){
 const {root,url,dict,signal,navigate,locale}=context,t=situationLabels(locale),practice=dict.speakingPractice;
 if(signal.aborted)return;
 const host=el('div',{class:'mx-auto flex max-w-7xl flex-col gap-6','data-route-usable':'speaking-practice','data-situations':''});
 const body=el('div',{class:'space-y-5'}),crumb=el('nav',{'aria-label':practice.stepsLabel,class:'flex flex-wrap items-center gap-2 text-sm text-ink-500'});
 let blocked=false,storyController=null,recorder=null;
 const go=path=>{if(!blocked&&!signal.aborted)void navigate(path);};
 const cleanupStory=()=>{storyController?.abort();recorder?.stop();recorder=null;};
 signal.addEventListener('abort',cleanupStory,{once:true});
 const part=button(practice.choosePart,()=>go('/app/speaking/practice'),{class:'min-h-11 rounded-md px-2','data-situation-back':'parts'});
 const topics=button('Explain situations',()=>go(href()),{class:'min-h-11 rounded-md px-2','data-situation-back':'topics'});
 crumb.append(part,el('span',{'aria-hidden':'true'},'›'),topics);
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),el('header',{},el('h1',{class:'font-display text-2xl text-ink-900'},dict.speakingHub.cards.practice.title),el('p',{class:'mt-1 text-base text-ink-500'},t.intro)),crumb,body);root.append(host);
 const topicId=url.searchParams.get('topic');
 if(!topicId){
  const list=el('ul',{class:'grid gap-3 sm:grid-cols-2','data-situation-topics':''});
  for(const topic of situationTopics)list.append(el('li',{},button('',()=>go(href(topic.id)),{class:'card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left','data-situation-topic':topic.id})));
  for(const [i,li] of [...list.children].entries())li.firstChild.append(el('span',{class:'text-base text-ink-900'},situationTopics[i].title),el('span',{class:'shrink-0 text-xs text-ink-500'},t.count(situationTopics[i].count)));
  body.append(el('h2',{class:'font-display text-xl'},'Explain situations'),list);return;
 }
 const topic=situationTopics.find(row=>row.id===topicId);
 if(!topic){body.append(el('p',{role:'alert'},t.missing));return;}
 crumb.append(el('span',{'aria-hidden':'true'},'›'),el('span',{'aria-current':'page'},topic.title));
 async function load(){
  body.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   const {default:data}=await topic.load();if(signal.aborted)return;
   const requested=url.searchParams.get('story'),initial=data.stories.find(row=>row.id===requested)??data.stories[0];
   const label=el('label',{class:'block space-y-2'},el('span',{class:'text-sm font-semibold'},t.choose));
   const select=el('select',{class:'input','data-situation-select':''});
   for(const story of data.stories)select.append(el('option',{value:story.id},`${t.story(story.number)} · ${story.title}`));
   select.value=initial.id;label.append(select);
   const stage=el('div',{class:'situation-columns grid min-w-0 items-start gap-5 lg:grid-cols-2','data-situation-columns':''});
   listen(select,'change',()=>{if(blocked){select.value=stage.dataset.story;return;}const next=data.stories.find(row=>row.id===select.value);if(next)showStory(next);},signal);
   body.replaceChildren(label,stage);showStory(initial);
   function showStory(story){
    cleanupStory();if(signal.aborted)return;storyController=new AbortController();stage.dataset.story=story.id;
    const left=el('section',{class:'card min-w-0 space-y-4 p-5','data-practice-question-column':'','data-situation-picture':''});
    const image=el('img',{src:story.image,alt:`${topic.title} · ${t.story(story.number)} · ${story.title}. ${t.frames}`,class:'situation-picture',width:story.imageWidth,height:story.imageHeight,decoding:'async'});
    const imageStatus=el('div',{role:'status',class:'space-y-2'});
    listen(image,'error',()=>{imageStatus.replaceChildren(el('p',{},t.imageError),button(t.retry,()=>{imageStatus.replaceChildren();image.src=story.image;},{class:'btn-secondary'}));},storyController.signal);
    listen(image,'load',()=>imageStatus.replaceChildren(),storyController.signal);
    left.append(el('h2',{class:'font-display text-xl'},`${t.story(story.number)} · ${story.title}`),el('p',{class:'text-sm text-ink-500'},story.instruction),image,imageStatus);
    recorder=localAnswerRecorder({...context,signal:storyController.signal},{id:story.id,part:'situation',answerSeconds:120,lock:(id,action)=>{
     if(action==='isLocked')return blocked;
     blocked=action;select.disabled=blocked;part.disabled=blocked;topics.disabled=blocked;
    }});
    left.append(recorder.node);
    const right=el('div',{class:'min-w-0 space-y-3','data-practice-support-column':''});
    right.append(createSituationSupport({story,dict,locale,signal:storyController.signal}).node);
    stage.replaceChildren(left,right);
   }
  }catch{if(signal.aborted)return;body.replaceChildren(el('p',{role:'alert'},dict.common.error),button(dict.errorPage.retry,()=>void load(),{class:'btn-secondary'}));}
 }
 await load();
}
