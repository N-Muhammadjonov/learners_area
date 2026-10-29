function microphoneIcon(){const span=document.createElement('span');span.className='practice-part-mic';span.setAttribute('aria-hidden','true');const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');for(const [k,v]of Object.entries({width:'32',height:'32',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2'}))svg.setAttribute(k,v);for(const [tag,attrs]of [['rect',{x:9,y:2,width:6,height:12,rx:3}],['path',{d:'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3'}]]){const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,String(v));svg.append(node);}span.append(svg);return span;}
import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {localAnswerRecorder} from './recorder.js';
import {studyRich} from './study-rich.js';
import {vocabularySaver} from './vocabulary-save.js';
import {BackLink} from '../shared/presentation.js';
import {mountSituations,situationTopics,situationLabels} from './situations.js';
/** Source: SpeakingPracticePage + PracticeStudio. Uses bounded original GET endpoints,
 * never loads or constructs the complete question bank in the browser. */
const PARTS=['part1','part2','part3'];
const partFrom=p=>PARTS.includes(p)?p:null;
const urlFor=(part,topic)=>'/app/speaking/practice'+(part?'?'+new URLSearchParams({part,...(topic?{topic}:{})}):'');
function button(label,fn,attrs={}){const b=el('button',{type:'button',...attrs},label);b.addEventListener('click',fn);return b;}
function reportError(host,dict,retry,label){host.replaceChildren(el('p',{class:'text-sm text-ink-500',role:'alert'},dict.common.error,' ',button(dict.errorPage.retry,retry,{class:'min-h-11 rounded-md underline','data-practice-retry':label})));}
export function mount(context){
 if(context.url.searchParams.get('part')==='situations')return mountSituations(context);
 const {root,url,dict,signal,navigate}=context,t=dict.speakingPractice,study=dict.speakingStudy;
 const host=el('div',{class:'mx-auto flex max-w-7xl flex-col gap-6','data-route-usable':'speaking-practice'}),studio=el('div',{class:'flex flex-col gap-5'});
 root.append(host);
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),el('header',{},el('h1',{class:'font-display text-2xl text-ink-900'},dict.speakingHub.cards.practice.title),el('p',{class:'mt-1 text-base text-ink-500'},t.intro)),studio);
 const part=partFrom(url.searchParams.get('part')),topicKey=part?url.searchParams.get('topic'):null;
 const state={search:'',debounce:0,topics:[],topicCursor:null,topicCount:0,topicBusy:false,prompts:[],promptCursor:null,promptCount:0,promptBusy:false,selected:null,support:null,supportId:null,recorder:null,token:0,blocked:false};
 let supportController=null;
 signal.addEventListener('abort',()=>{clearTimeout(state.debounce);supportController?.abort();state.recorder?.stop();state.token++;},{once:true});
 const go=(p,key)=>{if(state.blocked||signal.aborted)return;void navigate(urlFor(p,key));};
 const msg=el('p',{role:'status','aria-live':'polite',class:'sr-only','data-practice-status':''});
 const breadcrumb=el('nav',{'aria-label':t.stepsLabel,class:'flex flex-wrap items-center gap-2 text-sm text-ink-500'});
 const body=el('div',{});studio.append(msg,breadcrumb,body);
 breadcrumb.append(button(t.choosePart,()=>go(null,null),{class:'min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50','data-practice-crumb':'part'}));
 if(part)breadcrumb.append(el('span',{'aria-hidden':'true'},'›'),button(t.part[part],()=>go(part,null),{class:'min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50','data-practice-crumb':'topic'}));
 function showPart(){
  studio.dataset.practiceStep='part';msg.textContent=t.choosePart;
  const list=el('div',{class:'motion-enter-stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4','data-practice-parts':''});
  for(const [i,p] of PARTS.entries()){
   list.append(button('',()=>go(p,null),{class:'practice-part-card motion-lift relative flex min-h-64 flex-col items-start gap-3 overflow-hidden rounded-3xl border p-6 text-left disabled:cursor-not-allowed disabled:opacity-50','data-practice-part':p}));
   list.lastChild.append(el('span',{'aria-hidden':'true',class:'practice-part-number'},String(i+1)),microphoneIcon(),el('span',{class:'practice-part-label text-sm font-bold uppercase tracking-widest'},t.part[p]),el('span',{class:'relative font-display text-3xl font-bold text-ink-900'},t.partTitle[p]),el('span',{class:'relative text-base text-ink-500'},t.partBody[p]),el('span',{class:'mt-auto text-xs text-ink-500','data-practice-part-count':p},dict.common.loading));
  }
  const s=situationLabels(context.locale),count=situationTopics.reduce((n,topic)=>n+topic.count,0);
  const situations=button('',()=>go('situations',null),{class:'practice-part-card motion-lift relative flex min-h-64 flex-col items-start gap-3 overflow-hidden rounded-3xl border p-6 text-left','data-practice-part':'situations'});
  situations.append(el('span',{'aria-hidden':'true',class:'practice-part-number'},'4'),microphoneIcon(),el('span',{class:'practice-part-label text-sm font-bold uppercase tracking-widest'},s.pictures),el('span',{class:'relative font-display text-3xl font-bold text-ink-900'},'Explain situations'),el('span',{class:'relative text-base text-ink-500'},s.intro),el('span',{class:'mt-auto text-xs text-ink-500'},s.count(count)));
  list.append(situations);
  body.replaceChildren(list);
  const token=++state.token;
  api.request('/api/speaking/practice/facets?channel=practice_alone',{signal}).then(d=>{if(signal.aborted||token!==state.token)return;for(const row of d.parts??[]){const label=list.querySelector(`[data-practice-part-count="${row.part}"]`);if(label)label.textContent=t.questionCount.replace('{n}',String(row.count));}},()=>{if(!signal.aborted&&token===state.token){for(const label of list.querySelectorAll('[data-practice-part-count]'))label.textContent='—';const error=el('div',{});body.append(error);reportError(error,dict,showPart,'parts');}});
 }
 async function topicsLoad(more=false){
  if((more&&state.topicBusy)||signal.aborted)return;state.topicBusy=true;
  const token=++state.token,q=new URLSearchParams({channel:'practice_alone',part,...(state.search.trim()?{q:state.search.trim().slice(0,120)}:{}),...(more&&state.topicCursor?{topicCursor:state.topicCursor}:{})});
  if(!more)state.topics=[];
  try{const d=await api.request('/api/speaking/practice/facets?'+q,{signal});if(signal.aborted||token!==state.token)return;
   const seen=new Set(state.topics.map(r=>r.key));state.topics.push(...(d.topics??[]).filter(r=>!seen.has(r.key)));state.topicCursor=d.nextTopicCursor??null;state.topicCount=d.topicCount??state.topics.length;drawTopics();
  }catch{if(!signal.aborted&&token===state.token){drawTopics();reportError(body.querySelector('[data-practice-topic-results]'),dict,()=>void topicsLoad(more),'topics');}}
  finally{if(token===state.token)state.topicBusy=false;}
 }
 function drawTopics(){
  studio.dataset.practiceStep='topic';msg.textContent=`${t.part[part]} — ${t.topicCount.replace('{n}',String(state.topics.length))}`;
  let results=body.querySelector('[data-practice-topic-results]');
  if(!results){
   const area=el('div',{class:'space-y-4'}),input=el('input',{class:'input',type:'search','aria-label':study.searchTopics,placeholder:study.searchTopics,value:state.search,'data-practice-search':''});
   results=el('div',{class:'space-y-4','data-practice-topic-results':''});
   listen(input,'input',()=>{state.search=input.value;state.token++;state.topicBusy=false;clearTimeout(state.debounce);state.debounce=setTimeout(()=>void topicsLoad(false),250);},signal);
   area.append(input,results);body.replaceChildren(area);
  }
  results.replaceChildren();
  if(!state.topics.length)results.append(el('p',{class:'text-sm text-ink-500','data-practice-empty':'topics'},state.search.trim()?dict.shell.noResults:t.noQuestionsInPart));
  const list=el('ul',{class:'grid gap-3 sm:grid-cols-2','data-practice-topics':''});
  for(const g of state.topics)list.append(el('li',{},button('',()=>go(part,g.key),{class:'card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-paper-sunken','data-practice-topic':g.key})));
  for(const li of list.children){const g=state.topics[[...list.children].indexOf(li)];li.firstChild.append(el('span',{class:'text-base text-ink-900'},g.title??t.untitledTopic),el('span',{class:'shrink-0 text-xs text-ink-500'},t.questionCount.replace('{n}',String(g.count))));}
  results.append(list);
  if(state.topicCursor)results.append(button(`${dict.common.continue} · ${t.topicCount.replace('{n}',String(Math.max(state.topicCount-state.topics.length,0)))}`,()=>void topicsLoad(true),{class:'btn-secondary min-h-11','data-practice-more-topics':''}));
 }
 async function promptsLoad(more=false){
  if(state.promptBusy||signal.aborted)return;state.promptBusy=true;
  const token=++state.token,q=new URLSearchParams({channel:'practice_alone',part,topic:topicKey,...(more&&state.promptCursor?{cursor:state.promptCursor}:{})});
  if(!more){state.prompts=[];body.replaceChildren(el('p',{'data-practice-loading':'questions',class:'text-sm text-ink-500'},dict.common.loading));}
  try{const d=await api.request('/api/speaking/practice/questions?'+q,{signal});if(signal.aborted||token!==state.token)return;
   const seen=new Set(state.prompts.map(r=>r.id));state.prompts.push(...(d.prompts??[]).filter(r=>!seen.has(r.id)));state.promptCursor=d.nextCursor??null;state.promptCount=d.matching??state.prompts.length;
   if(!state.selected)state.selected=state.prompts.find(p=>p.id===url.searchParams.get('promptId'))?.id??state.prompts[0]?.id??null;drawQuestions();
  }catch{if(!signal.aborted&&token===state.token)reportError(body,dict,()=>void promptsLoad(more),'questions');}
  finally{state.promptBusy=false;}
 }
 async function supportLoad(id){
  supportController?.abort();
  const token=++state.token;state.support=null;state.supportId=null;const target=body.querySelector('[data-practice-support-column]');if(target)target.replaceChildren(el('p',{'data-practice-support':'loading'},dict.common.loading));
  try{const d=await api.request(`/api/speaking/prompts/${encodeURIComponent(id)}/support?channel=practice_alone`,{signal});if(signal.aborted||token!==state.token||id!==state.selected)return;
   if(d.promptId!==id||!d.support)throw Error('invalid_support');state.support=d.support;state.supportId=id;drawSupport();const related=body.querySelector('[data-practice-related-part3-host]');if(related&&part==='part2'&&d.relatedPart3?.promptId&&d.relatedPart3?.topicKey){const target=d.relatedPart3;related.replaceChildren(button('Part 3 →',()=>{if(!state.blocked&&!signal.aborted)void navigate('/app/speaking/practice?'+new URLSearchParams({part:'part3',topic:target.topicKey,promptId:target.promptId}));},{class:'btn-primary min-h-11','data-practice-related-part3':''}));}
  }catch{if(signal.aborted||token!==state.token)return;const panel=body.querySelector('[data-practice-support-column]');if(panel)reportError(panel,dict,()=>void supportLoad(id),'support');}
 }
 function drawQuestions(){
  studio.dataset.practiceStep='questions';msg.textContent=t.questionCount.replace('{n}',String(state.promptCount));
  state.recorder?.stop();state.recorder=null;
  const columns=el('div',{class:'grid min-w-0 items-start gap-5 lg:grid-cols-2','data-practice-questions':topicKey??''});
  const left=el('section',{class:'card min-w-0 space-y-4 p-5 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto','data-practice-question-column':''},el('h2',{class:'font-display text-xl'},part==='part2'?study.yourCue:study.questions));
  const list=el('ol',{class:'space-y-3'});
  for(const [i,p] of state.prompts.entries()){
   const selected=p.id===state.selected;
   const entry=el('li',{class:'space-y-3 py-3','data-practice-question-entry':'','data-selected':String(selected)},button(`${i+1}. ${p.promptText}`,()=>{if(state.blocked||p.id===state.selected)return;state.selected=p.id;drawQuestions();}, {class:'w-full text-left text-lg font-semibold','data-practice-question':p.id,...(state.blocked&&!selected?{disabled:''}:{})}));
   if(selected){if(p.cueCard)entry.append(el('p',{class:'mt-3 whitespace-pre-wrap text-ink-500'},p.cueCard));if(part==='part2')entry.append(el('p',{class:'mt-3 text-sm'},`${study.prepare} 1:00 · ${study.talk} 2:00`));state.recorder=localAnswerRecorder(context,{id:p.id,part:p.part,lock:(id,action)=>{if(action==='isLocked')return state.blocked&&state.selected!==id;state.blocked=action;}});entry.append(state.recorder.node,...(part==='part2'?[el('div',{'data-practice-related-part3-host':''})]:[]));}
   list.append(entry);
  }
  left.append(list);
  if(state.promptCursor)left.append(button(`${dict.common.continue} · ${t.questionCount.replace('{n}',String(Math.max(state.promptCount-state.prompts.length,0)))}`,()=>void promptsLoad(true),{class:'btn-secondary min-h-11','data-practice-more-questions':''}));
  const right=el('div',{class:'min-w-0 space-y-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto','data-practice-support-column':''});
  columns.append(left,right);body.replaceChildren(columns);
  if(state.selected)void supportLoad(state.selected);
 }
 function drawSupport(){
  const target=body.querySelector('[data-practice-support-column]');if(!target||!state.support||state.supportId!==state.selected)return;
  const support=state.support,t=study;
  const panel=el('section',{class:'card relative min-h-96 space-y-5 p-5','data-study-support':''});
  const tabs=el('div',{role:'tablist','aria-label':t.supportLabel,class:'flex flex-wrap gap-2'}),content=el('div',{role:'tabpanel',class:'space-y-4'});
  let tab='vocabulary';const revealed=new Set(),activated=new Set();supportController?.abort();supportController=new window.AbortController();const supportSignal=supportController.signal;let renderController=null;
  supportSignal.addEventListener('abort',()=>renderController?.abort(),{once:true});
  function startTabHold(control,name,events){
   let holdTimer=null;
   const clear=()=>{clearTimeout(holdTimer);holdTimer=null;};
   control.addEventListener('pointerdown',e=>{if(e.button!==0||revealed.has(name))return;clear();holdTimer=setTimeout(()=>{holdTimer=null;if(signal.aborted||events.aborted)return;tab=name;revealed.add(name);activated.add(name);show();},3000);},{signal:events});
   for(const event of ['pointerup','pointercancel','pointerleave'])control.addEventListener(event,clear,{signal:events});
   control.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat&&!revealed.has(name)){clear();holdTimer=setTimeout(()=>{holdTimer=null;if(signal.aborted||events.aborted)return;tab=name;revealed.add(name);activated.add(name);show();},3000);}},{signal:events});
   control.addEventListener('keyup',clear,{signal:events});events.addEventListener('abort',clear,{once:true});
  }
  function show(){renderController?.abort();if(signal.aborted||supportSignal.aborted)return;renderController=new window.AbortController();const events=renderController.signal;tabs.replaceChildren();for(const [name,label] of [['vocabulary',t.vocabulary],['modelAnswer',t.modelAnswer],['ideas',t.ideas]]){const control=button(label,()=>{tab=name;activated.add(name);show();},{class:tab===name&&(activated.has(name)||revealed.has(name))?'btn-primary':'btn-secondary',role:'tab','aria-selected':String(tab===name),'data-practice-support-tab':name});startTabHold(control,name,events);tabs.append(control);}
   content.replaceChildren();
   if(!revealed.has(tab)){const trigger=button('',()=>{}, {class:'situation-reveal rounded-3xl border-2 border-accent-500 bg-paper p-8 text-center text-xl font-semibold select-none','data-practice-reveal':tab});
    trigger.append(el('span',{class:'block text-sm uppercase tracking-widest'},t.answerFirst),el('span',{class:'mt-3 block'},t.hold));
    let timer=null;const clear=()=>{clearTimeout(timer);timer=null;};
    const hold=()=>{if(timer||revealed.has(tab))return;const heldTab=tab;timer=setTimeout(()=>{timer=null;if(signal.aborted||events.aborted||heldTab!==tab)return;revealed.add(heldTab);show();},3000);};
    trigger.addEventListener('pointerdown',e=>{if(e.button!==0)return;try{trigger.setPointerCapture(e.pointerId);}catch{}hold();},{signal:events});
    trigger.addEventListener('pointerup',clear,{signal:events});
    trigger.addEventListener('pointercancel',clear,{signal:events});
    trigger.addEventListener('lostpointercapture',clear,{signal:events});
    trigger.addEventListener('blur',clear,{signal:events});
    trigger.addEventListener('contextmenu',e=>e.preventDefault(),{signal:events});
    trigger.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();hold();}},{signal:events});
    trigger.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();clear();}},{signal:events});
    listen(document,'visibilitychange',()=>{if(document.hidden)clear();},events);
    events.addEventListener('abort',clear,{once:true});
    content.append(el('div',{class:'flex min-h-72 items-center justify-center'},trigger));return;
   }
   content.append(button(context.locale==='uz'?'Yopish':'Close',()=>{revealed.delete(tab);show();},{class:'btn-secondary','data-practice-support-close':tab,'aria-label':context.locale==='uz'?'Bo‘limni yopish':'Close section'}));
   const html=tab==='vocabulary'?support.vocabularyHtml:tab==='modelAnswer'?support.modelAnswerHtml:support.ideasHtml;
   if(html)content.append(studyRich(html));
   if(tab==='vocabulary'&&Array.isArray(support.vocabulary)&&support.vocabulary.length){
    content.append(vocabularySaver({...context,signal:events},{promptId:state.selected,words:support.vocabulary,copy:t}));
   }
  }
  panel.append(tabs,content);target.replaceChildren(panel);show();
 }
 if(!part)return showPart();
 if(!topicKey){studio.dataset.practiceStep='topic';body.replaceChildren(el('p',{'data-practice-loading':'topics'},dict.common.loading));void topicsLoad();return;}
 studio.dataset.practiceStep='questions';void promptsLoad();
}
