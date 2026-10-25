import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {viewData} from '../../js/adapters/frontend.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
import {createRecorder,isSupported,duration,extensionForMime} from './recorder.js';
import {prepareRecordingPlayback,releaseRecordingPlayback} from '../shared/recording-playback.js';
import {uploadRecording} from './upload.js';
/** Original SpeakingAiPage and AiExaminerSession. No client-side script sampling,
 * grading, fake transcription or inferred provider readiness. */
const MODES=['full','part1','part2','part3'];
function action(label,fn,options={}){const b=el('button',{type:'button',class:options.class??'btn-primary',...(options.attrs??{})},label);b.addEventListener('click',fn);return b;}
export function mount(context){
 const {dict,root,signal,url}=context,t=dict.speakingAi;
 const host=el('div',{class:'mx-auto flex max-w-3xl flex-col gap-6','data-route-usable':'speaking-ai'}),state={phase:'choose',script:null,step:0,answered:{},waiting:false,failedMode:null,generation:0,recorder:null};
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),el('header',{},el('h1',{class:'font-display text-2xl text-ink-900'},dict.speakingHub.cards.ai.title),el('p',{class:'mt-1 text-base text-ink-500'},t.intro)));
 const region=el('div',{class:'flex flex-col gap-5','data-ai-session':'choose'});host.append(region);root.append(host);
 signal.addEventListener('abort',()=>{state.generation++;state.recorder?.stop();},{once:true});
 let readiness={transcription:false,aiEvaluation:false},bankMatching=null;
 function end(){state.generation++;state.recorder?.stop();state.recorder=null;state.phase='choose';state.script=null;state.step=0;state.answered={};state.failedMode=null;draw();}
 async function start(mode){if(state.waiting||state.phase!=='choose'||signal.aborted)return;const gen=++state.generation;state.waiting=true;state.failedMode=null;draw();
  try{const data=await api.request('/api/speaking/ai/script?mode='+encodeURIComponent(mode),{signal});if(signal.aborted||gen!==state.generation||state.phase!=='choose')return;
   if(data.mode!==mode||!Array.isArray(data.script)||!data.script.every(x=>typeof x.id==='string'&&['part1','part2','part3','general'].includes(x.part)&&typeof x.promptText==='string'))throw Error('invalid_script');
   state.script=data.script;state.step=0;state.answered={};state.phase='running';
  }catch{if(!signal.aborted&&gen===state.generation)state.failedMode=mode;}
  finally{if(gen===state.generation){state.waiting=false;draw();}}
 }
 function draw(){if(signal.aborted)return;state.recorder?.stop();state.recorder=null;region.dataset.aiSession=state.phase==='choose'?'choose':state.step>=(state.script?.length??0)?'finished':'running';region.replaceChildren();
  const ready=readiness.transcription&&readiness.aiEvaluation;
  region.append(el('div',{role:'status','data-ai-readiness':ready?'ready':'unavailable',class:'rounded-md border p-4 text-sm '+(ready?'border-band-good/30 bg-band-good/5 text-ink-700':'border-amber-300 bg-amber-50 text-ink-700 dark:bg-amber-950/30')},
   ready?t.readyBody:el('div',{},el('p',{class:'font-medium text-ink-900'},t.unavailableTitle),el('p',{class:'mt-1'},t.unavailableBody),
    ['teacher','admin','owner'].includes(context.session.user.role)?el('p',{class:'mt-2 text-xs','data-ai-staff-setup':''},t.staffSetup,' ',el('a',{href:'/app/owner/integrations',class:'underline'},t.staffSetupLink)):null)));
  if(bankMatching===0){region.append(el('p',{class:'text-sm text-ink-500'},dict.speakingPractice.bankEmpty));return;}
  if(state.phase==='choose'){
   const modes=el('div',{class:'grid gap-3 sm:grid-cols-2','data-ai-modes':''});
   for(const mode of MODES)modes.append(action('',()=>void start(mode),{class:'card flex min-h-24 flex-col items-start gap-1 p-5 text-left hover:bg-paper-sunken disabled:cursor-not-allowed disabled:opacity-50',attrs:{'data-ai-mode':mode,...(state.waiting?{disabled:''}:{})}}));
   for(const b of modes.children){const key=b.dataset.aiMode;b.append(el('span',{class:'font-display text-lg text-ink-900'},t.mode[key]),el('span',{class:'text-sm text-ink-500'},t.modeBody[key]));}
   region.append(modes);
   if(state.waiting)region.append(el('p',{'data-ai-loading':'',role:'status'},dict.common.loading));
   if(state.failedMode)region.append(el('p',{'data-ai-error':'',role:'alert'},dict.common.error,' ',action(dict.errorPage.retry,()=>void start(state.failedMode),{class:'min-h-11 rounded-md underline',attrs:{'data-ai-retry':''}})));
   return;
  }
  if(!state.script?.length){region.append(el('p',{class:'text-sm text-ink-500'},t.noQuestions),action(t.again,end));return;}
  if(state.step>=state.script.length){region.append(el('section',{class:'card flex flex-col gap-2 p-5','data-ai-finished':''},el('p',{class:'font-display text-lg text-ink-900'},t.finishedTitle),el('p',{class:'text-sm text-ink-500'},t.finishedBody.replace('{n}',String(Object.keys(state.answered).length)).replace('{total}',String(state.script.length))),el('div',{class:'flex flex-wrap gap-2'},el('a',{href:'/app/speaking/history',class:'btn-primary'},dict.speakingPractice.viewHistory),action(t.again,end,{class:'btn-ghost'}))));return;}
  const q=state.script[state.step],section=el('section',{class:'flex flex-col gap-3','aria-live':'polite'});
  section.append(el('p',{class:'text-sm text-ink-500','data-ai-progress':''},`${t.progress.replace('{n}',String(state.step+1)).replace('{total}',String(state.script.length))} · ${dict.speakingPractice.part[q.part]}`),el('p',{class:'text-sm text-ink-700'},t.examinerSays));
  let next=null,finish=null;
  const recorder=questionRecorder(context,{prompt:q,index:state.step+1,onBusyChange:busy=>{if(next)next.disabled=busy;if(finish)finish.disabled=busy;},onSubmitted:id=>{state.answered[q.id]=id;}});state.recorder=recorder;section.append(recorder.node);
  const controls=el('div',{class:'flex flex-wrap gap-2'});next=action(state.answered[q.id]?t.next:t.skip,()=>{if(recorder.isBusy())return;state.step++;draw();},{attrs:{'data-ai-next':''}});finish=action(t.endSession,()=>{if(!recorder.isBusy())end();},{class:'btn-ghost'});
  controls.append(next,finish);section.append(controls);region.append(section);
 }
 // The original server page provides a bounded bank count and readiness projection.
 async function entry(){try{const d=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;if(d.kind!=='speaking_ai'||!Number.isFinite(d.matching)||!d.readiness)throw Error('invalid_ai_view');bankMatching=d.matching;readiness={transcription:d.readiness.transcription===true,aiEvaluation:d.readiness.aiEvaluation===true};draw();}catch{if(!signal.aborted)region.replaceChildren(RegionFailureNotice({region:'speaking-ai',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:entry}));}}
 void entry();
}
/** Stateful original attempt recorder: create attempt, microphone, preflight,
 * upload intent/bytes/finalize, attach recording, submit. Server owns grading. */
export function questionRecorder(context,{prompt,index,onBusyChange=()=>{},onSubmitted=()=>{}}){
 const {dict,signal}=context,t=dict.speakingPractice,host=el('section',{class:'card flex flex-col gap-4','data-question-recorder':prompt.id});
 const head=el('div',{class:'flex flex-col gap-2'},el('span',{class:'badge'},t.questionNumber.replace('{n}',String(index))),el('p',{class:'whitespace-pre-line text-base text-ink-900'},prompt.promptText));
 if(prompt.cueCard)head.append(el('div',{class:'rounded-sm bg-paper-sunken p-3','data-speak-cue-card':''},el('p',{class:'mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500'},t.cueCard),el('p',{class:'whitespace-pre-line text-sm text-ink-700'},prompt.cueCard)));
 const ctl=el('div',{class:'flex flex-wrap items-center gap-2'}),notice=el('p',{class:'text-sm text-band-bad',role:'alert'});host.append(head,ctl,notice);
 let phase='idle',attempt=null,rec=null,blob=null,url=null,preview=null,timer=null,started=0,prepEnd=0,epoch=0,pending=false,controller=null,stopped=false;
 const prep=prompt.part==='part2'?60:Math.max(0,prompt.prepSeconds??0),limit=prompt.part==='part2'?120:Math.max(1,prompt.answerSeconds??30);
 const busy=()=>['starting','prepping','recording','uploading','submitting'].includes(phase);
 const clear=()=>{clearInterval(timer);timer=null;};
 const cleanup=()=>{epoch++;clear();rec?.cancel();rec=null;controller?.abort();controller=null;pending=false;releaseRecordingPlayback(preview);preview=null;if(url){URL.revokeObjectURL(url);url=null;}onBusyChange(false);};
 signal.addEventListener('abort',cleanup,{once:true});
 const b=(label,fn,klass='btn-secondary',extra={})=>{const x=action(label,fn,{class:klass,attrs:extra});ctl.append(x);return x;};
 function render(){if(signal.aborted||stopped)return;host.dataset.questionPhase=phase;if(phase!=='reviewing')preview?.pause();ctl.replaceChildren();onBusyChange(busy());
  if(phase==='idle')b(t.recordAnswer,()=>void begin(),'btn-primary',{'data-speak-start':''});
  if(phase==='starting')ctl.append(el('span',{role:'status'},dict.common.loading));
  if(phase==='prepping'){ctl.append(el('span',{'data-speak-preparing':'',role:'status'},`${t.preparing} ${duration(prepEnd-Date.now())}`));b(dict.common.cancel,discard,'btn-ghost');}
  if(phase==='recording'){ctl.append(el('span',{'data-speak-recording':'',role:'status',class:'text-band-bad'},`${t.recording} ${duration(Date.now()-started)} / ${duration(limit*1000)}`));b(t.stop,()=>void finish(),'btn-secondary',{'data-speak-stop':''});b(dict.common.cancel,discard,'btn-ghost');}
  if(phase==='reviewing'&&blob){if(url){const fresh=!preview;preview??=el('audio',{src:url,controls:'',preload:'auto',class:'w-full'});ctl.append(preview);if(fresh)prepareRecordingPlayback(preview);}ctl.append(el('div',{'data-speak-review':'','data-speak-size':blob.size,'data-speak-duration-ms':blob.durationMs},`${Math.ceil(blob.size/1024)} KB · ${duration(blob.durationMs)}`));b(t.submit,()=>void submit(),'btn-primary',{'data-speak-submit':''});b(t.recordAgain,discard,'btn-ghost');}
  if(phase==='uploading')ctl.append(el('span',{role:'status'},t.uploading));
  if(phase==='submitting')ctl.append(el('span',{role:'status'},t.submitting));
  if(phase==='done')ctl.append(el('section',{class:'card flex flex-col gap-2 p-4','data-speak-done':''},el('p',{class:'text-band-good'},t.saved),el('p',{},t.savedBody),b(t.viewHistory,()=>void context.navigate('/app/speaking/history'),'btn-ghost')));
 }
 function ticker(){clear();timer=setInterval(()=>{if(phase==='prepping'){const n=ctl.querySelector('[data-speak-preparing]');if(n)n.textContent=`${t.preparing} ${duration(prepEnd-Date.now())}`;if(Date.now()>=prepEnd)void record();}else if(phase==='recording'){const n=ctl.querySelector('[data-speak-recording]');if(n)n.textContent=`${t.recording} ${duration(Date.now()-started)} / ${duration(limit*1000)}`;if(Date.now()-started>=limit*1000)void finish();}},200);}
 async function begin(){if(pending||signal.aborted)return;pending=true;phase='starting';notice.textContent='';render();const key=epoch;
  try{const data=await api.request('/api/speaking/attempts',{method:'POST',body:{promptId:prompt.id,part:prompt.part},signal});if(signal.aborted||key!==epoch)return;if(!data?.attempt?.id)throw Error('missing_attempt');attempt=data.attempt.id;
   if(prep){phase='prepping';prepEnd=Date.now()+prep*1000;ticker();render();}else await record();
  }catch(e){if(key===epoch&&!signal.aborted){phase='idle';notice.textContent=dict.speakingPractice.errors[e?.code]??dict.common.error;render();}}
  finally{pending=false;}
 }
 async function record(){if(signal.aborted||phase==='recording')return;const key=epoch;clear();phase='starting';render();
  try{try{const res=await fetch('/api/live-partner',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'practice_started'}),signal:AbortSignal.timeout(5000)});if(res.status===409)throw Error('liveCallActive');}catch(e){if(e?.message==='liveCallActive')throw e;}
   const next=await createRecorder({signal});if(signal.aborted||epoch!==key){next.cancel();return;}rec=next;await rec.start();if(signal.aborted||epoch!==key){next.cancel();return;}phase='recording';started=Date.now();ticker();render();
  }catch(e){if(epoch===key&&!signal.aborted){phase='idle';notice.textContent=t.errors[e.code??e.message]??t.errors.unknown;render();}}
 }
 async function finish(){if(phase!=='recording'||!rec)return;const key=epoch,current=rec;rec=null;clear();try{const data=await current.stop();if(signal.aborted||epoch!==key)return;if(!data?.size){notice.textContent=t.errors.unknown;phase='idle';render();return;}blob=data;url=URL.createObjectURL(data.blob);phase='reviewing';render();}catch{if(epoch===key){notice.textContent=t.errors.unknown;phase='idle';render();}}}
 function discard(){cleanup();stopped=false;phase='idle';blob=null;if(attempt){const id=attempt;attempt=null;void api.request(`/api/speaking/attempts/${id}`,{method:'DELETE',timeoutMs:5000}).catch(()=>{});}render();}
 async function submit(){if(pending||!attempt||!blob)return;pending=true;const key=epoch;const ctlr=new AbortController();controller=ctlr;const stop=()=>ctlr.abort();signal.addEventListener('abort',stop,{once:true});
  try{phase='uploading';render();const file=new File([blob.blob],`speaking-${Date.now()}.${extensionForMime(blob.mimeType)}`,{type:blob.mimeType});
   const r=await uploadRecording(file,attempt,{signal:ctlr.signal});if(signal.aborted||key!==epoch)return;
   await api.request(`/api/speaking/attempts/${attempt}`,{method:'PATCH',body:{uploadId:r.uploadId,durationMs:blob.durationMs},signal:ctlr.signal});if(signal.aborted||key!==epoch)return;
   phase='submitting';render();await api.request(`/api/speaking/attempts/${attempt}/submit`,{method:'POST',body:{durationMs:blob.durationMs},signal:ctlr.signal,timeoutMs:60000});
   if(signal.aborted||key!==epoch)return;phase='done';onSubmitted(attempt);render();
  }catch(e){if(!signal.aborted&&key===epoch){phase='reviewing';notice.textContent=t.errors[e?.code]??t.uploadFailed;render();}}
  finally{pending=false;signal.removeEventListener('abort',stop);}
 }
 if(!isSupported()){host.append(el('p',{},t.unsupportedTitle),el('p',{},t.unsupportedBody));}else render();
 return {node:host,stop(){stopped=true;cleanup();},isBusy:busy};
}
