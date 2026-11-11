import {el,listen} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
import {LivePartnerCall} from './call-engine.js';
import {partnerRequest as request,partnerOutsideRoom,partnerRingtone} from './partner-ringing.js';
import {partnerCopy} from './partner-copy.js';
import {partnerActivity} from './partner-activities.js';
import {partnerHistory} from './partner-history.js';
import {partnerMedia} from './partner-media.js';
/** Port of LivePartnerPage + LivePartnerClient. Uses existing /api/live-partner.
 * Server is always authoritative for presence, rules and call membership.
 * Voice is never recorded; WebRTC uses server-issued signalling/relay credentials. */
const POLL=4000,BEAT=15000,TIMEOUT=8000,RULES_VERSION=1,PARTS=['part1','part2','part3'];
const PREFERENCES=['any','male','female'];
const PREFERENCE_AVATARS={any:'👥',male:'👨‍🎓',female:'👩‍🎓'};
const score=s=>s==null?'S —':`S ${Number(s).toFixed(1)}`;
function button(label,fn,cls='btn-secondary',props={}){const b=el('button',{type:'button',class:cls,...props},label);b.addEventListener('click',fn);return b;}
function phone(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('aria-hidden','true');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.7');path.setAttribute('stroke-linejoin','round');path.setAttribute('d','M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a13 13 0 0 1-6-6l2-2z');svg.append(path);return svg;}
function avatar(person,t,large=false){const k=person?.avatar==='b'?'b':'a',root=el('span',{role:'img','aria-label':t.avatar,class:`flex ${large?'h-36 w-36 text-6xl':'h-10 w-10 text-lg'} shrink-0 overflow-hidden items-center justify-center rounded-full ${k==='b'?'bg-rose-100':'bg-sky-100'}`});
 if(person?.userId&&person.hasPhoto!==false){const img=el('img',{src:`/api/profile/photo/${encodeURIComponent(person.userId)}`,alt:t.avatar,loading:'lazy',class:'h-full w-full object-cover'});img.addEventListener('error',()=>root.replaceChildren(k==='b'?'👩‍🎓':'👨‍🎓'),{once:true});root.append(img);}else root.textContent=k==='b'?'👩‍🎓':'👨‍🎓';return root;}
export function mount(context,{createCall=(sid,deps)=>new LivePartnerCall(sid,deps)}={}){
 const {root,dict,signal,url}=context,t=dict.livePartner,u=partnerCopy(context.locale);
 const host=el('div',{class:'lp-page','data-route-usable':'live-partner'}),workspace=el('div',{class:'live-partner-workspace','data-live-partner-state':'offline'});
 const notices=el('div',{class:'lp-call-notices','aria-live':'polite'});
 host.append(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),workspace);root.append(host);
 const remoteAudio=el('audio',{autoplay:'',class:'hidden','aria-hidden':'true'});host.append(notices,remoteAudio);
 const sound=partnerRingtone(host,signal),media=partnerMedia(host,signal);
 let me=null,questions=[],topicsByPart={part1:[],part2:[],part3:[]},topicQuestions=[],topicCursor=null,topicLoading=false,topicToken=0,data=null,error='',flow='none',busy=false,query='',searchState='idle',searchCursor=null,remoteQuestions=null,open=null,selectedTopic=null,qIndex=0,gen=0,fetchId=0,searchId=0,searchTimer=null,pollCtl=null,call=null,callSession=null,callStatus=null,micMuted=false,remoteMuted=false,micState='unknown',level=0,micStream=null,micCtx=null,micRAF=null,entryAttempted=false;
 let inFlight=false,heartbeat=false,destroyed=false;
 let preference='any',outgoingName='',noticeKey='',presenceKey='',topicsRequested=false;
 let profileSaving=false,profileDraftGender=null,profileDraftLevel=null,peerMuted=false,playbackBlocked=false,history=null,historyLoading=false,historyRequested=false,historyOpen=false,lobbyTab='find',lobbyMessage='',clockOffset=0;
 const timers=new Set();const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
 const state=()=>data?.state??'offline',active=()=>['connecting','in_call','reconnecting'].includes(state());
 const outside=()=>me&&partnerOutsideRoom(me.userId);
 listen(host,'pointerdown',sound.unlock,signal);listen(host,'keydown',sound.unlock,signal);
 function stopMic(){if(micRAF)cancelAnimationFrame(micRAF);micRAF=null;micStream?.getTracks().forEach(x=>x.stop());micStream=null;if(micCtx){void micCtx.close().catch(()=>{});micCtx=null;}}
 function disposeCall(){call?.destroy();call=null;callSession=null;remoteAudio.pause();remoteAudio.srcObject=null;media.connected(false);}
 function keepalive(body){return fetch('/api/live-partner',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});}
 const cleanup=()=>{if(destroyed)return;destroyed=true;gen++;searchId++;for(const timer of timers)clearTimeout(timer);clearTimeout(searchTimer);pollCtl?.abort();stopMic();disposeCall();
   if(data&&state()!=='offline'){
    const leaving=data.sessionId?keepalive({action:'hangup',sessionId:data.sessionId}):Promise.resolve();
    void leaving.then(()=>keepalive({action:'go_offline'}));
   }
 };
 signal.addEventListener('abort',cleanup,{once:true});
 function accept(next,token){
  if(destroyed||token<gen)return false;
  const {serverNow,ok,...visible}=next,key=JSON.stringify(visible),changed=key!==presenceKey;
  if(Number.isFinite(Date.parse(serverNow)))clockOffset=Date.parse(serverNow)-Date.now();
  const last=next.features?.lastInvite;
  if(data?.outgoing&&last?.id===data.outgoing.id){
   if(last.status==='declined')lobbyMessage=u.callDeclined;
   if(last.status==='expired')lobbyMessage=u.callMissed;
  }
  if(data?.features?.searchUntil&&!next.features?.searchUntil&&!next.incoming&&!next.outgoing&&
     Date.parse(data.features.searchUntil)<=Date.parse(serverNow))lobbyMessage=u.searchExpired;
  if(data?.sessionId&&!next.sessionId){history=null;historyRequested=false;}
  gen=token;presenceKey=key;data=next;ensureCall();return changed;
 }
 async function refresh(){if(destroyed||pollCtl||inFlight)return;const token=gen,ctl=new AbortController();pollCtl=ctl;const timeout=setTimeout(()=>ctl.abort(),TIMEOUT);
  const oldError=error,oldFlow=flow;let changed=false,goOnline=false;
  try{const next=await request(null,ctl.signal);if(destroyed||token<gen)return;changed=accept(next,token);error='';
   if(!entryAttempted&&state()==='offline'){if(!me.hasGender){entryAttempted=true;error=t.errors.profile_incomplete;}else if(data.realtime?.ready){entryAttempted=true;if(!data.rulesAccepted)flow='rules';else goOnline=true;}}
  }catch{if(!ctl.signal.aborted)error=t.errors.unavailable;}
  finally{clearTimeout(timeout);if(pollCtl===ctl)pollCtl=null;if(!destroyed&&(changed||oldError!==error||oldFlow!==flow))draw();if(goOnline)void act({action:'go_online'});}
 }
 async function act(body){if(inFlight||destroyed)return false;inFlight=true;busy=true;const token=++gen;pollCtl?.abort();const ctl=new AbortController(),deadline=setTimeout(()=>ctl.abort(),TIMEOUT);let retry=false;draw();
  try{const next=await request(body,ctl.signal);if(destroyed||token!==gen)return false;error='';accept(next,token);
   if(body.action.startsWith('activity_')||body.action==='mock_score')call?.notifyActivity?.();
   return true;}
  catch(e){if(!destroyed){error=t.errors[e?.code]??({
   activity_changed:u.activityChanged,activity_question_missing:u.activityMissing,activity_in_progress:u.activityInProgress,partner_upgrade_pending:u.upgrade
  })[e?.code]??(ctl.signal.aborted?t.errors.unknownResult:t.errors.unavailable);retry=true;}return false;}
  finally{clearTimeout(deadline);inFlight=false;busy=false;if(!destroyed){draw();if(retry)later(()=>void refresh(),1000);}}
 }
 async function refreshHistory(){
  if(historyLoading||destroyed)return;
  historyLoading=true;historyRequested=true;
  try{const next=await request(null,AbortSignal.timeout(TIMEOUT),'history');if(!destroyed)history=next;}
  catch{if(!destroyed)error=t.errors.unavailable;}
  finally{historyLoading=false;if(!destroyed)draw();}
 }
 async function historyAction(body){if(await act(body))void refreshHistory();}
 function paintClock(){
  const clock=workspace.querySelector('[data-partner-clock]');
  const remaining=workspace.querySelector('[data-search-remaining]');
  if(remaining){const seconds=Math.max(0,Math.ceil((Date.parse(data?.features?.searchUntil)-Date.now()-clockOffset)/1000));remaining.textContent=seconds+'s';}
  const endsAt=Date.parse(data?.features?.activity?.endsAt);
  if(!clock||!Number.isFinite(endsAt))return;
  const left=Math.max(0,Math.ceil((endsAt-Date.now()-clockOffset)/1000)),value=Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
  if(clock.textContent!==value)clock.textContent=value;
 }
 const clockTimer=setInterval(paintClock,500);signal.addEventListener('abort',()=>clearInterval(clockTimer),{once:true});
 async function loadTopics(){
  if(topicsRequested)return;topicsRequested=true;
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
 async function playAudio(){try{await remoteAudio.play();playbackBlocked=false;}catch{playbackBlocked=true;}if(!destroyed)draw();}
 function ensureCall(){const sid=active()?data?.sessionId:null;if(sid===callSession)return;disposeCall();if(!sid)return;callSession=sid;micMuted=false;remoteMuted=false;peerMuted=false;playbackBlocked=false;remoteAudio.muted=false;
  call=createCall(sid,{
   fetchToken:async id=>request({action:'signal_token',sessionId:id},AbortSignal.timeout(TIMEOUT)),
   getUserMedia:()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),
   createPeer:config=>new RTCPeerConnection(config),createSocket:uri=>new WebSocket(uri),
   report:status=>{void request({action:'connection',sessionId:sid,status},AbortSignal.timeout(TIMEOUT)).catch(()=>{});},
   onStatus:(status,detail)=>{if(destroyed)return;callStatus=status;media.connected(status==='connected');
    if(status==='failed'){error=['microphone','microphone_ended'].includes(detail)?t.errors.mic:t.callFailed;void request({action:'hangup',sessionId:sid},AbortSignal.timeout(TIMEOUT)).catch(()=>{}).finally(()=>void refresh());}draw();},
   onLocalStream:stream=>media.stream('local',stream),
   onRemoteStream:stream=>{media.stream('remote',stream);remoteAudio.srcObject=stream;if(stream)void playAudio();},
   onActivity:()=>void refresh(),
   onPeerMute:muted=>{if(muted!==peerMuted){peerMuted=muted;draw();}}
  });void call.start();
 }
 function drawCallNotice(){
  const incoming=data?.incoming,outgoing=data?.outgoing;
  const key=JSON.stringify([incoming?.id,outgoing?.id,busy,flow]);
  if(noticeKey===key)return;
  noticeKey=key;notices.replaceChildren();
  if(incoming){
   notices.append(el('section',{role:'group','aria-label':t.incomingTitle,class:'lp-call-notice','data-partner-incoming':''},
    avatar(incoming.from,t),el('div',{class:'lp-person'},el('strong',{},incoming.from.name),el('small',{},t.incomingBody)),
    button(t.decline,()=>void act({action:'decline',inviteId:incoming.id}),'btn-secondary',{disabled:busy?'':null,'data-partner-decline':''}),
    button(t.accept,()=>{closeFlow();void act({action:'accept',inviteId:incoming.id});},'btn-primary',{disabled:busy?'':null,'data-partner-accept':''})));
  }else if(outgoing){
   notices.append(el('section',{class:'lp-call-notice','data-partner-outgoing':''},phone(),
    el('div',{class:'lp-person'},el('strong',{},outgoingName||t.calling),el('small',{},t.states.outgoing_invite)),
    button(t.cancelInvite,()=>void act({action:'cancel',inviteId:outgoing.id}),'btn-secondary',{disabled:busy?'':null,'data-partner-cancel':''})));
  }
 }
 function dial(person){
  const canCall=person.canCall!==false&&!busy&&state()==='available'&&data?.realtime?.ready;
  const control=button('',()=>{outgoingName=person.name;lobbyMessage='';void act({action:'invite',toUserId:person.userId});},'btn-primary lp-dial',
   {disabled:!canCall,'aria-label':t.invite+' '+person.name,'data-partner-focus':person.userId,'data-partner-call':person.userId});
  control.append(phone(),el('span',{},t.invite));return control;
 }
 function renderMatchmaking(){
  const seconds=Math.max(0,Math.ceil((Date.parse(data?.features?.searchUntil)-Date.now()-clockOffset)/1000));
  const genderLabel=preference==='male'?'Erkak':preference==='female'?'Ayol':'Barchasi';
  const count=(data?.online??[]).filter(person=>person.canCall!==false).length;
  return el('section',{class:'lp-matchmaking','data-partner-searching':'',role:'status','aria-live':'polite'},
   el('div',{class:'lp-match-orbit','aria-hidden':'true'},
    el('div',{class:'lp-match-ring lp-match-ring-outer'}),
    el('div',{class:'lp-match-ring lp-match-ring-inner'}),
    el('div',{class:'lp-match-center'},avatar(me,t)),
    ...[0,1,2,3].map(index=>el('span',{class:'lp-match-satellite lp-match-satellite-'+index}))),
   el('h1',{},'Sherik qidirilmoqda...'),
   el('p',{class:'lp-match-subtitle'},'Hozir sherik qidirayotgan o‘quvchi bilan moslashtirilmoqdasiz'),
   el('span',{class:'lp-match-online'},'●  ',el('span',{'data-search-online':''},String(count)),' onlayn'),
   el('span',{class:'lp-match-prefs'},genderLabel,' · ',el('span',{'data-search-remaining':''},seconds+'s')),
   button('Bekor qilish',()=>void act({action:'stop_search'}),'lp-match-cancel',{'data-partner-cancel-search':''}));
 }
 function partnerLobby(){
  const online=data?.online??[],matching=online.filter(person=>preference==='any'||(person.gender??(person.avatar==='b'?'female':'male'))===preference);
  const searching=Boolean(data?.features?.searchUntil),enhanced=data?.features?.enabled;
  const number=el('span',{class:'lp-online-count'},String(online.length)+' '+t.hereNow);
  const choices=el('div',{class:'lp-options',role:'group','aria-label':t.gender});
  for(const value of PREFERENCES){
   const choice=button('',()=>{preference=value;draw();},'lp-option',{'aria-pressed':String(preference===value),'data-partner-focus':value,'data-partner-preference':value,disabled:searching});
   choice.append(el('span',{class:'lp-option-mark','aria-hidden':'true'},PREFERENCE_AVATARS[value]),
    el('strong',{},t.preferences[value]),el('small',{},t.preferenceDetails[value]));choices.append(choice);
  }
  const find=button(searching?u.stopSearch:t.findPartner,()=>{
   if(enhanced){lobbyMessage='';void act(searching?{action:'stop_search'}:{action:'search',gender:preference,level:'any'});}
   else{void refresh();workspace.querySelector('[data-partner-list]')?.focus();}
  },searching?'btn-secondary lp-find':'btn-primary lp-find',
  {'data-partner-focus':'find','data-partner-find':'',disabled:Boolean(enhanced&&(busy||!data.realtime?.ready||state()!=='available'))});
  const chooser=el('section',{class:'lp-picker card'},el('div',{class:'lp-section-head'},el('h2',{},t.pickPartner),number),
   el('p',{class:'lp-caption'},t.gender),choices,find,
   searching||lobbyMessage?el('p',{role:'status'},searching?u.searching:lobbyMessage):null);
  const list=el('section',{class:'lp-list card','data-partner-list':'',tabindex:'-1','aria-label':t.onlineUsers},
   el('div',{class:'lp-section-head'},el('h2',{},t.onlineUsers),el('span',{class:'lp-online-count'},String(matching.length))));
  if(!matching.length)list.append(el('p',{class:'lp-empty'},data?(online.length?t.noMatchingPartners:t.nobodyOnline):t.loading));
  for(const person of matching){
   const gender=person.gender??(person.avatar==='b'?'female':'male');
   list.append(el('article',{class:'lp-online-person'},avatar(person,t),el('div',{class:'lp-person'},el('strong',{},person.name),
    el('small',{},[t.preferences[gender],person.level,person.speakingScore==null?null:score(person.speakingScore),
     person.rating==null?null:'★ '+person.rating.toFixed(1),person.availability==='busy'?'Busy':'Online'].filter(Boolean).join(' · '))),dial(person)));
  }
  return [chooser,list];
 }
 function draw(){if(destroyed||!me)return;
  // A 4-second presence poll must not throw away a learner's text caret or
  // keyboard focus just because the native DOM implementation redraws a panel.
  const activeElement=document.activeElement;
  const activeSearch=activeElement?.tagName==='INPUT'&&activeElement.type==='search'&&workspace.contains(activeElement);
  const selection=activeSearch?{from:activeElement.selectionStart,to:activeElement.selectionEnd}:null;
  const activeDialog=activeElement?.closest?.('[role="dialog"]');
  const activeDialogIndex=activeDialog?[...activeDialog.querySelectorAll('button:not([disabled])')].indexOf(activeElement):-1;
  const activeControl=workspace.contains(activeElement)?activeElement.dataset.partnerFocus:null;
  const listFocused=activeElement?.hasAttribute('data-partner-list');
  drawCallNotice();sound.sync(flow==='none'&&!busy?data?.incoming?.id:null);
  const existingMatch=workspace.querySelector('[data-partner-searching]');
  if(existingMatch&&data?.features?.searchUntil&&!data?.incoming&&!data?.outgoing&&!active()&&!error&&data.realtime?.ready){
   const count=(data.online??[]).filter(person=>person.canCall!==false).length;
   const counter=existingMatch.querySelector('[data-search-online]');if(counter)counter.textContent=String(count);
   paintClock();return;
  }
  const previousHistory=workspace.querySelector('[data-partner-history]');if(previousHistory)historyOpen=previousHistory.open;
  workspace.dataset.livePartnerState=state();workspace.replaceChildren();
  const inCall=active()&&Boolean(data?.partner);
  host.dataset.partnerView=inCall?'call':'lobby';
  if(error)workspace.append(el('p',{role:'alert',class:'rounded-sm border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800'},error));
  if(data&&!data.realtime?.ready)workspace.append(el('p',{'data-realtime-unavailable':'',class:'rounded-sm border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900'},t.realtimeMissing));
  const grid=el('div',{class:'lp-call-grid'});
  const mePanel=el('section',{class:'lp-panel lp-self card','data-partner-self':''},
   inCall?el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.you):null,
   avatar(me,t,inCall),el('div',{class:'lp-person'},el('strong',{},me.name),el('small',{},t.states[state()]??'')));
  if(me.speakingScore!=null)mePanel.append(el('span',{class:'lp-online-count'},score(me.speakingScore)));
  
  mePanel.append(button(t.micTitle,()=>void microphone(),'btn-secondary',{disabled:busy||active()?'':null}));
  if(data?.realtime?.ready&&!data.rulesAccepted)mePanel.append(button(t.rulesTitle,()=>{flow='rules';draw();}));
  if(data?.realtime?.ready&&data.rulesAccepted&&me.hasGender&&state()==='offline')mePanel.append(button(t.goOnline,()=>void act({action:'go_online'}),'btn-primary',{disabled:busy?'':null}));
  if(active())mePanel.append(button(micMuted?t.unmuteMic:t.muteMic,()=>{micMuted=!micMuted;call?.setMuted(micMuted);draw();},'btn-secondary',{'aria-pressed':String(micMuted)}));
  if(inCall){
  mePanel.append(el('meter',{min:0,max:1,value:0,'data-partner-meter':'local','aria-label':u.micSignal}));
  const questionsPanel=el('section',{class:'lp-panel lp-questions flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4','data-partner-questions':''},el('h2',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},t.questions),el('p',{class:'text-xs text-ink-500'},t.questionsOptional));
  const activity=data.features?.activity,connected=state()==='in_call'&&callStatus==='connected';
  if(activity)questionsPanel.append(partnerActivity({activity,t:u,me:me.userId,sessionId:data.sessionId,connected,busy,act,button}));
  const searchInput=el('input',{type:'search',value:query,placeholder:t.search,class:'w-full rounded-sm border border-ink-200 px-3 py-2'});
  listen(searchInput,'input',()=>{query=searchInput.value;selectedTopic=null;clearTimeout(searchTimer);searchTimer=setTimeout(()=>void search(),250);},signal);questionsPanel.append(searchInput);
  questionsPanel.append(el('p',{role:'status','aria-live':'polite','data-partner-search-state':searchState,class:'text-xs text-ink-500'},searchState==='loading'?t.searchSearching:searchState==='error'?t.searchFailed:searchState==='empty'?t.noQuestions:''));
  if(searchState==='error')questionsPanel.append(button(t.searchRetry,()=>void search(),'btn-ghost btn-sm self-start',{'data-partner-search-retry':''}));
  if(searchCursor&&searchState==='success')questionsPanel.append(button(t.searchMore,()=>void search(true),'btn-ghost btn-sm self-start',{'data-partner-search-more':''}));
  const pool=remoteQuestions??questions;
  if(selectedTopic){const list=topicQuestions,q=list[Math.min(qIndex,list.length-1)];
   if(topicLoading&&!list.length)questionsPanel.append(el('p',{role:'status'},dict.common.loading));
   if(q){const card=el('article',{class:'flex min-h-80 flex-col gap-5 rounded-2xl border border-ink-100 bg-paper-raised p-5','data-partner-topic-question':''},button('← '+dict.common.back,()=>{selectedTopic=null;draw();},'btn-secondary self-start'),el('h3',{class:'font-display text-xl'},selectedTopic.topic??dict.speakingStudy.topic),el('p',{class:'whitespace-pre-line text-lg'},q.promptText),q.cueCard?el('p',{class:'whitespace-pre-line text-ink-700'},q.cueCard):null,
     el('div',{class:'mt-auto flex flex-wrap items-center justify-between gap-2'},el('span',{},`${qIndex+1} / ${list.length}`),button(t.nextQuestion+' →',()=>{qIndex++;draw();},'btn-primary',{disabled:qIndex+1>=list.length?'':null})));
    if(activity)card.append(button(u.shareQuestion,()=>void act({action:'activity_start',kind:'question',sessionId:data.sessionId,version:activity.version,questionId:q.id}),'btn-secondary',{disabled:!connected||busy}));
    questionsPanel.append(card);if(topicCursor&&!topicLoading)questionsPanel.append(button(t.searchMore,()=>void loadTopic(selectedTopic.part,selectedTopic.topic,true),'btn-secondary'));}
  }else for(const part of PARTS){const matches=pool.filter(q=>q.part===part&&(!query.trim()||(`${q.topic??''} ${q.promptText}`).toLowerCase().includes(query.toLowerCase())));const byTopic=new Map(query.trim()?matches.map(q=>[q.topic,{key:q.topic,title:q.topic}]):topicsByPart[part].map(t=>[t.key,t]));
    const wrap=el('section',{class:'practice-part-card relative overflow-hidden rounded-2xl border border-ink-100','data-practice-part':part});
    const expanded=query.trim().length>0||open===part;wrap.append(button('',()=>{open=open===part?null:part;draw();},'relative flex min-h-28 w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium',{'aria-expanded':String(expanded),'aria-controls':`lp-${part}`}));
    wrap.firstChild.append(el('span',{class:'font-display text-xl font-bold'},t.parts[part]),el('span',{class:'text-xs text-ink-500'},String(byTopic.size)));
    if(expanded){const list=el('ul',{id:`lp-${part}`,class:'max-h-96 space-y-2 overflow-y-auto border-t border-ink-100 p-3'});for(const [name,topicRow] of byTopic)list.append(el('li',{},button((topicRow.title??name??dict.speakingStudy.topic)+' →',()=>{selectedTopic={part,topic:name};qIndex=0;void loadTopic(part,name);},'btn-secondary w-full justify-between text-left')));if(!byTopic.size)list.append(el('li',{class:'text-sm text-ink-500'},t.noQuestions));wrap.append(list);}questionsPanel.append(wrap);
  }
   const side=el('section',{class:'lp-panel lp-peer card','data-partner-peer':''},el('h2',{},t.partner),avatar(data.partner,t,true),el('strong',{},data.partner.name),
    el('p',{'data-call-status':callStatus??'connecting',role:'status'},t.callStates[callStatus==='connected'?'connected':callStatus==='reconnecting'?'reconnecting':'connecting']),
    el('meter',{min:0,max:1,value:0,'data-partner-meter':'remote','aria-label':u.peerSignal}),
    peerMuted?el('p',{},u.peerMuted):null,playbackBlocked?button(u.tapAudio,()=>void playAudio(),'btn-primary'):null,
    button(remoteMuted?t.unmutePartner:t.mutePartner,()=>{remoteMuted=!remoteMuted;remoteAudio.muted=remoteMuted;draw();},'btn-secondary',{'aria-pressed':String(remoteMuted)}),
    button(t.endCall,()=>void endCall(),'btn-danger'),button(t.block,()=>void endCall(data.partner.userId),'btn-ghost btn-sm'));
   grid.append(mePanel,questionsPanel,side);workspace.append(grid);paintClock();media.paint();void loadTopics();
  }else{

   const stats=history?.stats??{calls:0,seconds:0};
   const friends=history?.friends??[],recent=history?.recent??[];
   const mockResults=recent.filter(entry=>Boolean(entry.mock));
   const mocksGiven=Number(history?.stats?.mocksGiven??0),mocksTaken=Number(history?.stats?.mocksTaken??0);
   const summary=el('section',{class:'lp-summary card','data-partner-summary':''},
    el('div',{class:'lp-summary-heading'},el('h1',{},'Speaking Partner'),
     button((me.gender==='female'?'Female':me.gender==='male'?'Male':'Not set')+' · '+(me.level??'Any level')+'   Change',()=>{profileDraftGender=me.gender??'male';profileDraftLevel=me.level??'B1';flow='profile';draw();},'lp-summary-profile',{'data-partner-change-profile':'','aria-label':'Change gender and level'})),
    el('div',{class:'lp-stat-grid'},
     ...[[String(stats.calls??0),'Talks','🎙️'],[Math.floor(Number(stats.seconds??0)/60)+'m','Talk time','⏱️'],
     [String(friends.filter(friend=>friend.state==='accepted').length),'Friends','👥'],
     [mocksTaken+' · '+mocksGiven,'Mocks','⭐']].map(([value,label,icon])=>
      el('div',{class:'lp-stat'},el('span',{class:'lp-stat-icon','aria-hidden':'true'},icon),
       el('div',{},el('strong',{},value),el('small',{},label))))));
   if(data?.features?.searchUntil&&!data?.incoming&&!data?.outgoing){workspace.append(renderMatchmaking());return;}
   workspace.append(summary);
   const tabs=[['find','Find',data?.online?.length??0],['recent','Recent',recent.length],
    ['friends','Friends',friends.filter(friend=>friend.state==='accepted').length],['mocks','Mocks',mocksTaken+mocksGiven]];
   workspace.append(el('nav',{class:'lp-tabs',role:'tablist','aria-label':'Speaking Partner'},
    ...tabs.map(([id,label,count])=>button(label+'  '+count,()=>{
     lobbyTab=id;if(id!=='find'&&!historyRequested)void refreshHistory();draw();
    },'lp-tab',{'data-partner-focus':'tab-'+id,'data-partner-tab':id,role:'tab','aria-selected':String(lobbyTab===id)}))));
   if(lobbyTab==='find')workspace.append(mePanel,...partnerLobby());
   else if(data?.features?.enabled)workspace.append(partnerHistory({t:u,history,busy,act:historyAction,
    reload:()=>void refreshHistory(),call:dial,online:data.online??[],button,tab:lobbyTab}));
   else workspace.append(el('p',{class:'lp-empty'},u.upgrade));
  }
  if(flow!=='none'){
   const overlay=el('div',{class:'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'}),dialog=el('div',{role:'dialog','aria-modal':'true',class:'w-full max-w-md rounded-lg bg-paper p-5 shadow-lg'});
   overlay.append(dialog);overlay.addEventListener('mousedown',e=>{if(e.target===overlay)closeFlow();});
   if(flow==='profile'){
    const gender=el('select',{class:'input','aria-label':'Gender','data-partner-profile-gender':''},
      ...[['male','Male'],['female','Female']].map(([value,label])=>el('option',{value,selected:profileDraftGender===value},label)));
    const selectedLevel=el('select',{class:'input','aria-label':'English level','data-partner-profile-level':''},
      ...['A1','A2','B1','B2','C1','C2'].map(value=>el('option',{value,selected:profileDraftLevel===value},value)));
    gender.addEventListener('change',()=>{profileDraftGender=gender.value;});
    selectedLevel.addEventListener('change',()=>{profileDraftLevel=selectedLevel.value;});
    dialog.append(el('h2',{},'Speaking Partner profili'),
     el('label',{class:'lp-profile-field'},'Jins',gender),
     el('label',{class:'lp-profile-field'},'Daraja',selectedLevel),
     el('div',{class:'lp-profile-actions'},
      button(t.close,closeFlow,'btn-secondary'),
      button(profileSaving?'Saqlanmoqda...':'Saqlash',async()=>{
       if(profileSaving)return;
       profileSaving=true;
       try{
        const response=await fetch('/api/live-partner/profile',{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({gender:profileDraftGender,level:profileDraftLevel}),signal});
        if(!response.ok)throw Error('profile_save_failed');
        const updated=await response.json();
        me.gender=updated.gender;me.level=updated.level;me.hasGender=true;me.avatar=updated.gender==='female'?'b':'a';error='';closeFlow();
       }catch{error='Profilni saqlashda xatolik yuz berdi.';draw();}
       finally{profileSaving=false;}
      },'btn-primary',{'data-partner-profile-save':'',disabled:profileSaving})));
   }else if(flow==='rules')dialog.append(el('h2',{class:'font-display text-lg'},t.rulesTitle),el('ul',{class:'my-3 list-disc pl-5 text-sm text-ink-700'},(t.rules??[]).map(rule=>el('li',{},rule))),el('div',{class:'flex justify-end gap-2'},button(t.close,closeFlow),button(t.agree,()=>void agree(),'btn-primary',{disabled:busy?'':null})));
   else dialog.append(el('h2',{class:'font-display text-lg'},t.micTitle),el('p',{class:'my-2 text-sm text-ink-600'},t.micBody),el('div',{class:'h-3 w-full overflow-hidden rounded-full bg-ink-100',role:'meter','aria-label':t.micLevel,'aria-valuemin':0,'aria-valuemax':100},el('div',{'data-live-mic-meter':'',class:'h-full bg-emerald-500'})),el('p',{class:'mt-2 text-xs text-ink-600',role:'status'},t.mic[micState]),el('div',{class:'mt-4 flex justify-end gap-2'},button(t.close,closeFlow),['denied','missing','error'].includes(micState)?button(t.retryMic,()=>void microphone()):null,button(t.micReady,closeFlow,'btn-primary',{disabled:micState!=='ok'||busy?'':null})));
   workspace.append(overlay);const choices=[...dialog.querySelectorAll('button:not([disabled])')];
   (activeDialogIndex>=0?choices[Math.min(activeDialogIndex,choices.length-1)]:choices[0])?.focus({preventScroll:true});
  }
  if(activeSearch&&flow==='none'){
   const replacement=workspace.querySelector('input[type="search"]');
   if(replacement){replacement.focus({preventScroll:true});
    try{replacement.setSelectionRange(selection.from,selection.to);}catch{}}
  }
  if(flow==='none'&&activeControl)[...workspace.querySelectorAll('[data-partner-focus]:not([disabled])')].find(node=>node.dataset.partnerFocus===activeControl)?.focus({preventScroll:true});
  if(flow==='none'&&listFocused)workspace.querySelector('[data-partner-list]')?.focus({preventScroll:true});
 }
 async function init(){try{const d=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;if(d.kind!=='speaking_live_partner'||!d.me||!Array.isArray(d.questions))throw Error('invalid_live_partner_view');me=d.me;questions=d.questions;partnerOutsideRoom(me.userId,false);draw();void refresh();void refreshHistory();}catch{if(!signal.aborted)workspace.replaceChildren(RegionFailureNotice({region:'speaking-live-partner',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:init}));}}
 const runPoll=()=>{if(!destroyed&&me&&(document.visibilityState==='visible'||state()!=='offline'))void refresh();later(runPoll,POLL);};later(runPoll,POLL);
 const runBeat=()=>{if(!destroyed&&state()!=='offline'&&!heartbeat){heartbeat=true;void request({action:'heartbeat'},AbortSignal.timeout(TIMEOUT)).catch(()=>{}).finally(()=>{heartbeat=false;});}later(runBeat,BEAT);};later(runBeat,BEAT);
 void init();
}
