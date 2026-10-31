import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {viewData} from '../../js/adapters/frontend.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {
 parseLiveClasses,
 localDate,
 youtubeThumbnailUrl,
 minutesFromSeconds,
} from './contract.js';
import {joinControl} from './join.js';
import {resourceBlocks} from './resources.js';
import {mountRoom} from './room.js';

const RECORDING_GRID='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

function svgNS(tag,attrs){
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
 return node;
}

function fallbackArt(){
 const icon=svgNS('svg',{viewBox:'0 0 24 24',class:'h-10 w-10',fill:'currentColor'});
 icon.append(svgNS('path',{d:'M8 5.5v13l11-6.5z'}));
 return el('div',{'aria-hidden':'true',class:'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200 text-ink-500'},icon);
}

/** Static thumbnail box modeled on video/library.js (TED/Podcast visual reference). */
function thumbnailBox(src){
 const box=el('div',{class:'relative aspect-video w-full overflow-hidden bg-ink-100','data-live-thumb':src?'image':'fallback'});
 if(!src){
  box.append(fallbackArt());
  return box;
 }
 const img=el('img',{
  src,
  alt:'',
  loading:'lazy',
  decoding:'async',
  referrerpolicy:'no-referrer',
  class:'absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]',
 });
 img.addEventListener('error',()=>{
  box.setAttribute('data-live-thumb','fallback');
  img.replaceWith(fallbackArt());
 },{once:true});
 box.append(img);
 return box;
}

export async function mount(ctx){
 const queryId=ctx.url?.searchParams?.get('id');
 if(queryId&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryId)){
  return mountRoom(ctx,queryId);
 }

 const {root,signal,dict,locale}=ctx,t=dict.liveClasses;
 const host=el('section',{'data-route-usable':'live-classes',class:'mx-auto flex w-full max-w-5xl flex-col gap-6'},
  el('h1',{class:'font-display text-2xl text-ink-900'},t.title));
 const body=el('div',{'data-live-classes-host':''});
 host.append(body);
 root.append(host);
 let generation=0;

 function renderLiveNowSection(data){
  const rows=data.liveNow;
  return el('section',{'data-live-now-section':'',class:'flex flex-col gap-3'},
   el('div',{class:'flex items-center gap-2'},
    el('h2',{class:'text-sm font-semibold uppercase tracking-wide text-ink-300'},t.liveNowSection||'Live Now'),
    rows.length?el('span',{class:'badge-live'},`${rows.length} ${t.status.live||'LIVE'}`):null),
   rows.length
    ?el('div',{class:'grid grid-cols-1 gap-4 sm:grid-cols-2'},rows.map(c=>{
     const teacherName=data.teachers.get(c.teacherUserId)??t.teacher;
     const thumbSrc=c.thumbnailUrl||youtubeThumbnailUrl(c.youtubeVideoId);
     const card=el('div',{class:'card group flex flex-col overflow-hidden','data-live-class':c.id,'data-live-now-card':c.id},
      thumbnailBox(thumbSrc),
      el('div',{class:'flex flex-1 flex-col justify-between gap-3 p-4'},
       el('div',{class:'flex flex-col gap-1'},
        el('div',{class:'flex items-center justify-between gap-2'},
         el('span',{class:'badge-live','data-live-badge':'live'},t.status.live||'LIVE'),
         el('span',{class:'text-xs text-ink-300'},`${c.durationMinutes} ${dict.common.minutes}`)),
        el('h3',{class:'mt-1 text-base font-semibold text-ink-900'},c.title),
        c.description?el('p',{class:'line-clamp-2 text-xs text-ink-500'},c.description):null,
        el('p',{class:'text-xs text-ink-300'},`${teacherName} · ${localDate(c.scheduledAt,locale)}`)),
       el('div',{class:'flex items-center justify-between gap-2 pt-1'},
        el('a',{href:`/app/live-classes/${c.id}`,class:'btn-primary','data-live-join-room':c.id},t.joinClass||t.join),
        joinControl(ctx,c,data.attendance.get(c.id))),
       resourceBlocks(ctx,data.materials.get(c.id)??[])));
     return card;
    }))
    :el('p',{class:'text-sm text-ink-500','data-no-live-now':''},t.noLiveNow||t.noClasses));
 }

 function renderUpcomingSection(data){
  const rows=data.scheduledOnly;
  return el('section',{'data-upcoming-classes-section':'',class:'flex flex-col gap-3'},
   el('h2',{class:'text-sm font-semibold uppercase tracking-wide text-ink-300'},t.upcomingSection||t.upcoming),
   rows.length
    ?el('div',{class:'flex flex-col gap-2.5'},rows.map(c=>{
     const teacherName=data.teachers.get(c.teacherUserId)??t.teacher;
     const card=el('div',{class:'card flex flex-col gap-2 p-5','data-live-class':c.id,'data-upcoming-card':c.id});
     const info=el('div',{class:'min-w-0 flex flex-col gap-1'},
      el('div',{class:'flex flex-wrap items-center gap-2'},
       el('p',{class:'text-sm font-medium text-ink-900'},c.title),
       el('span',{class:'badge bg-signal-100 text-signal-700','data-scheduled-badge':''},t.status.scheduled||t.status.upcoming)),
      c.description?el('p',{class:'text-xs text-ink-500'},c.description):null,
      el('p',{class:'text-xs text-ink-300'},`${localDate(c.scheduledAt,locale)} · ${c.durationMinutes} ${dict.common.minutes} · ${teacherName}`));
     const action=joinControl(ctx,c,data.attendance.get(c.id));
     card.append(el('div',{class:'flex flex-wrap items-center justify-between gap-3'},info,action),resourceBlocks(ctx,data.materials.get(c.id)??[]));
     return card;
    }))
    :el('p',{class:'text-sm text-ink-500','data-no-upcoming':''},t.noUpcoming||t.noClasses));
 }

 function recordingCard(data,c){
     const teacherName=data.teachers.get(c.teacherUserId)??t.teacher;
     const mins=minutesFromSeconds(c.recordingDurationSeconds)||c.durationMinutes;
     const ready=c.lifecycleStatus==='recording_ready'||c.status==='recorded';
     const statusKey=c.lifecycleStatus&&t.status[c.lifecycleStatus]?c.lifecycleStatus:c.status;
     const thumbSrc=c.thumbnailUrl||youtubeThumbnailUrl(c.youtubeVideoId);
     const metaParts=[
      teacherName,
      localDate(c.scheduledAt,locale,{dayOnly:true}),
      mins?`${mins} ${dict.common.minutes}`:null,
     ].filter(Boolean).join(' · ');

     return el('li',{class:'min-w-0','data-live-class':c.id,'data-recording-card':c.id},
      el('div',{class:'group flex h-full flex-col overflow-hidden rounded-xl border border-ink-100 bg-paper-raised transition-colors hover:border-ink-300'},
       thumbnailBox(thumbSrc),
       el('div',{class:'flex min-w-0 flex-1 flex-col gap-2 p-4'},
        el('div',{class:'flex items-center justify-between gap-2'},
         el('span',{class:ready?'badge-done':'badge-gold','data-recording-status':statusKey},t.status[statusKey]||t.status[c.status]),
         data.attendance.has(c.id)?el('span',{class:'text-xs text-band-good'},t.youAttended):null),
        el('h3',{class:'line-clamp-2 text-sm font-medium leading-snug text-ink-900','data-recording-card-title':''},c.title),
        c.description?el('p',{class:'line-clamp-2 text-xs text-ink-500'},c.description):null,
        el('p',{class:'mt-auto text-xs text-ink-300','data-recording-card-meta':''},metaParts),
        el('div',{class:'pt-2'},
         ready
          ?el('a',{href:`/app/live-classes/${c.id}`,class:'btn-secondary w-full text-center text-xs','data-watch-recording':c.id},t.watchRecording||t.recording)
          :el('a',{href:`/app/live-classes/${c.id}`,class:'btn-ghost w-full text-center text-xs','data-view-ended-class':c.id},t.status[statusKey]||t.status.completed)))));

 }
 function renderPreviousSection(data){
  const rows=data.past.filter(c=>c.status!=='cancelled');
  const section=el('section',{'data-previous-classes-section':'',class:'flex flex-col gap-3'},
   el('h2',{class:'text-sm font-semibold uppercase tracking-wide text-ink-300'},t.previousSection||t.past));
  const list=el('ul',{class:RECORDING_GRID,'data-previous-recordings-grid':''},rows.map(c=>recordingCard(data,c)));
  if(rows.length)section.append(list);
  else section.append(el('p',{class:'text-sm text-ink-500','data-no-previous':''},t.noPrevious||''));
  if(data.pastPagination?.hasMore){
   const button=el('button',{type:'button',class:'btn-secondary','data-load-more-recordings':''},t.loadMoreRecordings||'Load more recordings');
   const status=el('p',{class:'text-sm text-ink-500','data-recordings-page-status':'',role:'status'});
   section.append(el('div',{class:'flex flex-col items-center gap-2'},button,status));
   let loading=false;
   const seen=new Set(rows.map(c=>c.id));
   button.addEventListener('click',async()=>{
    if(loading||signal.aborted||!data.pastPagination.hasMore)return;
    loading=true;
    button.disabled=true;
    button.textContent=t.loadingRecordings||'Loading...';
    status.textContent='';
    try{
     const requested=data.pastPagination.nextCursor;
     const response=await api.request(`/api/live-classes/recordings?before=${encodeURIComponent(requested)}`,{signal});
     if(signal.aborted||!section.isConnected)return;
     const parsed=parseLiveClasses({courseAvailable:true,upcoming:[],past:response.past,
      attendance:response.attendance,teachers:response.teachers,materials:response.materials,
      pastPagination:response.pastPagination});
     if(parsed.pastPagination.hasMore&&parsed.pastPagination.nextCursor===requested)throw new Error('stalled_recordings_cursor');
     for(const [id,name] of parsed.teachers)data.teachers.set(id,name);
     for(const [id,date] of parsed.attendance)data.attendance.set(id,date);
     for(const [id,materials] of parsed.materials)data.materials.set(id,materials);
     let appended=0;
     for(const c of parsed.past){
      if(c.status==='cancelled'||seen.has(c.id))continue;
      seen.add(c.id);
      if(!list.isConnected){section.querySelector('[data-no-previous]')?.remove();section.append(list);}
      list.append(recordingCard(data,c));
      appended++;
     }
     data.pastPagination=parsed.pastPagination;
     if(!data.pastPagination.hasMore)button.parentNode.remove();
     else if(!appended&&!parsed.past.length)throw new Error('empty_recordings_page');
    }catch(error){
     if(!signal.aborted&&section.isConnected){
      status.textContent=t.recordingsLoadFailed||'Could not load older classes. Try again.';
     }
    }finally{
     loading=false;
     button.disabled=false;
     button.textContent=t.loadMoreRecordings||'Load more recordings';
    }
   });
  }
  return section;
 }

 function renderCards(data){
  const content=el('div',{class:'flex flex-col gap-6','data-live-classes-content':'','data-async-content':'live-classes'});
  if(!data.courseAvailable){
   content.append(el('p',{class:'text-sm text-ink-500'},dict.formCopy.noCourse));
   return content;
  }
  if(data.metadataUnavailable){
   content.append(RegionFailureNotice({region:'live-class-metadata',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:reload}));
  }
  content.append(
   renderLiveNowSection(data),
   renderUpcomingSection(data),
   renderPreviousSection(data)
  );
  return content;
 }

 async function reload(){
  const id=++generation;
  body.replaceChildren(el('div',{role:'status','aria-busy':'true','data-async-loading':'live-classes',class:'flex flex-col gap-3'},
   [0,1,2].map(()=>el('div',{class:'h-20 animate-pulse rounded-xl bg-ink-50'}))));
  try{
   const data=parseLiveClasses(await viewData('/app/live-classes',signal));
   if(signal.aborted||id!==generation)return;
   body.replaceChildren(renderCards(data));
  }catch(e){
   if(signal.aborted||id!==generation)return;
   if(e?.status===401){void ctx.navigate('/login',{replace:true});return;}
   body.replaceChildren(el('div',{'data-integration-required':'live-classes'},
    RegionFailureNotice({region:'live-classes',message:dict.auth.errorServer,retryLabel:dict.errorPage.retry,refresh:reload})));
  }
 }
 signal.addEventListener('abort',()=>{generation++;body.replaceChildren();},{once:true});
 void reload();
}
