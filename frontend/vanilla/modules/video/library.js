import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {videoLibraryDTO} from '../../js/adapters/video-v47.js';
import {isOpen} from '../../js/adapters/course-lesson-v36.js';
import {StateBadge} from '../../js/generated/badges.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {youtubeThumbnailUrl,minutesFrom} from './provider.js';

/** /app/video-lessons (original src/app/app/(shell)/video-lessons/page.tsx and components/video/VideoLessonCard.tsx).
 * Standalone TED / PODCAST items, then roadmap-linked videos that the lesson's open state allows. Real data only. */
const GRID='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

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
/** A static still for a YouTube id; never an iframe. Falls back to the neutral in-app art on null or load failure. */
function thumbnail(src){
 const box=el('div',{class:'relative aspect-video w-full overflow-hidden bg-ink-100','data-video-thumb':src?'image':'fallback'});
 if(src===null){
  box.append(fallbackArt());
  return box;
 }
 const img=el('img',{src,alt:'',loading:'lazy',decoding:'async',referrerpolicy:'no-referrer',class:'absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]'});
 img.addEventListener('error',()=>{box.setAttribute('data-video-thumb','fallback');img.replaceWith(fallbackArt());},{once:true});
 box.append(img);
 return box;
}

function card({href,title,provider,videoId,durationSeconds,state,context,minutesLabel,entryId,standalone}){
 const minutes=minutesFrom(durationSeconds);
 const meta=[minutes!==null?minutesLabel.replace('{n}',String(minutes)):null,context].filter(Boolean).join(' · ');
 const attrs={href,class:'group flex h-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-paper-50 transition-colors hover:border-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600','data-video-lesson-open':''};
 if(standalone)attrs['data-video-standalone-open']=entryId;
 return el('li',{class:'min-w-0','data-video-lesson-entry':entryId},
  el('a',attrs,
   thumbnail(provider==='youtube'?youtubeThumbnailUrl(videoId):null),
   el('div',{class:'flex min-w-0 flex-1 flex-col gap-2 p-3'},
    el('div',{},StateBadge({state})),
    el('h3',{class:'line-clamp-2 text-sm font-medium leading-snug text-ink-900 sm:line-clamp-3','data-video-card-title':''},title),
    minutes!==null||context?el('p',{class:'mt-auto line-clamp-2 text-xs text-ink-500','data-video-card-meta':''},meta):null)));
}

export function mount(context){
 const {root,url,signal,dict}=context,t=dict.videoLessons;
 const host=el('div',{'data-native-view':'video-lessons'});
 root.append(host);
 let busy=false;

 function skeleton(){
  return el('div',{'aria-hidden':'true',class:GRID,'data-async-loading':'video-lessons'},[0,1,2,3].map(()=>el('div',{class:'aspect-[4/3] animate-pulse rounded-xl bg-ink-50'})));
 }
 function page(data){
  const standalone=data.standalone;
  const openable=data.course.filter(row=>isOpen(row.state));
  const header=el('nav',{'aria-label':t.title,class:'flex min-w-0 gap-1 overflow-x-auto border-b border-ink-100','data-video-header-sections':''},
   standalone.length>0?el('a',{href:'#video-standalone',class:'flex min-h-11 shrink-0 items-center px-3 text-sm'},t.standaloneHeading):null,
   openable.length>0||!standalone.length?el('a',{href:'#video-course',class:'flex min-h-11 shrink-0 items-center px-3 text-sm'},t.courseHeading):null);
  const standaloneList=standalone.length>0?el('section',{id:'video-standalone',class:'flex flex-col gap-3','data-video-standalone-list':''},
   el('h2',{class:'sr-only'},t.standaloneHeading),
   el('ul',{class:GRID,'data-video-library-grid':''},standalone.map(row=>card({
    href:`/app/video-lessons/${row.id}`,title:row.title,provider:row.provider,videoId:row.videoId,durationSeconds:row.durationSeconds,
    state:row.state,minutesLabel:t.minutes,entryId:row.id,standalone:true,
   })))):null;
  const courseList=openable.length===0
   ?el('div',{class:'card p-5'},el('p',{class:'text-sm text-ink-500','data-video-lessons-empty':''},t.none))
   :el('ul',{class:GRID,'data-video-lesson-list':'','data-video-library-grid':''},openable.map(row=>card({
    href:`/app/courses/${row.courseSlug}/lessons/${row.lessonId}`,title:row.title,provider:row.provider,videoId:row.videoId,
    durationSeconds:row.durationSeconds,state:row.state,context:`${row.courseTitle} · ${row.unitTitle}`,minutesLabel:t.minutes,
    entryId:row.id,standalone:false,
   })));
  // Same branches as the original: with standalone items and no open course video, the course section is omitted.
  if(openable.length===0&&standaloneList)return el('div',{class:'flex flex-col gap-4','data-async-content':'video-lessons'},header,standaloneList);
  if(standaloneList)return el('div',{class:'flex flex-col gap-4','data-async-content':'video-lessons'},header,standaloneList,
   el('section',{id:'video-course',class:'flex flex-col gap-3'},el('h2',{class:'sr-only'},t.courseHeading),courseList));
  return el('div',{class:'flex flex-col gap-4','data-async-content':'video-lessons'},header,el('section',{id:'video-course','aria-label':t.courseHeading},courseList));
 }

 async function load(){
  if(busy||signal.aborted)return;
  busy=true;
  host.setAttribute('aria-busy','true');
  host.replaceChildren(el('div',{class:'mx-auto flex w-full max-w-7xl flex-col gap-4','data-route-usable':'video-lessons'},skeleton()));
  try{
   const raw=await viewData(url.pathname+url.search,signal);
   if(signal.aborted)return;
   const data=videoLibraryDTO(raw);
   host.replaceChildren(el('div',{class:'mx-auto flex w-full max-w-7xl flex-col gap-4','data-route-usable':'video-lessons'},page(data)));
  }catch{
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'video-lessons',message:dict.common.error,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{
   busy=false;
   if(!signal.aborted)host.setAttribute('aria-busy','false');
  }
 }
 void load();
}
