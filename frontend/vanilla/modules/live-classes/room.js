import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {viewData} from '../../js/adapters/frontend.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
import {
 parseLiveClassDetail,
 liveEmbedUrl,
 localDate,
 localTime,
 minutesFromSeconds,
 newAttendanceSessionId,
} from './contract.js';
import {resourceBlocks} from './resources.js';

const YOUTUBE_ORIGINS=new Set(['https://www.youtube.com','https://www.youtube-nocookie.com']);
const HEARTBEAT_INTERVAL_MS=30000;

const CHAT_PAGE_LIMIT=50;
const CHAT_MAX_SYNC_PAGES=50;

function chatTimestampSortKey(value){
 // The server serializes chat timestamps as UTC with six fractional digits.
 // Date.parse() discards microseconds, so never use it as the sole ordering key.
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(String(value||''));
 return match?`${match[1]}.${(match[2]||'').padEnd(6,'0')}Z`:null;
}

function compareMessages(a,b){
 const keyA=chatTimestampSortKey(a?.createdAt),keyB=chatTimestampSortKey(b?.createdAt);
 if(keyA&&keyB&&keyA!==keyB)return keyA<keyB?-1:1;
 const ta=Date.parse(a?.createdAt||''),tb=Date.parse(b?.createdAt||'');
 if(Number.isFinite(ta)&&Number.isFinite(tb)&&ta!==tb)return ta-tb;
 return String(a?.id||'').localeCompare(String(b?.id||''));
}

function statusBadgeClass(lifecycle){
 if(lifecycle==='live')return 'badge-live';
 if(lifecycle==='recording_ready'||lifecycle==='recorded')return 'badge-done';
 if(lifecycle==='recording_processing')return 'badge-gold';
 return 'badge bg-signal-100 text-signal-700';
}

function createYoutubePlayer(ctx,lesson,embedOrigin){
 const {dict,signal}=ctx,t=dict.liveClasses;
 const isRecording=lesson.lifecycleStatus==='recording_ready'||lesson.status==='recorded';
 const origin=typeof window!=='undefined'&&window.location?.origin?.startsWith('http')?window.location.origin:embedOrigin;
 const src=liveEmbedUrl(lesson.youtubeVideoId,{origin,controls:isRecording?1:0});

 const stageWrap=el('div',{class:'flex flex-col gap-2','data-live-player-wrap':''});
 const frameContainer=el('div',{class:'relative aspect-video w-full overflow-hidden rounded-xl border border-ink-100 bg-ink-950','data-live-video-container':''});
 const iframe=el('iframe',{
  src,
  title:lesson.title,
  class:'absolute inset-0 h-full w-full',
  allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
  allowfullscreen:'',
  referrerpolicy:'strict-origin-when-cross-origin',
  'data-live-youtube-iframe':lesson.youtubeVideoId,
 });
 frameContainer.append(iframe);

 const errorBanner=el('div',{role:'alert',class:'card border-band-bad/40 p-3 text-sm text-band-bad','data-live-player-error':''});
 errorBanner.hidden=true;

 let playing=false,muted=false,volume=100,disposed=false;
 function sendCommand(func,args=[]){
  if(disposed)return;
  try{
   iframe.contentWindow?.postMessage(JSON.stringify({event:'command',func,args}),'*');
  }catch{}
 }

 const playBtn=el('button',{type:'button',class:'btn-secondary btn-sm','data-player-play-pause':'','aria-label':t.playPause||'Play / Pause'},t.playPause||'Play / Pause');
 const muteBtn=el('button',{type:'button',class:'btn-ghost btn-sm','data-player-mute':'','aria-label':t.muteToggle||'Mute / Unmute'},t.muteToggle||'Mute / Unmute');
 const volInput=el('input',{type:'range',min:'0',max:'100',value:'100',class:'w-24 accent-signal-600','aria-label':t.volume||'Volume','data-player-volume':''});
 const fsBtn=el('button',{type:'button',class:'btn-ghost btn-sm ml-auto','data-player-fullscreen':'','aria-label':t.fullscreen||'Fullscreen'},t.fullscreen||'Fullscreen');

 listen(playBtn,'click',()=>{
  if(playing){sendCommand('pauseVideo');playing=false;}
  else{sendCommand('playVideo');playing=true;}
 },signal);

 listen(muteBtn,'click',()=>{
  if(muted){sendCommand('unMute');muted=false;}
  else{sendCommand('mute');muted=true;}
 },signal);

 listen(volInput,'input',()=>{
  volume=Number(volInput.value)||0;
  sendCommand('setVolume',[volume]);
  if(volume>0&&muted){sendCommand('unMute');muted=false;}
 },signal);

 listen(fsBtn,'click',()=>{
  const target=frameContainer;
  if(target.requestFullscreen){void target.requestFullscreen().catch(()=>{});}
 },signal);

 const controlsBar=el('div',{class:'card flex flex-wrap items-center gap-2 p-2.5','data-live-player-controls':''},
  playBtn,muteBtn,
  el('label',{class:'flex items-center gap-1.5 text-xs text-ink-500'},el('span',{},t.volume||'Volume'),volInput),
  fsBtn);

 const initBridge=()=>{
  if(disposed)return;
  try{
   iframe.contentWindow?.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*');
   sendCommand('addEventListener',['onStateChange']);
   sendCommand('addEventListener',['onError']);
  }catch{}
 };

 listen(iframe,'load',()=>{initBridge();},signal);
 listen(iframe,'error',()=>{
  if(disposed)return;
  errorBanner.textContent=t.playerError;
  errorBanner.hidden=false;
 },signal);

 if(typeof window!=='undefined'){
  listen(window,'message',ev=>{
   if(disposed||ev.source!==iframe.contentWindow||!YOUTUBE_ORIGINS.has(ev.origin))return;
   let payload;
   try{payload=typeof ev.data==='string'?JSON.parse(ev.data):ev.data;}catch{return;}
   if(!payload||typeof payload!=='object')return;
   if(payload.event==='onStateChange'){
    if(payload.info===1){playing=true;errorBanner.hidden=true;}
    else if(payload.info===2||payload.info===0){playing=false;}
   }else if(payload.event==='onError'){
    const code=Number(payload.info);
    if(code===100||code===101||code===150){
     errorBanner.textContent=t.embedDisabled||t.playerError;
    }else{
     errorBanner.textContent=t.playerError;
    }
    errorBanner.hidden=false;
   }
  },signal);
 }

 stageWrap.append(frameContainer,controlsBar,errorBanner);

 function destroy(){
  if(disposed)return;
  try{
   sendCommand('stopVideo');
  }catch{}
  disposed=true;
  try{
   iframe.removeAttribute('src');
   iframe.remove();
  }catch{}
 }
 signal.addEventListener('abort',destroy,{once:true});
 return {node:stageWrap,destroy};
}

function createStateBanner(ctx,lesson){
 const {dict,locale}=ctx,t=dict.liveClasses;
 const lc=lesson.lifecycleStatus;
 if(lc==='scheduled'||lesson.status==='upcoming'){
  return el('div',{class:'card flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center','data-live-waiting-state':''},
   el('span',{class:'badge bg-signal-100 text-signal-700'},t.status.scheduled||t.status.upcoming),
   el('h2',{class:'font-display text-xl text-ink-900'},t.waitingTitle),
   el('p',{class:'max-w-xl text-sm text-ink-500'},t.waitingBody),
   el('p',{class:'text-xs font-medium text-ink-700'},`${t.scheduled}: ${localDate(lesson.scheduledAt,locale)} · ${t.opensAt} ${localDate(lesson.opensAt,locale)}`));
 }
 if(lc==='recording_processing'){
  return el('div',{class:'card flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center','data-live-processing-state':''},
   el('span',{class:'badge-gold'},t.status.recording_processing),
   el('h2',{class:'font-display text-xl text-ink-900'},t.streamEnded),
   el('p',{class:'max-w-xl text-sm text-ink-500'},t.recordingProcessing));
 }
 if(lc==='recording_unavailable'){
  return el('div',{class:'card flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center','data-live-unavailable-state':''},
   el('span',{class:'badge bg-ink-100 text-ink-700'},t.status.recording_unavailable),
   el('h2',{class:'font-display text-xl text-ink-900'},t.streamEnded),
   el('p',{class:'max-w-xl text-sm text-ink-500'},t.recordingUnavailable));
 }
 if(lc==='ended'||lesson.status==='completed'){
  return el('div',{class:'card flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center','data-live-ended-state':''},
   el('span',{class:'badge bg-ink-100 text-ink-700'},t.status.ended||t.status.completed),
   el('h2',{class:'font-display text-xl text-ink-900'},t.streamEnded),
   el('p',{class:'max-w-xl text-sm text-ink-500'},t.recordingProcessing));
 }
 return el('div',{class:'card flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center','data-live-invalid-video':''},
  el('p',{class:'text-sm text-band-warn',role:'alert'},t.invalidVideoId));
}

function createLiveChatPanel(ctx,detail,onClassStatusChange){
 const {dict,locale,signal}=ctx,t=dict.liveClasses;
 const lesson=detail.liveClass;
 const canModerate=detail.canModerate;
 let chatReadOnly=lesson.chatReadOnly;
 let hasMore=detail.chat.hasMore;
 let nextBefore=detail.chat.nextBefore;
 let loadingOlder=false,sending=false,errorMsg='',destroyed=false;
 let syncingMessages=false,syncQueued=false;
 let ws=null,reconnectTimer=0,reconnectAttempts=0;

 const messagesMap=new Map();
 for(const m of detail.chat.messages)messagesMap.set(m.id,m);

 const connBadge=el('span',{class:'text-xs text-ink-500','data-chat-connection-state':'connecting'},t.chatConnected||'Connected');
 const header=el('div',{class:'flex items-center justify-between border-b border-ink-100 pb-3'},
  el('h2',{class:'font-display text-lg text-ink-900'},t.chatTitle||'Live Chat'),
  connBadge);

 const loadOlderBtn=el('button',{type:'button',class:'btn-ghost btn-sm w-full text-xs','data-chat-load-older':''},t.chatLoadOlder||'Load older messages');
 loadOlderBtn.hidden=!hasMore;

 const listEl=el('ul',{class:'flex max-h-96 min-h-64 flex-1 flex-col gap-2 overflow-y-auto py-2','data-live-chat-messages':'',role:'log','aria-live':'polite'});
 const errorEl=el('p',{role:'alert',class:'text-xs text-band-bad','data-live-chat-error':''});
 errorEl.hidden=true;

 const inputEl=el('input',{
  type:'text',
  maxlength:'500',
  placeholder:t.chatPlaceholder||'Write a question or message...',
  class:'input flex-1',
  'aria-label':t.chatTitle||'Live Chat',
  'data-live-chat-input':'',
 });
 const sendBtn=el('button',{type:'submit',class:'btn-primary btn-sm','data-live-chat-send':''},t.chatSend||'Send');
 const formEl=el('form',{class:'flex items-center gap-2 pt-2','data-live-chat-form':''},inputEl,sendBtn);
 const readOnlyNote=el('p',{class:'pt-2 text-xs text-ink-500','data-live-chat-readonly':''},t.chatReadOnly);

 function syncReadOnlyUI(){
  formEl.hidden=chatReadOnly;
  inputEl.disabled=chatReadOnly||sending;
  sendBtn.disabled=chatReadOnly||sending;
  readOnlyNote.hidden=!chatReadOnly;
 }

 function renderMessages(scrollToBottom=false){
  if(destroyed||signal.aborted)return;
  const sorted=[...messagesMap.values()].sort(compareMessages);
  loadOlderBtn.hidden=!hasMore;
  if(sorted.length===0){
   listEl.replaceChildren(el('li',{class:'py-8 text-center text-xs text-ink-500','data-live-chat-empty':''},t.chatEmpty));
   return;
  }
  const nodes=sorted.map(m=>{
   const isTeacher=m.senderRole==='teacher'||m.senderRole==='owner'||m.senderRole==='admin';
   const roleBadge=isTeacher?el('span',{class:'badge bg-signal-100 text-signal-700 text-[10px]'},t.teacher):null;
   let delBtn=null;
   if(canModerate){
    delBtn=el('button',{type:'button',class:'text-xs text-band-bad hover:underline','data-chat-delete':m.id},t.chatDelete||'Delete');
    listen(delBtn,'click',async()=>{
     if(destroyed||signal.aborted)return;
     try{
      await api.request(`/api/live-classes/${lesson.id}/chat/${m.id}`,{method:'DELETE',signal});
      messagesMap.delete(m.id);
      renderMessages(false);
     }catch{}
    },signal);
   }
   return el('li',{class:'rounded-lg border border-ink-100 bg-paper p-2.5','data-chat-message':m.id},
    el('div',{class:'flex items-center justify-between gap-2'},
     el('div',{class:'flex items-center gap-1.5 min-w-0'},
      el('strong',{class:'truncate text-xs font-semibold text-ink-900','data-chat-sender':''},m.senderName),
      roleBadge),
     el('div',{class:'flex items-center gap-2 shrink-0'},
      el('span',{class:'text-[11px] text-ink-300','data-chat-time':''},localTime(m.createdAt,locale)),
      delBtn)),
    el('p',{class:'mt-1 break-words text-sm text-ink-900','data-chat-body':''},m.body));
  });
  listEl.replaceChildren(...nodes);
  if(scrollToBottom){
   try{listEl.scrollTop=listEl.scrollHeight;}catch{}
  }
 }

 listen(loadOlderBtn,'click',async()=>{
  if(loadingOlder||!hasMore||!nextBefore||destroyed||signal.aborted)return;
  loadingOlder=true;loadOlderBtn.disabled=true;
  try{
   const res=await api.request(`/api/live-classes/${lesson.id}/chat?before=${encodeURIComponent(nextBefore)}&limit=${CHAT_PAGE_LIMIT}`,{signal});
   if(destroyed||signal.aborted)return;
   if(Array.isArray(res?.messages)){
    for(const m of res.messages)messagesMap.set(m.id,m);
   }
   hasMore=Boolean(res?.hasMore);
   nextBefore=typeof res?.nextBefore==='string'?res.nextBefore:null;
   renderMessages(false);
  }catch{}finally{
   loadingOlder=false;loadOlderBtn.disabled=false;
  }
 },signal);

 listen(formEl,'submit',async e=>{
  e.preventDefault();
  if(sending||chatReadOnly||destroyed||signal.aborted)return;
  const text=inputEl.value.trim();
  if(!text)return;
  if(text.length>500){
   errorMsg=dict.errors?.unknown||'Message too long (max 500 characters).';
   errorEl.textContent=errorMsg;errorEl.hidden=false;
   return;
  }
  sending=true;errorMsg='';errorEl.hidden=true;syncReadOnlyUI();
  try{
   const res=await api.request(`/api/live-classes/${lesson.id}/chat`,{
    method:'POST',
    body:{body:text},
    signal,
   });
   if(destroyed||signal.aborted)return;
   if(res?.message&&res.message.id){
    messagesMap.set(res.message.id,res.message);
    inputEl.value='';
    renderMessages(true);
   }
  }catch(err){
   if(destroyed||signal.aborted)return;
   if(err?.status===429||err?.code==='rate_limited'){
    errorMsg=t.chatRateLimited||'Please wait 2 seconds between messages.';
   }else if(err?.code==='chat_closed'){
    chatReadOnly=true;
    errorMsg=t.chatReadOnly;
   }else{
    errorMsg=dict.common?.error||'Could not send message.';
   }
   errorEl.textContent=errorMsg;
   errorEl.hidden=false;
  }finally{
   sending=false;syncReadOnlyUI();
  }
 },signal);

 async function catchUpMessages(){
  if(destroyed||signal.aborted)return;
  if(syncingMessages){
   syncQueued=true;
   return;
  }
  syncingMessages=true;
  try{
   do{
    syncQueued=false;
    const sorted=[...messagesMap.values()].sort(compareMessages);
    const last=sorted.length?sorted[sorted.length-1]:null;
    let cursor=last?`${last.createdAt}|${last.id}`:null;
    let pages=0;
    while(!destroyed&&!signal.aborted&&pages<CHAT_MAX_SYNC_PAGES){
     pages++;
     const q=cursor?`?after=${encodeURIComponent(cursor)}&limit=${CHAT_PAGE_LIMIT}`:`?limit=${CHAT_PAGE_LIMIT}`;
     const res=await api.request(`/api/live-classes/${lesson.id}/chat${q}`,{signal});
     if(destroyed||signal.aborted||!res)break;
     if(typeof res.chatReadOnly==='boolean'){chatReadOnly=res.chatReadOnly;syncReadOnlyUI();}
     const batch=Array.isArray(res.messages)?res.messages:[];
     if(batch.length){
      for(const m of batch){
       if(m&&m.id)messagesMap.set(m.id,m);
      }
      renderMessages(true);
     }
     if(!res.hasMore||batch.length===0)break;
     const lastBatch=batch[batch.length-1];
     const nextCursor=(typeof res.nextAfter==='string'&&res.nextAfter)?res.nextAfter:((typeof res.nextCursor==='string'&&res.nextCursor)?res.nextCursor:(lastBatch?`${lastBatch.createdAt}|${lastBatch.id}`:null));
     if(!nextCursor||nextCursor===cursor)break;
     cursor=nextCursor;
    }
   }while(syncQueued&&!destroyed&&!signal.aborted);
  }catch{}finally{
   syncingMessages=false;
  }
 }

 function closeSocket(){
  clearTimeout(reconnectTimer);
  reconnectTimer=0;
  if(ws){
   const prev=ws;
   ws=null;
   prev._disposed=true;
   try{prev.close();}catch{}
  }
 }

 function connectWebSocket(){
  if(destroyed||signal.aborted||typeof WebSocket==='undefined'||typeof window==='undefined')return;
  closeSocket();
  try{
   const proto=window.location.protocol==='https:'?'wss:':'ws:';
   const wsUrl=`${proto}//${window.location.host}/api/live-classes/${lesson.id}/ws`;
   const sock=new WebSocket(wsUrl);
   ws=sock;
   sock.addEventListener('open',()=>{
    if(destroyed||signal.aborted||sock._disposed||ws!==sock){try{sock.close();}catch{}return;}
    reconnectAttempts=0;
    connBadge.setAttribute('data-chat-connection-state','connected');
    connBadge.textContent=t.chatConnected||'Connected';
    void catchUpMessages();
   });
   sock.addEventListener('message',ev=>{
    if(destroyed||signal.aborted||sock._disposed||ws!==sock)return;
    let data;
    try{data=JSON.parse(ev.data);}catch{return;}
    if(!data||typeof data!=='object')return;
    if(data.type==='message'&&data.message?.id){
     messagesMap.set(data.message.id,data.message);
     renderMessages(true);
    }else if(data.type==='message_deleted'&&data.messageId){
     messagesMap.delete(data.messageId);
     renderMessages(false);
    }else if(data.type==='sync_required'){
     void catchUpMessages();
    }else if(data.type==='class_status'){
     if(typeof data.chatReadOnly==='boolean'){
      chatReadOnly=data.chatReadOnly;
      syncReadOnlyUI();
     }
     onClassStatusChange?.(data);
    }
   });
   const scheduleReconnect=ev=>{
    if(ws===sock)ws=null;
    if(destroyed||signal.aborted||sock._disposed)return;
    const closeCode=ev?.code;
    if(closeCode===4401||closeCode===4403||closeCode===4404){
     connBadge.setAttribute('data-chat-connection-state','disconnected');
     return;
    }
    connBadge.setAttribute('data-chat-connection-state','reconnecting');
    connBadge.textContent=t.chatReconnecting||'Reconnecting...';
    clearTimeout(reconnectTimer);
    const delay=Math.min(8000,1500*Math.pow(1.5,reconnectAttempts++));
    reconnectTimer=setTimeout(()=>{
     if(!destroyed&&!signal.aborted)connectWebSocket();
    },delay);
   };
   sock.addEventListener('close',scheduleReconnect);
   sock.addEventListener('error',()=>{try{sock.close();}catch{}});
  }catch{}
 }

 function destroy(){
  if(destroyed)return;
  destroyed=true;
  closeSocket();
 }

 signal.addEventListener('abort',destroy,{once:true});

 syncReadOnlyUI();
 renderMessages(true);
 connectWebSocket();

 const panel=el('aside',{class:'card flex flex-col gap-2 p-4','data-live-chat-panel':lesson.id},
  header,
  loadOlderBtn,
  listEl,
  errorEl,
  formEl,
  readOnlyNote);
 return {node:panel,catchUpMessages,destroy};
}

function startAttendanceTracker(ctx,lesson,roomJoinState){
 const {signal}=ctx;
 const isJoinable=lesson.status==='live'||lesson.joinState==='open';
 if(!isJoinable)return {destroy(){}};

 let stopped=false;
 let interval=0;

 async function sendPing(action){
  if(stopped&&action!=='leave')return;
  if(signal.aborted&&action!=='leave')return;
  try{
   if(action==='join'){
    await api.request(`/api/live-classes/${lesson.id}/join`,{method:'POST',body:{sessionId:roomJoinState.sessionId},signal});
   }else{
    await api.request(`/api/live-classes/${lesson.id}/attendance`,{
     method:'POST',
     body:{action,sessionId:roomJoinState.sessionId},
     ...(action==='leave'?{}:{signal}),
    });
   }
  }catch{}
 }

 if(!roomJoinState.joinedSent){
  roomJoinState.joinedSent=true;
  void sendPing('join');
 }
 interval=setInterval(()=>{
  if(stopped||signal.aborted){clearInterval(interval);return;}
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  void sendPing('heartbeat');
 },HEARTBEAT_INTERVAL_MS);

 function destroy({sendLeave=false}={}){
  if(stopped)return;
  stopped=true;
  clearInterval(interval);
  interval=0;
  if(sendLeave&&roomJoinState.joinedSent&&!roomJoinState.leaveSent){
   roomJoinState.leaveSent=true;
   void sendPing('leave');
  }
 }

 signal.addEventListener('abort',()=>destroy({sendLeave:false}),{once:true});
 return {destroy};
}

export async function mountRoom(ctx,classId){
 const {root,signal,dict,locale}=ctx,t=dict.liveClasses;
 const host=el('section',{
  'data-route-usable':'live-class-room',
  'data-live-class-room':classId,
  class:'mx-auto flex w-full max-w-7xl flex-col gap-5',
 });
 root.append(host);

 let activePlayer=null;
 let activeChat=null;
 let activeAttendance=null;
 let loadController=null;
 let loadGeneration=0;
 const roomJoinState={sessionId:newAttendanceSessionId(),joinedSent:false,leaveSent:false};

 function cleanupRoomResources({sendLeave=false}={}){
  if(activeAttendance){
   activeAttendance.destroy({sendLeave});
   activeAttendance=null;
  }
  if(activeChat){
   activeChat.destroy();
   activeChat=null;
  }
  if(activePlayer){
   activePlayer.destroy();
   activePlayer=null;
  }
  if(loadController){
   loadController.abort();
   loadController=null;
  }
 }

 signal.addEventListener('abort',()=>{
  cleanupRoomResources({sendLeave:true});
 },{once:true});

 async function load(){
  if(signal.aborted)return;
  const gen=++loadGeneration;
  cleanupRoomResources({sendLeave:false});
  const currentController=new AbortController();
  loadController=currentController;
  const loadSignal=currentController.signal;
  const childCtx={...ctx,signal:loadSignal};

  host.replaceChildren(
   el('div',{role:'status','aria-busy':'true','data-async-loading':'live-class-room',class:'flex flex-col gap-4'},
    el('div',{class:'h-8 w-48 animate-pulse rounded-lg bg-ink-50'}),
    el('div',{class:'aspect-video w-full animate-pulse rounded-xl bg-ink-50'}))
  );
  try{
   const raw=await viewData(`/app/live-classes/${classId}`,loadSignal,undefined,{fresh:gen>1});
   if(signal.aborted||loadSignal.aborted||gen!==loadGeneration)return;
   const detail=parseLiveClassDetail(raw);
   const lesson=detail.liveClass;

   activeAttendance=startAttendanceTracker(childCtx,lesson,roomJoinState);

   const playable=(lesson.status==='live'||lesson.lifecycleStatus==='recording_ready'||lesson.status==='recorded')&&Boolean(lesson.youtubeVideoId);
   let videoNode;
   if(playable){
    activePlayer=createYoutubePlayer(childCtx,lesson,detail.embedOrigin);
    videoNode=activePlayer.node;
   }else{
    videoNode=createStateBanner(childCtx,lesson);
   }

   activeChat=createLiveChatPanel(childCtx,detail,statusEvent=>{
    if(signal.aborted||loadSignal.aborted||gen!==loadGeneration)return;
    if(statusEvent?.status&&statusEvent.status!==lesson.status){
     void load();
    }
   });

   const recMins=minutesFromSeconds(lesson.recordingDurationSeconds)||lesson.durationMinutes;
   const teacherLabel=lesson.teacherName||t.teacher;
   const statusKey=lesson.lifecycleStatus&&t.status[lesson.lifecycleStatus]?lesson.lifecycleStatus:lesson.status;

   const header=el('header',{class:'flex flex-col gap-2'},
    BackLink({fallbackHref:'/app/live-classes',label:t.backToClasses||t.title,'data-live-back':''}),
    el('div',{class:'flex flex-wrap items-center justify-between gap-3'},
     el('h1',{class:'font-display text-2xl text-ink-900','data-live-room-title':''},lesson.title),
     el('span',{class:statusBadgeClass(statusKey),'data-live-room-status':statusKey},t.status[statusKey]||t.status[lesson.status])),
    el('p',{class:'text-sm text-ink-500','data-live-room-meta':''},
     `${teacherLabel} · ${localDate(lesson.scheduledAt,locale)} · ${recMins} ${dict.common.minutes}`));

   const detailsCard=el('section',{class:'card flex flex-col gap-2 p-5','data-live-room-details':''},
    el('h2',{class:'font-display text-lg text-ink-900'},t.lessonDetails||'Lesson details'),
    lesson.description?el('p',{class:'whitespace-pre-line text-sm text-ink-700'},lesson.description):el('p',{class:'text-sm text-ink-500'},`${teacherLabel} · ${localDate(lesson.scheduledAt,locale)}`));

   const materialsNode=resourceBlocks(childCtx,detail.materials);
   const leftCol=el('div',{class:'flex min-w-0 flex-col gap-4','data-live-room-main':''},
    videoNode,
    detailsCard,
    materialsNode);

   const grid=el('div',{class:'grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]','data-live-room-grid':''},
    leftCol,
    activeChat.node);

   host.replaceChildren(header,grid);
  }catch(e){
   if(signal.aborted||loadSignal.aborted||gen!==loadGeneration)return;
   cleanupRoomResources({sendLeave:false});
   if(e?.status===401){void ctx.navigate('/login',{replace:true});return;}
   const msg=e?.status===403?(dict.errors?.forbidden||'You do not have permission to access this live class.'):dict.auth.errorServer;
   host.replaceChildren(
    BackLink({fallbackHref:'/app/live-classes',label:t.backToClasses||t.title,'data-live-back':''}),
    RegionFailureNotice({region:'live-class-room',message:msg,retryLabel:dict.errorPage.retry,refresh:load})
   );
  }
 }

 void load();
}

export async function mount(ctx){
 const id=ctx.url.pathname.split('/').filter(Boolean).at(-1);
 return mountRoom(ctx,id);
}
