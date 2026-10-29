import {el,listen} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
import {LivePartnerCall} from './call-engine.js';
/** Port of LivePartnerPage + LivePartnerClient. Uses existing /api/live-partner.
 * Server is always authoritative for presence, rules and call membership.
 * Voice is never recorded; WebRTC uses server-issued signalling/relay credentials. */
const POLL=4000,BEAT=15000,TIMEOUT=8000,RULES_VERSION=1,PARTS=['part1','part2','part3'];
const score=s=>s==null?'S —':`S ${Number(s).toFixed(1)}`;
const debounce=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function button(label,fn,cls='btn-secondary',props={}){const b=el('button',{type:'button',class:cls,...props},label);b.addEventListener('click',fn);return b;}
function avatar(person,t,large=false){const k=person?.avatar==='b'?'b':'a',root=el('span',{role:'img','aria-label':t.avatar,class:`flex ${large?'h-36 w-36 text-6xl':'h-10 w-10 text-lg'} shrink-0 overflow-hidden items-center justify-center rounded-full ${k==='b'?'bg-rose-100':'bg-sky-100'}`});
 if(person?.userId&&person.hasPhoto!==false){const img=el('img',{src:`/api/profile/photo/${encodeURIComponent(person.userId)}`,alt:t.avatar,loading:'lazy',class:'h-full w-full object-cover'});img.addEventListener('error',()=>root.replaceChildren(k==='b'?'👩‍🎓':'👨‍🎓'),{once:true});root.append(img);}else root.textContent=k==='b'?'👩‍🎓':'👨‍🎓';return root;}
async function request(body,signal){const res=await fetch('/api/live-partner',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});const data=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(data.error||'unavailable');e.code=data.error;e.status=res.status;throw e;}return data;}
export function mount(context){
 const {root,dict,signal,url}=context,t=dict.livePartner;
 const host=el('div',{class:'mx-auto flex w-full max-w-[1840px] flex-col gap-4','data-route-usable':'live-partner'}),workspace=el('div',{class:'live-partner-workspace flex flex-col gap-3','data-live-partner-state':'offline'});
 const header=el('header',{},el('h1',{class:'font-display text-2xl text-ink-900'},t.title),el('p',{class:'text-sm text-ink-500'},t.intro));
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),header,workspace);root.append(host);
 const remoteAudio=el('audio',{autoplay:'',class:'hidden','aria-hidden':'true'});host.append(remoteAudio);
 let me=null,questions=[],topicsByPart={part1:[],part2:[],part3:[]},topicQuestions=[],topicCursor=null,topicLoading=false,topicToken=0,data=null,error='',flow='none',busy=false,query='',searchState='idle',searchCursor=null,remoteQuestions=null,open=null,selectedTopic=null,qIndex=0,gen=0,fetchId=0,searchId=0,searchTimer=null,pollCtl=null,call=null,callSession=null,callStatus=null,micMuted=false,remoteMuted=false,micState='unknown',level=0,micStream=null,micCtx=null,micRAF=null,entryAttempted=false;
 let inFlight=false,heartbeat=false,destroyed=false;
 const timers=new Set();const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
 const state=()=>data?.state??'offline',active=()=>['connecting','in_call','reconnecting'].includes(state());
 function stopMic(){if(micRAF)cancelAnimationFrame(micRAF);micRAF=null;micStream?.getTracks().forEach(x=>x.stop());micStream=null;if(micCtx){void micCtx.close().catch(()=>{});micCtx=null;}}
 function disposeCall(){call?.destroy();call=null;callSession=null;remoteAudio.pause();remoteAudio.srcObject=null;}
 const cleanup=()=>{if(destroyed)return;destroyed=true;gen++;searchId++;for(const timer of timers)clearTimeout(timer);clearTimeout(searchTimer);pollCtl?.abort();stopMic();disposeCall();
   if(data&&state()!=='offline'){
    if(data.sessionId)void fetch('/api/live-partner',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'hangup',sessionId:data.sessionId})}).catch(()=>{});
    void fetch('/api/live-partner',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'go_offline'})}).catch(()=>{});
   }
 };
 signal.addEventListener('abort',cleanup,{once:true});
 function accept(next,token){if(destroyed||token<gen)return;gen=token;data=next;ensureCall();draw();}
 async function refresh(){if(destroyed||pollCtl)return;const token=gen,ctl=new AbortController();pollCtl=ctl;const timeout=setTimeout(()=>ctl.abort(),TIMEOUT);
  try{const next=await request(null,ctl.signal);if(destroyed||token<gen)return;accept(next,token);error='';
   if(!entryAttempted&&state()==='offline'&&data.realtime?.ready){entryAttempted=true;if(!me.hasGender)error=t.errors.profile_incomplete;else if(!data.rulesAccepted)flow='rules';else void act({action:'go_online'});}
  }catch{if(!ctl.signal.aborted)error=t.errors.unavailable;}
  finally{clearTimeout(timeout);if(pollCtl===ctl)pollCtl=null;if(!destroyed)draw();}
 }
 async function act(body){if(inFlight||destroyed)return false;inFlight=true;busy=true;const token=++gen;pollCtl?.abort();const ctl=new AbortController(),deadline=setTimeout(()=>ctl.abort(),TIMEOUT);draw();
  try{const next=await request(body,ctl.signal);if(destroyed||token!==gen)return false;error='';accept(next,token);return true;}
  catch(e){if(!destroyed){error=t.errors[e?.code]??(ctl.signal.aborted?t.errors.unknownResult:t.errors.unavailable);void refresh();}return false;}
  finally{clearTimeout(deadline);inFlight=false;busy=false;if(!destroyed)draw();}
 }
 async function loadTopics(){
  try{const batches=await Promise.all(PARTS.map(async part=>{const all=[];let cursor=null;do{const params=new URLSearchParams({channel:'practice_alone',part,...(cursor?{topicCursor:cursor}:{})});const res=await fetch('/api/speaking/practice/facets?'+params,{credentials:'same-origin',cache:'no-store',signal});if(!res.ok)throw Error('topics');const data=await res.json();all.push(...(data.topics??[]));cursor=data.nextTopicCursor??null;}while(cursor&&!signal.aborted);return [part,all];}));if(destroyed)return;topicsByPart=Object.fromEntries(batches);draw();}catch{if(!destroyed)error=t.searchFailed;draw();}
 }
 async function loadTopic(part,topic,more=false){const token=more?topicToken:++topicToken;if(!more){topicQuestions=[];topicCursor=null;}topicLoading=true;draw();try{const params=new URLSearchParams({part,topic,...(more&&topicCursor?{cursor:topicCursor}:{})});const res=await fetch('/api/speaking/live-partner/questions?'+params,{credentials:'same-origin',cache:'no-store',signal});if(!res.ok)throw Error('topic');const data=await res.json();if(destroyed||token!==topicToken)return;const seen=new Set(topicQuestions.map(q=>q.id));topicQuestions.push(...(data.questions??[]).filter(q=>!seen.has(q.id)));topicCursor=data.nextCursor??null;}catch{if(!destroyed&&token===topicToken)error=t.searchFailed;}finally{if(!destroyed&&token===topicToken){topicLoading=false;draw();}}}
 async function search(more=false){const text=query.trim();if(!text){remoteQuestions=null;searchCursor=null;searchState='idle';searchId++;draw();return;}
  const token=++searchId;searchState='loading';draw();
  try{const q=new URLSearchParams({q:text,...(more&&searchCursor?{cursor:searchCursor}:{})});const r=await fetch('/api/speaking/live-partner/questions?'+q,{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw Error('search');const result=await r.json();if(destroyed||token!==searchId)return;
   const arr=Array.isArray(result.questions)?result.questions:[],prior=more?remoteQuestions??[]:[];const seen=new Set(prior.map(x=>x.id));remoteQuestions=[...prior,...arr.filter(x=>!seen.has(x.id))];searchCursor=result.nextCursor??null;searchState=remoteQuestions.length?'success':'empty';
  }catch{if(!destroyed&&token===searchId)searchState='error';}finally{if(!destroyed&&token===searchId)draw();}
 }
 async function microphone(){stopMic();flow='mic';micState='checking';level=0;draw();if(!navigator.mediaDevices?.getUserMedia||typeof AudioContext==='undefined'){micState='unsupported';draw();return;}
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});if(destroyed||flow!=='mic'){stream.getTracks().forEach(t=>t.stop());return;}micStream=stream;
   const ctx=new AudioContext();micCtx=ctx;const analyser=ctx.createAnalyser();analyser.fftSize=512;ctx.createMediaStreamSource(stream).connect(analyser);const buf=new Uint8Array(analyser.fftSize);
   const tick=()=>{if(!micStream||destroyed)return;analyser.getByteTimeDomainData(buf);let peak=0;for(const v of buf)peak=Math.max(peak,Math.abs(v-128));level=Math.min(1,peak/64);if(level>0.08&&micState!=='ok'){micState='ok';draw();}const meter=workspace.querySelector('[data-live-mic-meter]');if(meter)meter.style.width=`${Math.round(level*100)}%`;micRAF=requestAnimationFrame(tick);};tick();
  }catch(e){stopMic();micState=['NotAllowedError','SecurityError'].includes(e?.name)?'denied':['NotFoundError','OverconstrainedError'].includes(e?.name)?'missing':'error';draw();}
 }
 function closeFlow(){stopMic();flow='none';draw();}
 // Dialog keyboard behavior matches the original: Escape closes, Tab stays
 // inside the modal, and no listener survives this route's AbortSignal.
 listen(document,'keydown',e=>{
  if(flow==='none')return;
  if(e.key==='Escape'){e.preventDefault();closeFlow();return;}
  if(e.key!=='Tab')return;
  const dialog=workspace.querySelector('[role="dialog"]');if(!dialog)return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
  if(!controls.length){e.preventDefault();return;}
  const first=controls[0],last=controls[controls.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 },signal);
 async function agree(){if(await act({action:'accept_rules',version:RULES_VERSION})){closeFlow();await act({action:'go_online'});}}
 async function endCall(block){const id=data?.sessionId;call?.hangup();if(block)await act({action:'block',userId:block});if(id)await act({action:'hangup',sessionId:id});}
 function ensureCall(){const sid=active()?data?.sessionId:null;if(sid===callSession)return;disposeCall();if(!sid)return;callSession=sid;micMuted=false;remoteMuted=false;
  call=new LivePartnerCall(sid,{
   fetchToken:async id=>request({action:'signal_token',sessionId:id},AbortSignal.timeout(TIMEOUT)),
   getUserMedia:()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),
   createPeer:config=>new RTCPeerConnection(config),createSocket:uri=>new WebSocket(uri),
   report:status=>{void request({action:'connection',sessionId:sid,status},AbortSignal.timeout(TIMEOUT)).catch(()=>{});},
   onStatus:(status,detail)=>{if(destroyed)return;callStatus=status;
    if(status==='failed'){error=['microphone','microphone_ended'].includes(detail)?t.errors.mic:t.callFailed;void request({action:'hangup',sessionId:sid},AbortSignal.timeout(TIMEOUT)).catch(()=>{}).finally(()=>void refresh());}draw();},
   onRemoteStream:stream=>{remoteAudio.srcObject=stream;if(stream)void remoteAudio.play().catch(()=>{error=t.tapToPlay;draw();});}
  });void call.start();
 }
 function draw(){if(destroyed||!me)return;
  // A 4-second presence poll must not throw away a learner's text caret or
  // keyboard focus just because the native DOM implementation redraws a panel.
  const activeElement=document.activeElement;
  const activeSearch=activeElement?.tagName==='INPUT'&&activeElement.type==='search'&&workspace.contains(activeElement);
  const selection=activeSearch?{from:activeElement.selectionStart,to:activeElement.selectionEnd}:null;
  const activeDialog=activeElement?.closest?.('[role="dialog"]');
  const activeDialogIndex=activeDialog?[...activeDialog.querySelectorAll('button:not([disabled])')].indexOf(activeElement):-1;
  workspace.dataset.livePartnerState=state();workspace.replaceChildren();
  if(error)workspace.append(el('p',{role:'alert',class:'rounded-sm border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800'},error));
  if(data&&!data.realtime?.ready)workspace.append(el('p',{'data-realtime-unavailable':'',class:'rounded-sm border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900'},t.realtimeMissing));
  if(data?.incoming){const incoming=el('section',{role:'alertdialog','aria-label':t.incomingTitle,class:'flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-paper p-3'},avatar(data.incoming.from,t),el('p',{class:'flex-1 text-sm'},`${data.incoming.from.name} · ${score(data.incoming.from.speakingScore)} — ${t.incomingBody}`),button(t.accept,()=>void act({action:'accept',inviteId:data.incoming.id}),'btn-primary',{disabled:busy?'':null}),button(t.decline,()=>void act({action:'decline',inviteId:data.incoming.id}),'btn-secondary',{disabled:busy?'':null}));workspace.append(incoming);}
  const grid=el('div',{class:'grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr]'});
  const mePanel=el('section',{class:'lp-panel lp-self flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4'},el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.you),el('div',{class:'flex flex-col items-center gap-4 py-6 text-center'},avatar(me,t,true),el('p',{class:'font-medium text-ink-900'},me.name),el('p',{class:'font-mono text-sm text-ink-600'},score(me.speakingScore))),el('p',{class:'text-xs text-ink-500'},`${t.micStatus}: ${t.mic[micState]}`),el('p',{class:'text-sm text-ink-600','aria-live':'polite'},t.states[state()]??''));
  mePanel.append(button(t.micTitle,()=>void microphone(),'btn-secondary',{disabled:busy||active()?'':null}));
  if(data?.realtime?.ready&&!data.rulesAccepted)mePanel.append(button(t.rulesTitle,()=>{flow='rules';draw();}));
  if(data?.outgoing)mePanel.append(button(t.cancelInvite,()=>void act({action:'cancel',inviteId:data.outgoing.id}),'btn-secondary',{disabled:busy?'':null}));
  if(active())mePanel.append(button(micMuted?t.unmuteMic:t.muteMic,()=>{micMuted=!micMuted;call?.setMuted(micMuted);draw();},'btn-secondary',{'aria-pressed':String(micMuted)}));
  grid.append(mePanel);
  const questionsPanel=el('section',{class:'lp-panel lp-questions flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4'},el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.questions),el('p',{class:'text-xs text-ink-500'},t.questionsOptional));
  const searchInput=el('input',{type:'search',value:query,placeholder:t.search,class:'w-full rounded-sm border border-ink-200 px-3 py-2'});
  listen(searchInput,'input',()=>{query=searchInput.value;selectedTopic=null;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void search(),250);},signal);questionsPanel.append(searchInput);
  questionsPanel.append(el('p',{role:'status','aria-live':'polite','data-partner-search-state':searchState,class:'text-xs text-ink-500'},searchState==='loading'?t.searchSearching:searchState==='error'?t.searchFailed:searchState==='empty'?t.noQuestions:''));
  if(searchState==='error')questionsPanel.append(button(t.searchRetry,()=>void search(),'btn-ghost btn-sm self-start',{'data-partner-search-retry':''}));
  if(searchCursor&&searchState==='success')questionsPanel.append(button(t.searchMore,()=>void search(true),'btn-ghost btn-sm self-start',{'data-partner-search-more':''}));
  const pool=remoteQuestions??questions;
  if(selectedTopic){const list=topicQuestions,q=list[Math.min(qIndex,list.length-1)];
   if(topicLoading&&!list.length)questionsPanel.append(el('p',{role:'status'},dict.common.loading));
   if(q){const card=el('article',{class:'flex min-h-80 flex-col gap-5 rounded-2xl border border-ink-100 bg-paper-raised p-5','data-partner-topic-question':''},button('← '+dict.common.back,()=>{selectedTopic=null;draw();},'btn-secondary self-start'),el('h3',{class:'font-display text-xl'},selectedTopic.topic??dict.speakingStudy.topic),el('p',{class:'whitespace-pre-line text-lg'},q.promptText),q.cueCard?el('p',{class:'whitespace-pre-line text-ink-700'},q.cueCard):null,
     el('div',{class:'mt-auto flex flex-wrap items-center justify-between gap-2'},el('span',{},`${qIndex+1} / ${list.length}`),button(t.nextQuestion+' →',()=>{qIndex++;draw();},'btn-primary',{disabled:qIndex+1>=list.length?'':null})));questionsPanel.append(card);if(topicCursor&&!topicLoading)questionsPanel.append(button(t.searchMore,()=>void loadTopic(selectedTopic.part,selectedTopic.topic,true),'btn-secondary'));}
  }else for(const part of PARTS){const matches=pool.filter(q=>q.part===part&&(!query.trim()||(`${q.topic??''} ${q.promptText}`).toLowerCase().includes(query.toLowerCase())));const byTopic=new Map(query.trim()?matches.map(q=>[q.topic,{key:q.topic,title:q.topic}]):topicsByPart[part].map(t=>[t.key,t]));
    const wrap=el('section',{class:'practice-part-card relative overflow-hidden rounded-2xl border border-ink-100','data-practice-part':part});
    const expanded=query.trim().length>0||open===part;wrap.append(button('',()=>{open=open===part?null:part;draw();},'relative flex min-h-28 w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium',{'aria-expanded':String(expanded),'aria-controls':`lp-${part}`}));
    wrap.firstChild.append(el('span',{class:'font-display text-xl font-bold'},t.parts[part]),el('span',{class:'text-xs text-ink-500'},String(byTopic.size)));
    if(expanded){const list=el('ul',{id:`lp-${part}`,class:'max-h-96 space-y-2 overflow-y-auto border-t border-ink-100 p-3'});for(const [name,topicRow] of byTopic)list.append(el('li',{},button((topicRow.title??name??dict.speakingStudy.topic)+' →',()=>{selectedTopic={part,topic:name};qIndex=0;void loadTopic(part,name);},'btn-secondary w-full justify-between text-left')));if(!byTopic.size)list.append(el('li',{class:'text-sm text-ink-500'},t.noQuestions));wrap.append(list);}questionsPanel.append(wrap);
  }
  grid.append(questionsPanel);
  const side=el('section',{class:'lp-panel lp-peer flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4'});
  if(active()&&data?.partner){side.append(el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.partner),avatar(data.partner,t,true),el('p',{class:'font-medium text-center'},data.partner.name),el('p',{class:'font-mono text-sm text-center'},score(data.partner.speakingScore)),el('p',{'data-call-status':callStatus??'connecting',role:'status'},t.callStates[callStatus==='connected'?'connected':callStatus==='reconnecting'?'reconnecting':'connecting']),
    button(remoteMuted?t.unmutePartner:t.mutePartner,()=>{remoteMuted=!remoteMuted;remoteAudio.muted=remoteMuted;draw();},'btn-secondary',{'aria-pressed':String(remoteMuted)}),button(t.choosePartner,()=>void endCall(),'btn-primary'),button(t.block,()=>void endCall(data.partner.userId),'btn-ghost btn-sm'));
  }else{side.append(el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.onlineUsers));
   const users=data?.online??[];if(!users.length)side.append(el('p',{class:'text-sm text-ink-500'},data?t.nobodyOnline:t.loading));
   else for(const p of users)side.append(el('article',{class:'flex items-center gap-2'},avatar(p,t),el('div',{class:'flex-1'},el('p',{class:'font-medium text-sm'},p.name),el('p',{class:'font-mono text-xs text-ink-600'},score(p.speakingScore))),button(t.invite,()=>void act({action:'invite',toUserId:p.userId}),'btn-secondary btn-sm',{disabled:busy||state()!=='available'?'':null})));
  }
  grid.append(side);workspace.append(grid);
  if(flow!=='none'){
   const overlay=el('div',{class:'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'}),dialog=el('div',{role:'dialog','aria-modal':'true',class:'w-full max-w-md rounded-lg bg-paper p-5 shadow-lg'});
   overlay.append(dialog);overlay.addEventListener('mousedown',e=>{if(e.target===overlay)closeFlow();});
   if(flow==='rules')dialog.append(el('h2',{class:'font-display text-lg'},t.rulesTitle),el('ul',{class:'my-3 list-disc pl-5 text-sm text-ink-700'},(t.rules??[]).map(rule=>el('li',{},rule))),el('div',{class:'flex justify-end gap-2'},button(t.close,closeFlow),button(t.agree,()=>void agree(),'btn-primary',{disabled:busy?'':null})));
   else dialog.append(el('h2',{class:'font-display text-lg'},t.micTitle),el('p',{class:'my-2 text-sm text-ink-600'},t.micBody),el('div',{class:'h-3 w-full overflow-hidden rounded-full bg-ink-100',role:'meter','aria-label':t.micLevel,'aria-valuemin':0,'aria-valuemax':100},el('div',{'data-live-mic-meter':'',class:'h-full bg-emerald-500'})),el('p',{class:'mt-2 text-xs text-ink-600',role:'status'},t.mic[micState]),el('div',{class:'mt-4 flex justify-end gap-2'},button(t.close,closeFlow),['denied','missing','error'].includes(micState)?button(t.retryMic,()=>void microphone()):null,button(t.micReady,closeFlow,'btn-primary',{disabled:micState!=='ok'||busy?'':null})));
   workspace.append(overlay);const choices=[...dialog.querySelectorAll('button:not([disabled])')];
   (activeDialogIndex>=0?choices[Math.min(activeDialogIndex,choices.length-1)]:choices[0])?.focus({preventScroll:true});
  }
  if(activeSearch&&flow==='none'){
   const replacement=workspace.querySelector('input[type="search"]');
   if(replacement){replacement.focus({preventScroll:true});
    try{replacement.setSelectionRange(selection.from,selection.to);}catch{}}
  }
 }
 async function init(){try{const d=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;if(d.kind!=='speaking_live_partner'||!d.me||!Array.isArray(d.questions))throw Error('invalid_live_partner_view');me=d.me;questions=d.questions;draw();void loadTopics();void refresh();}catch{if(!signal.aborted)workspace.replaceChildren(RegionFailureNotice({region:'speaking-live-partner',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:init}));}}
 const runPoll=()=>{if(!destroyed&&document.visibilityState==='visible')void refresh();later(runPoll,POLL);};later(runPoll,POLL);
 const runBeat=()=>{if(!destroyed&&state()!=='offline'&&!heartbeat){heartbeat=true;void request({action:'heartbeat'},AbortSignal.timeout(TIMEOUT)).catch(()=>{}).finally(()=>{heartbeat=false;});}later(runBeat,BEAT);};later(runBeat,BEAT);
 void init();
}
