import {el,listen} from '../../js/dom.js';
import {BackLink} from '../shared/presentation.js';
import {createFluencyEngine,DIFFICULTIES} from './fluency-engine.js';
import {createEnergyDetector,createVoiceInput} from './voice-activity.js';
import {createQuestionPicker} from './fluency-questions.js';
import {fluencyArena} from './fluency-art.js';

/** Dependencies are injectable for deterministic DOM/audio lifecycle tests. */
export function mount(context,dependencies={}){
 const {root,dict,signal}=context,t=dict.fluencyGame,view=root.ownerDocument.defaultView;
 if(signal.aborted)return;
 if(!document.querySelector('link[data-fluency-css]'))document.head.append(el('link',{rel:'stylesheet',href:'/modules/speaking/fluency-game.css','data-fluency-css':''}));
 const now=dependencies.now??(()=>performance.now()),raf=dependencies.requestFrame??view.requestAnimationFrame.bind(view),cancel=dependencies.cancelFrame??view.cancelAnimationFrame.bind(view);
 const voiceFactory=dependencies.voiceFactory??createVoiceInput,picker=dependencies.questionPicker??createQuestionPicker(),engine=createFluencyEngine({now});
 let voice=null,detector=null,frame=null,epoch=0,roundController=null,question=null,lastFrame=null,pauseReason='',level='intermediate',presentation='';
 const host=el('section',{class:'fluency-game','data-route-usable':'speaking-fluency','data-fluency-state':'idle'});
 const intro=el('header',{class:'fluency-intro'},el('span',{class:'fluency-eyebrow'},t.eyebrow),el('h1',{},'Speak or Die'),el('p',{},t.intro),el('p',{class:'fluency-privacy'},t.privacy));
 const prompt=el('section',{class:'fluency-question',hidden:true},el('span',{class:'fluency-eyebrow'},t.question)),questionText=el('h2',{tabindex:'-1'}),cueCard=el('p',{class:'fluency-cue'});prompt.append(questionText,cueCard);
 const timer=el('div',{class:'fluency-timer',role:'timer','aria-live':'off','aria-label':t.timer}),seconds=el('strong',{},'60'),progress=el('progress',{max:60,value:60,'aria-label':t.timer});timer.append(el('div',{},seconds,el('span',{},t.sec)),progress);timer.hidden=true;
 const arena=fluencyArena(t.arena),status=el('p',{class:'fluency-status',role:'status','aria-live':'polite'}),levelLabel=el('p',{class:'fluency-level-label'});
 const levels=el('div',{class:'fluency-levels',role:'radiogroup','aria-label':t.chooseLevel}),levelButtons=[];
 function button(text,action,attrs={}){const node=el('button',{type:'button',class:'btn-secondary',...attrs},text);listen(node,'click',action,signal);return node;}
 function choose(next){if(!['idle','error'].includes(engine.snapshot().phase))return;stopResources();level=next;engine.reset(next);question=null;paint();}
 for(const [i,key] of Object.keys(DIFFICULTIES).entries()){
  const b=button('',()=>choose(key),{class:'fluency-level',role:'radio','data-fluency-level':key,'aria-checked':String(key===level)}),indicator=el('span',{class:'fluency-difficulty','aria-hidden':'true'});
  for(let j=0;j<3;j++)indicator.append(el('i',{'data-filled':String(j<=i)}));
  b.append(el('strong',{},t.levels[key].title),el('span',{},t.levels[key].body),indicator);levels.append(b);levelButtons.push(b);
 }
 listen(levels,'keydown',event=>{
  if(!['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(event.key))return;
  const current=levelButtons.findIndex(b=>b===document.activeElement);if(current<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(current+(['ArrowRight','ArrowDown'].includes(event.key)?1:2))%3;
  choose(levelButtons[next].dataset.fluencyLevel);levelButtons[next].focus();
 },signal);
 const resultTitle=el('h2',{tabindex:'-1'}),resultBody=el('p'),resultTime=el('p',{class:'fluency-result-time'}),result=el('section',{class:'fluency-result',hidden:true},resultTitle,resultBody,resultTime);
 const controls=el('div',{class:'fluency-controls'}),start=button(t.start,()=>void begin(),{class:'btn-primary fluency-start','data-fluency-start':''}),resume=button(t.resume,()=>void begin(),{class:'btn-primary','data-fluency-resume':''}),quit=button(t.quit,leaveRound,{'data-fluency-quit':''}),again=button(t.again,()=>void begin(),{class:'btn-primary','data-fluency-again':''}),change=button(t.changeLevel,leaveRound,{'data-fluency-change-level':''});
 controls.append(start,resume,quit,again,change);
 const mic=el('p',{class:'fluency-mic'}),limitation=el('p',{class:'fluency-limitation'},t.limitation);
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),intro,prompt,timer,arena.node,status,levelLabel,result,levels,controls,mic,limitation);root.append(host);
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 function paint(activity){
  if(signal.aborted)return;
  const state=engine.snapshot(),phase=state.phase,ended=['won','lost'].includes(phase),selecting=['idle','error'].includes(phase);
  text(seconds,String(Math.ceil(state.remainingMs/1000)));progress.value=state.remainingMs/1000;arena.paint(state,activity);
  const signature=JSON.stringify([phase,state.speaking,state.error,question?.id,level,pauseReason]);
  if(signature===presentation)return;presentation=signature;
  host.dataset.fluencyState=phase;intro.hidden=!selecting;levels.hidden=!selecting;prompt.hidden=!question;timer.hidden=selecting;
  if(question){text(questionText,question.promptText);text(cueCard,question.cueCard??'');cueCard.hidden=!question.cueCard;}
  levelButtons.forEach(b=>{const selected=b.dataset.fluencyLevel===level;b.setAttribute('aria-checked',String(selected));b.tabIndex=selected?0:-1;});
  text(levelLabel,t.levels[level].title);result.hidden=!ended;
  if(ended){text(resultTitle,phase==='won'?t.won:t.lost);text(resultBody,phase==='won'?t.wonBody:t.lostBody);text(resultTime,`${phase==='won'?60:Math.floor(state.elapsedMs/1000)} / 60 ${t.sec}`);}
  start.hidden=!selecting;text(start,phase==='error'?t.retry:t.start);resume.hidden=phase!=='paused';quit.hidden=selecting||ended;again.hidden=!ended;change.hidden=!ended;
  const error=t.errors[state.error]??t.errors.unknown;
  const message=phase==='error'?error:phase==='paused'?(t.errors[pauseReason]??t.paused):phase==='running'?(state.speaking?t.speaking:t.silent):t.status[phase]??'';
  text(status,message);status.setAttribute('role',phase==='error'?'alert':'status');
  text(mic,['running','calibrating','ready'].includes(phase)?t.micOn:phase==='requesting_permission'?t.micRequest:t.micOff);
 }
 function stopResources(){epoch++;if(frame!==null)cancel(frame);frame=null;lastFrame=null;voice?.dispose();voice=null;roundController?.abort();roundController=null;detector=null;}
 function leaveRound(){stopResources();engine.quit();engine.reset(level);question=null;pauseReason='';paint();start.focus();}
 function pause(code='',at=now()){
  if(!['running','requesting_permission','calibrating','ready'].includes(engine.snapshot().phase))return;
  if(lastFrame!==null&&at-lastFrame>400)at=lastFrame;
  engine.pause(at);stopResources();pauseReason=code;paint();if(engine.snapshot().phase==='paused'&&document.visibilityState!=='hidden')resume.focus();
 }
 function fail(error){const code=error?.code??({NotAllowedError:'permission_denied',SecurityError:'permission_denied',NotFoundError:'no_microphone',NotReadableError:'device_interrupted'}[error?.name])??'unknown';if(['audio_suspended','device_interrupted'].includes(code)){pause(code);return;}engine.fail(t.errors[code]?code:'unknown');stopResources();paint();start.focus();}
 async function begin(){
  if(signal.aborted||!['idle','error','won','lost','paused'].includes(engine.snapshot().phase))return;
  const continuing=engine.snapshot().phase==='paused';stopResources();if(!continuing)question=null;
  if(!engine.request())return;
  const generation=epoch;roundController=new view.AbortController();
  paint();
  try{
   const input=voiceFactory({signal:roundController.signal,onInterrupted:code=>{if(generation===epoch)pause(code);}});voice=input;
   const opening=input.open();
   const loaded=question?Promise.resolve(question):picker.next(roundController.signal).catch(error=>{throw Object.assign(Error('question_unavailable'),{code:error?.code==='question_empty'?'question_empty':'question_unavailable'});});
   const [,nextQuestion]=await Promise.all([opening,loaded]);
   if(signal.aborted||generation!==epoch){input.dispose();return;}
   question=nextQuestion;engine.permissionGranted();detector=createEnergyDetector(DIFFICULTIES[level]);paint();
   const step=()=>{
    frame=null;if(signal.aborted||generation!==epoch)return;
    const at=now();
    if(lastFrame!==null&&at-lastFrame>400){pause('interrupted',lastFrame);return;}
    lastFrame=at;
    try{
     const sample=input.sample(),activity=detector.sample(sample.rms,at,sample.speech),state=engine.snapshot();
     if(state.phase==='calibrating'&&activity.ready)engine.calibrated();
     else if(state.phase==='ready'){engine.start(at);questionText.focus();}
     else if(state.phase==='running')engine.advance(at,activity.speaking);
     paint({...activity,samples:sample.samples});
     if(['won','lost'].includes(engine.snapshot().phase)){stopResources();paint();resultTitle.focus();return;}
     frame=raf(step);
    }catch(error){if(generation===epoch)fail(error);}
   };
   frame=raf(step);
  }catch(error){if(!signal.aborted&&generation===epoch)fail(error);}
 }
 listen(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')pause();},signal);
 listen(view,'blur',()=>{if(engine.snapshot().phase!=='requesting_permission')pause();},signal);
 listen(view,'pagehide',()=>{stopResources();engine.quit();engine.reset(level);question=null;paint();},signal);
 signal.addEventListener('abort',()=>{stopResources();engine.quit();},{once:true});
 paint();
 return {engine,host};
}
