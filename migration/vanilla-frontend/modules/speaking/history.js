import {el,listen} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {api} from '../../js/api-client.js';
import {evaluationView} from './evaluation.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
/** Original SpeakingHistoryPage + ManualTranscriptForm.
 * All data are scoped by the server to the active user. This view never invents
 * evaluations, machine transcripts or private-resource URLs. */
const fmt=ms=>{const n=Math.max(0,Math.round(ms/1000));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const bytes=n=>!n?'':n<1048576?`${Math.round(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
function transcriptForm(context,attemptId,refresh){
 const {dict,signal}=context,t=dict.speakingPractice;
 const host=el('div',{class:'flex flex-col gap-2 rounded-sm bg-paper-sunken p-3'},el('p',{class:'text-xs text-ink-400'},t.noTranscriptNotice));
 const id=`transcript-${attemptId}`;
 const label=el('label',{for:id,class:'text-sm font-medium text-ink-700'},t.manualTranscriptLabel),input=el('textarea',{id,class:'input min-h-[90px]'}),hint=el('p',{class:'text-xs text-ink-300'},t.manualTranscriptHint),status=el('p',{class:'text-xs',role:'status'});
 const save=el('button',{type:'button',class:'btn-secondary',disabled:''},dict.common.save);
 let busy=false,done=false;
 listen(input,'input',()=>{save.disabled=busy||done||input.value.trim().length<10;},signal);
 listen(save,'click',async()=>{
  if(busy||done||input.value.trim().length<10)return;busy=true;save.disabled=true;save.textContent=dict.common.saving;status.textContent='';
  try{await api.request(`/api/speaking/attempts/${encodeURIComponent(attemptId)}/transcript`,{method:'POST',body:{manualTranscript:input.value.trim()},signal,timeoutMs:60000});if(signal.aborted)return;done=true;input.disabled=true;status.className='text-xs text-band-good';status.textContent=t.manualTranscriptSaved;void refresh();}
  catch(e){if(!signal.aborted){status.className='text-xs text-band-bad';status.textContent=dict.common.error;}}
  finally{busy=false;save.textContent=dict.common.save;save.disabled=done||input.value.trim().length<10;}
 },signal);
 host.append(label,input,hint,status,save);return host;
}
export function mount(context){
 const {root,dict,signal,url}=context,t=dict.speakingPractice,host=el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4','data-route-usable':'speaking-history'});
 root.append(host);let busy=false;
 async function load(){if(busy||signal.aborted)return;busy=true;
  for(const audio of host.querySelectorAll('audio'))audio.pause();
  host.replaceChildren(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),el('h1',{class:'font-display text-2xl text-ink-900'},t.historyTitle),el('p',{role:'status'},dict.common.loading));
  try{const d=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;if(d.kind!=='speaking_history'||!Array.isArray(d.attempts))throw Error('invalid_history');
   const list=el('div',{class:'flex flex-col gap-3'});
   if(d.attempts.length===0)list.append(el('section',{class:'card flex flex-col gap-2 p-5'},el('p',{},'🎙'),el('p',{},t.historyEmpty),el('a',{href:'/app/speaking/practice',class:'btn-primary mt-2'},t.openStudio)));
   const evaluations=d.evaluations??{};
   for(const attempt of d.attempts){
    const evaluation=evaluations[attempt.id]??null,card=el('article',{class:'card flex flex-col gap-2'},el('div',{class:'flex flex-wrap items-center justify-between gap-2'},
     el('p',{class:'text-sm font-medium text-ink-900'},`${t.part[attempt.part]??attempt.part}${attempt.prompt?.promptText?' · '+attempt.prompt.promptText.slice(0,60)+'…':''}`),
     el('div',{class:'flex items-center gap-2'},el('span',{class:'badge'},t.attemptStatus[attempt.status]??''),evaluation?el('span',{class:'badge bg-signal-100 text-signal-700','data-checked-by':evaluation.checkedByName},`${dict.coach.checkedBy} ${evaluation.checkedByName}`):null)));
    if(attempt.recordingObjectKey){
     // The existing server owns the resource's authorisation. Never construct an off-site URL.
     card.append(el('audio',{controls:'',preload:'none',class:'w-full',src:`/api/resources/${attempt.recordingObjectKey.split("/").map(encodeURIComponent).join("/")}`}));
     card.append(el('p',{class:'flex flex-wrap gap-3 text-xs text-ink-300'},attempt.recordingOriginalName??'recording',attempt.recordingDurationMs?fmt(attempt.recordingDurationMs):'',attempt.recordingSize?bytes(attempt.recordingSize):''));
    }else card.append(el('p',{class:'text-xs text-ink-300'},t.attemptStatus.recording));
    if(attempt.transcript){card.append(el('div',{class:'flex flex-col gap-1'},el('p',{class:'text-xs text-ink-300'},attempt.transcriptOrigin==='manual'?dict.coach.transcriptManual:dict.coach.transcriptFromStt),el('p',{class:'whitespace-pre-line rounded-sm bg-paper-sunken p-3 text-sm text-ink-700'},attempt.transcript)));}
    else {card.append(el('p',{class:'text-xs text-ink-400'},`${t.noTranscript} — ${t.noTranscriptBody}`));if(attempt.recordingObjectKey&&attempt.status!=='recording')card.append(transcriptForm(context,attempt.id,load));}
    if(evaluation){card.append(evaluationView(dict,evaluation));}
    else if(attempt.transcript)card.append(el('p',{class:'text-xs text-ink-400'},dict.coach.noEvaluation));
    list.append(card);
   }
   host.lastElementChild.replaceWith(list);
  }catch{if(!signal.aborted)host.lastElementChild.replaceWith(RegionFailureNotice({region:'speaking-history',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}));}
  finally{busy=false;}
 }
 signal.addEventListener('abort',()=>{for(const audio of host.querySelectorAll('audio'))audio.pause();},{once:true});void load();
}
