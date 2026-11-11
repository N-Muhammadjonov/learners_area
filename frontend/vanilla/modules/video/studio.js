import {el} from '../../js/dom.js';
import {embedUrlFor,safeEmbedOrigin,formatClock} from './provider.js';
import {createVideoVocabulary} from './vocabulary.js';
import packs from './study-pack-data.js';
import {videoProgressText} from '../shared/progress.js';

/** Shared TED / PODCAST player and learning materials. Description opens first.
 * Course lessons retain their existing existing lesson-notes panel; standalone
 * notes use the existing summaryText field without overwriting older responses.
 * Player listeners, requests and dialogs belong to the studio lifetime. */

const YOUTUBE_ORIGIN='https://www.youtube-nocookie.com';
const PROGRESS_STEP=5;      // at least 5 new watched seconds before a periodic write
const REQUEST_LIMIT=12000;  // every write gives up after 12 s
let studioSeq=0;

const tabClass=(active)=>`rounded-sm px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 ${active?'bg-signal-600 text-white':'bg-ink-100 text-ink-700 hover:bg-ink-200'}`;

/** `video`: { videoLesson, questions, progress, vocabulary, directMedia, embedOrigin } (video-v47.js videoStudioDTO). */
export function createVideoStudio(context,{mode,video}){
 const {dict,signal}=context,t=dict.videoLesson;
 const lesson=video.videoLesson,progress=video.progress;
 const isDirect=lesson.provider==='direct';
 const own=new AbortController(),life=own.signal;
 let destroyed=false;

 // ---- Derived content (same rules as the original useMemo blocks) ----
 const notes=(lesson.notes??'').trim();
 const timed=(lesson.transcript??[]).filter(line=>line.text.trim().length>0);
 const plain=(lesson.transcriptText??'').trim();
 const hasTranscript=timed.length>0||plain.length>0;
 const vocabWords=video.vocabulary.items;
 const normalize=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const glossary=mode==='standalone'&&vocabWords.length===0?packs.find(pack=>normalize(pack.title)===normalize(lesson.title))?.glossary:null;
 const tabs=['description','notes','vocabulary',...(mode==='standalone'?['ownNotes']:[]),...(hasTranscript?['transcript']:[])];
 const tabIdBase=`video-studio-${++studioSeq}`;

 // ---- Mutable state (plain variables: high-frequency player data never re-renders the tabs) ----
 let state=progress?.state??'not_started';
 let tab='description';
 let tracking=false, liveTime=null, blocked=false, playbackStarted=false, generation=0, finalizedGeneration=-1;
 let restartAt=progress&&progress.state!=='completed'&&Number.isFinite(progress.watchedSeconds)&&progress.watchedSeconds>=5?Math.floor(progress.watchedSeconds):0;
 let reported=progress?.watchedSeconds??0;
 let playbackDuration=lesson.durationSeconds>0?lesson.durationSeconds:null;
 let ownNotes=progress?.summaryText??'';
 let saving=false, requestError=false, savedResponse=null;
 let progressRequest=null, mutation=null;
 let frame=null, frameTeardown=null, directHandle=null, transcriptHandle=null, transcriptLoading=false, recorder=null;
 const panels=new Map();
 let panelRefs={saveButton:null,responseStatus:null};

 // ---- DOM skeleton (built once; only the visible panel and small status nodes change later) ----
 const section=el('section',{class:'video-studio','data-video-lesson':lesson.id,'data-video-state':state});
 const stage=el('div',{class:'overflow-hidden rounded-lg border border-ink-200 bg-ink-950','data-video-stage':''});
 const blockedNote=el('p',{class:'rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-800','data-video-blocked':''},t.blocked);
 blockedNote.hidden=true;
 const liveLabel=el('span',{class:'text-xs text-ink-500','data-video-live-transcript':'no'},t.liveTrackingOff);
 const stateLabel=el('span',{class:'text-xs font-medium text-ink-700','data-video-progress-state':''});
 const meta=el('div',{class:'flex flex-wrap items-center gap-2'},liveLabel,stateLabel);
 const tablist=el('div',{class:'flex flex-wrap gap-2',role:'tablist','aria-label':t.stagesLabel,'data-video-tablist':''});
 const requestErr=el('p',{role:'alert','data-video-request-error':''},dict.common.error);
 requestErr.hidden=true;
 const panel=el('div',{class:'motion-tab-panel rounded-lg border border-ink-200 bg-paper-50 p-4',role:'tabpanel',id:`${tabIdBase}-panel`,tabindex:'0','data-video-tabpanel':''});
 const tabButtons=new Map();
 const transcriptRegion=el('aside',{class:'video-transcript-region','data-video-transcript-region':'','aria-label':t.tabs.transcript});
 transcriptRegion.hidden=true;
 const mainColumn=el('div',{class:'video-player-column'},stage,blockedNote,meta,tablist,requestErr,panel);
 section.append(mainColumn,transcriptRegion);

 async function showTranscript(){
  if(!hasTranscript||transcriptLoading||transcriptHandle)return;
  transcriptLoading=true;
  try{
   const {createTranscriptPanel}=await import('./transcript-dialog.js');
   if(destroyed)return;
   const text=timed.length?timed.map(line=>`${formatClock(line.startSeconds)} ${line.text}`).join('\n'):plain;
   transcriptHandle=createTranscriptPanel({context:{...context,signal:life},id:lesson.id,text,dict,attribution:lesson.transcriptAttribution});
   transcriptRegion.replaceChildren(transcriptHandle.node);
  }catch{if(!destroyed){requestError=true;paint();}}
  finally{transcriptLoading=false;}
 }

 // The provider keeps its native playback/replay controls. No app overlay covers the video.
 const frameBox=el('div',{class:'relative aspect-video w-full'});

 function setState(next){
  if(typeof next!=='string')return;
  state=next;
  section.setAttribute('data-video-state',next);
  stateLabel.textContent=videoProgressText(next,reported,playbackDuration,next==='completed'?t.stateCompleted:next==='in_progress'?t.stateInProgress:t.stateNotStarted);
  if(panelRefs.responseStatus)panelRefs.responseStatus.setAttribute('data-video-response-verdict',next);
 }

 function setTracking(){
  if(tracking)return;
  tracking=true;
  liveLabel.setAttribute('data-video-live-transcript','yes');
  liveLabel.textContent=t.liveTrackingOn;
 }

 function postTo(node,payload){node.contentWindow?.postMessage(JSON.stringify(payload),YOUTUBE_ORIGIN);}

 function mountFrame(){
  unmountFrame();
  // The iframe API must target the actual HTTPS parent, even behind a proxy
  // whose server-side base URL reports HTTP.
  const src=embedUrlFor('youtube',lesson.videoId,{origin:safeEmbedOrigin(window.location.origin)??safeEmbedOrigin(video.embedOrigin),start:restartAt});
  const node=el('iframe',{
   src,title:lesson.title,loading:'lazy',class:'absolute inset-0 h-full w-full',
   // No popups or top navigation: provider links cannot take the learner out of this site.
   sandbox:'allow-scripts allow-same-origin allow-presentation',
   allow:'encrypted-media; picture-in-picture; fullscreen',allowfullscreen:'',
   referrerpolicy:'strict-origin-when-cross-origin','data-video-frame':'',
  });
  frame=node;
  const ctl=new AbortController();
  const ask=()=>{postTo(node,{event:'listening',id:1,channel:'widget'});postTo(node,{event:'command',func:'addEventListener',args:['onStateChange']});};
  let loadTimer=0;
  node.addEventListener('load',()=>{ask();clearTimeout(loadTimer);loadTimer=setTimeout(ask,600);},{signal:ctl.signal});
  node.addEventListener('error',()=>{blocked=true;blockedNote.hidden=false;},{signal:ctl.signal});
  const interval=setInterval(ask,5000);
  // Only the player's own window, on the fixed provider origin, may report position or end.
  window.addEventListener('message',event=>{
   if(event.source!==node.contentWindow||event.origin!==YOUTUBE_ORIGIN)return;
   let data;
   try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
   if(!data||typeof data!=='object')return;
   const info=data.info;
   if(!(lesson.durationSeconds>0)&&typeof info?.duration==='number'&&Number.isFinite(info.duration)&&info.duration>=1&&info.duration<=43200){
    playbackDuration=Math.ceil(info.duration);setState(state);
   }
   if(info&&typeof info.currentTime==='number'&&Number.isFinite(info.currentTime)&&info.currentTime>=0)onPosition(info.currentTime);
   const reachedEnd=(data.event==='onStateChange'&&data.info===0)||(data.event==='infoDelivery'&&info?.playerState===0);
   const playerState=data.event==='onStateChange'?data.info:info?.playerState;
   if(playerState===1){if(finalizedGeneration===generation)generation++;playbackStarted=true;}
   if(reachedEnd&&playbackStarted){flushFinalProgress();playbackStarted=false;}
  },{signal:ctl.signal});
  frameTeardown=()=>{ctl.abort();clearInterval(interval);clearTimeout(loadTimer);node.removeAttribute('src');node.remove();};
  frameBox.append(node);
 }
 function unmountFrame(){
  if(frameTeardown)frameTeardown();
  frameTeardown=null;frame=null;
 }
 // ---- Progress (monotonic, server-decided) ----
 function applyServer(body){
  if(!body||destroyed)return;
  if(typeof body.watchedSeconds==='number'&&Number.isFinite(body.watchedSeconds))reported=Math.max(reported,body.watchedSeconds);
  if(typeof body.durationSeconds==='number'&&Number.isFinite(body.durationSeconds)&&body.durationSeconds>0)playbackDuration=body.durationSeconds;
  if(typeof body.state==='string')setState(body.state);
 }
 function progressUrl(){return `/api/video-lessons/${lesson.id}/progress`;}
 function maybeSendProgress(){
  const seconds=liveTime;
  if(seconds===null||seconds-reported<PROGRESS_STEP||progressRequest)return;
  const ctl=new AbortController();
  progressRequest=ctl;
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  fetch(progressUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchedSeconds:seconds,...(playbackDuration?{durationSeconds:playbackDuration}:{})}),signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'})
   .then(res=>res.ok?res.json():null)
   .then(body=>{if(progressRequest!==ctl||ctl.signal.aborted)return;applyServer(body);})
   .catch(()=>{})
   .finally(()=>{clearTimeout(deadline);if(progressRequest===ctl)progressRequest=null;});
 }
 function onPosition(seconds){
  liveTime=seconds;
  setTracking();
  maybeSendProgress();
 }
 // One final write per playback generation. keepalive, and not cancelled by navigation or replay.
 function flushFinalProgress(){
  if(finalizedGeneration===generation)return;
  const duration=playbackDuration;
  const seconds=duration??liveTime??(reported>0?reported:null);
  if(seconds===null)return;
  finalizedGeneration=generation;
  const ctl=new AbortController();
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  fetch(progressUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchedSeconds:seconds,ended:true,...(playbackDuration?{durationSeconds:playbackDuration}:{})}),keepalive:true,signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'})
   .then(res=>res.ok?res.json():null)
   .then(applyServer)
   .catch(()=>{})
   .finally(()=>clearTimeout(deadline));
 }

 // ---- Student notes: one write in flight, state only from the server ----
 async function writeLesson(kind,payload){
  if(mutation)return false;
  const ctl=new AbortController();
  mutation=ctl;
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  saving=true;requestError=false;
  if(kind==='response')savedResponse=null;
  paint();
  try{
   const res=await fetch(`/api/video-lessons/${lesson.id}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!res.ok)throw new Error('Video lesson write failed');
   const body=await res.json();
   if(mutation!==ctl||ctl.signal.aborted||destroyed)return false;
   if(body.state)setState(body.state);
   if(kind==='response')savedResponse=payload.summaryText===ownNotes?true:null;
   return true;
  }catch{
   if(mutation===ctl&&!destroyed){requestError=true;if(kind==='response')savedResponse=false;}
   return false;
  }finally{
   clearTimeout(deadline);
   if(mutation===ctl){mutation=null;saving=false;paint();}
  }
 }
 function paint(){
  if(destroyed)return;
  requestErr.hidden=!requestError;
  if(panelRefs.saveButton){panelRefs.saveButton.disabled=saving;panelRefs.saveButton.textContent=saving?t.saving:t.save;}
  const status=panelRefs.responseStatus;
  if(status){
   status.setAttribute('data-video-response-state',savedResponse===true?'saved':savedResponse===false?'error':'idle');
   status.setAttribute('data-video-response-verdict',state);
   status.replaceChildren();
   if(savedResponse===true)status.append(el('span',{class:'text-xs text-band-700'},t.saved));
   else if(savedResponse===false)status.append(el('span',{class:'text-xs text-warn-700'},dict.common.error));
  }
 }

 // ---- Learning materials ----
 function ownNotesPanel(){
  const input=el('textarea',{class:'input min-h-28',id:`${tabIdBase}-own-notes`,maxlength:'4000','data-video-own-notes-input':'',placeholder:dict.courseRoadmap.notesPlaceholder});
  input.value=ownNotes;
  input.addEventListener('input',()=>{ownNotes=input.value;savedResponse=null;paint();},{signal:life});
  const save=el('button',{type:'button',class:'btn-primary','data-video-save-response':''},t.save);
  save.addEventListener('click',()=>writeLesson('response',{summaryText:ownNotes}),{signal:life});
  const status=el('span',{role:'status','data-video-response-state':'idle','data-video-response-verdict':state});
  panelRefs.saveButton=save;panelRefs.responseStatus=status;
  const reflectionSlot=el('div',{'data-video-reflection-slot':''});
  import('./reflection-recorder.js').then(({createReflectionRecorder})=>{
   if(destroyed)return;
   recorder=createReflectionRecorder({dict,signal:life});
   reflectionSlot.append(recorder.node);recorder.setActive(tab==='ownNotes');
  }).catch(()=>{if(!destroyed)reflectionSlot.append(el('p',{role:'status'},t.voiceSummary.unavailable));});
  return el('div',{class:'flex flex-col gap-3','data-video-own-notes':''},
   el('label',{for:input.id,class:'text-sm font-medium text-ink-700'},t.tabs.ownNotes),
   el('p',{class:'text-xs text-ink-500'},t.ownNotesHelp),input,
   el('div',{class:'flex items-center gap-3'},save,status),reflectionSlot);
 }
 function buildPanel(name){
  if(name==='description'||name==='transcript')return el('p',{class:'whitespace-pre-line text-sm text-ink-700','data-video-description':''},lesson.beforeYouWatch?.trim()||t.descriptionEmpty);
  if(name==='notes')return el('p',{class:'whitespace-pre-line text-sm text-ink-700','data-video-notes':'shown'},notes||t.notesEmpty);
  if(name==='ownNotes')return el('div',{class:'flex flex-col gap-4'},
   el('section',{class:'flex flex-col gap-2','data-video-own-notes-description':''},
    el('h3',{class:'font-semibold text-ink-900'},t.tabs.description),
    buildPanel('description')),
   ownNotesPanel());
  const vocabulary=createVideoVocabulary({context:{...context,signal:life},id:lesson.id,title:lesson.title,words:vocabWords,dict});
  if(glossary)vocabulary.append(el('p',{class:'whitespace-pre-line text-sm leading-6','data-video-glossary':''},glossary));
  if(!video.vocabulary.ready)vocabulary.prepend(el('p',{role:'status',class:'text-sm text-ink-500'},t.vocabularyUnavailable));
  return vocabulary;
 }

 function paintTabs(){
  for(const [name,button] of tabButtons){
   const active=name===tab;
   button.setAttribute('aria-selected',String(active));
   button.tabIndex=active?0:-1;
   button.className=tabClass(active);
  }
 }
 function mountPanel(){
  if(!panels.has(tab))panels.set(tab,buildPanel(tab));
  panel.replaceChildren(panels.get(tab));
  recorder?.setActive(tab==='ownNotes');
  const transcriptOpen=tab==='transcript';
  transcriptRegion.hidden=!transcriptOpen;
  section.setAttribute('data-transcript-open',String(transcriptOpen));
  if(transcriptOpen)void showTranscript();
  panel.setAttribute('aria-labelledby',`${tabIdBase}-tab-${tab}`);
  panel.setAttribute('data-video-tab-active',tab);
  paint();
 }
 function selectTab(name){
  if(!tabs.includes(name)||tab===name)return;
  tab=name;
  paintTabs();
  mountPanel();
 }
 for(const [index,name] of tabs.entries()){
  const button=el('button',{...(name==='transcript'?{'data-video-transcript-button':''}:{}),type:'button',role:'tab',id:`${tabIdBase}-tab-${name}`,'aria-controls':`${tabIdBase}-panel`,'data-video-tab':name},t.tabs[name]);
  button.addEventListener('click',()=>selectTab(name),{signal:life});
  button.addEventListener('keydown',event=>{
   const last=tabs.length-1;
   const next=event.key==='ArrowRight'?(index===last?0:index+1):event.key==='ArrowLeft'?(index===0?last:index-1):event.key==='Home'?0:event.key==='End'?last:null;
   if(next===null)return;
   event.preventDefault();
   selectTab(tabs[next]);
   document.getElementById(`${tabIdBase}-tab-${tabs[next]}`)?.focus();
  },{signal:life});
  tabButtons.set(name,button);
  tablist.append(button);
 }

 // ---- Direct media (owner-authorised file) or blocked notice ----
 if(isDirect){
  if(video.directMedia){
   import('./direct-player.js').then(({createDirectPlayer})=>{
    if(destroyed)return;
    let sessionId=null;
    const player=createDirectPlayer({
     src:video.directMedia.src,captions:video.directMedia.captions,title:lesson.title,labels:t.directPlayer,
     onTime:onPosition,signal:life,
     onPulse(pulse){
      const module=/podcast/i.test(location.pathname)?'podcast':'ted';
      fetch('/api/coins/media/heartbeat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,mediaId:String(lesson.id),module,...pulse})}).then(async response=>{
       if(!response.ok)return;
       const data=await response.json();
       if(data.sessionId)sessionId=data.sessionId;
      }).catch(()=>{});
     },
    });
    directHandle=player;
    stage.replaceChildren(player.node);
   }).catch(()=>{if(!destroyed)stage.replaceChildren(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));});
  }else{
   stage.append(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));
  }
 }else if(lesson.provider==='youtube'){
  stage.append(frameBox);
  mountFrame();
 }else{
  stage.append(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));
 }

 // ---- Teardown ----
 function destroy(){
  if(destroyed)return;
  destroyed=true;
  signal.removeEventListener('abort',destroy);
  unmountFrame();
  progressRequest?.abort();progressRequest=null;
  const pending=mutation;mutation=null;pending?.abort();
  transcriptHandle?.destroy();transcriptHandle=null;
  recorder?.destroy();recorder=null;
  directHandle?.destroy();directHandle=null;
  own.abort();
  section.remove();
 }
 if(signal.aborted)destroy();
 else signal.addEventListener('abort',destroy,{once:true});

 // First paint: the tab strip, the first panel, and the progress/status labels.
 setState(state);
 paintTabs();
 mountPanel();
 return {node:section,destroy};
}
