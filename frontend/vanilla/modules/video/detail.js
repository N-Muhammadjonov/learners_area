import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {videoDetailDTO} from '../../js/adapters/video-v47.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';
import {mount as notFound} from '../not-found.js';
import {createVideoStudio} from './studio.js';
import {minutesFrom} from './provider.js';

/** /app/video-lessons/:id (original src/app/app/(shell)/video-lessons/[id]/page.tsx): a standalone item on its own URL.
 * Drafts, archived items and course-linked videos are not served here; the server returns `detail: null` for them. */
export function mount(context){
 const {root,url,signal,dict}=context,t=dict.videoLessons;
 const id=url.pathname.split('/').at(-1);
 const host=el('div',{'data-native-view':'video-lesson'});
 root.append(host);
 let busy=false,studio=null;
 signal.addEventListener('abort',()=>{studio?.destroy();studio=null;},{once:true});

 async function missing(){
  studio?.destroy();studio=null;
  host.replaceChildren();
  if(!signal.aborted)await notFound({...context,root:host});
 }
 function page(detail){
  const lesson=detail.videoLesson,minutes=minutesFrom(lesson.durationSeconds);
  return el('div',{class:'mx-auto flex w-full max-w-7xl flex-col gap-4','data-route-usable':'video-lesson','data-video-standalone':lesson.id},
   BackLink({fallbackHref:'/app/video-lessons',label:t.title,'data-video-back':''}),
   el('header',{class:'flex flex-col gap-1','data-video-detail-header':''},
    el('h1',{class:'font-display text-2xl text-ink-900'},lesson.title),
    minutes!==null?el('p',{class:'text-sm text-ink-500','data-video-detail-meta':''},t.minutes.replace('{n}',String(minutes))):null),
   studio.node);
 }
 async function load(){
  if(busy||signal.aborted)return;
  busy=true;
  studio?.destroy();studio=null;
  host.setAttribute('aria-busy','true');
  host.replaceChildren(el('div',{role:'status','aria-label':dict.common.loading,class:'h-32 animate-pulse rounded-xl bg-ink-50'}));
  try{
   if(!uuid(id)){await missing();return;}
   const detail=videoDetailDTO(await viewData(url.pathname+url.search,signal),id);
   if(signal.aborted)return;
   if(detail===null){await missing();return;}
   studio=createVideoStudio(context,{mode:'standalone',video:detail});
   host.replaceChildren(page(detail));
  }catch(error){
   if(signal.aborted)return;
   if(error?.status===404){await missing();return;}
   studio?.destroy();studio=null;
   host.replaceChildren(RegionFailureNotice({region:'video-lesson',message:dict.common.error,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{
   busy=false;
   if(!signal.aborted)host.setAttribute('aria-busy','false');
  }
 }
 void load();
}
