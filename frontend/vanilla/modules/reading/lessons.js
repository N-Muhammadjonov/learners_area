import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {lessonsCatalogueDTO} from '../../js/adapters/listening-lessons-v10.js';
import {readingLessonDTO} from '../../js/adapters/reading-v44.js';
import {render as body} from '../../js/generated/ListeningLessonBody-v10.js';
import {lessonQuiz} from '../listening/lesson-quiz.js';
import {lessonWorkspace} from '../courses/workspace.js';
import {lessonNotes} from '../notes/lesson-notes.js';
import {missing} from '../listening/catalogue-v9.js';
import {RegionFailureNotice,BackLink} from '../shared/presentation.js';
import {readingLessonText} from './lesson-text.js';

/** Original src/app/app/(shell)/reading/lessons/page.tsx: the Reading catalogue, 24 per page. */
export function mountLessons(context){
 const {root,url,signal,dict}=context,page=Math.max(1,Math.min(10000,Number.parseInt(url.searchParams.get('page')??'1',10)||1));
 const host=el('div',{'data-native-view':'reading-lessons'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,class:'h-32 animate-pulse rounded-xl bg-ink-50','data-async-loading':'reading-lessons'}));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const {library}=lessonsCatalogueDTO(raw);
   const rows=library.rows;
   host.replaceChildren(el('div',{class:'mx-auto flex max-w-5xl flex-col gap-5','data-route-usable':'reading-lessons'},
    !rows.length?el('p',{class:'body-text','data-reading-lessons-empty':true},dict.readingV4.lessonsEmpty):null,
    el('div',{class:'grid gap-4 sm:grid-cols-2'},rows.map(lesson=>el('article',{class:'card p-5','data-reading-lesson':lesson.id},
     el('h2',{class:'card-title'},lesson.title),
     lesson.summary?el('p',{class:'body-text'},lesson.summary):null,
     el('a',{class:'btn-primary',href:`/app/reading/lessons/${lesson.id}`},dict.readingV4.open)))),
    el('nav',{class:'flex gap-3','aria-label':dict.readingHub.page},
     page>1?el('a',{href:`?page=${page-1}`},dict.readingHub.prevPage):null,
     library.hasMore?el('a',{href:`?page=${page+1}`},dict.readingHub.nextPage):null)));
  }catch(e){
   if(signal.aborted)return;
   if(e.status===404){host.replaceChildren(missing(dict));return;}
   host.replaceChildren(RegionFailureNotice({region:'reading-lessons',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}

const TABS=['description','teacher-notes','xulosangiz'];
/** Original src/app/app/(shell)/reading/lessons/[lessonId]/page.tsx. Body first, then the progress control, then the
 * three approved tabs. The lesson itself is the main content. */
export function mountLesson(context){
 const {root,url,signal,dict,session}=context,lessonId=url.pathname.split('/')[4],host=el('div',{'data-native-view':'reading-lesson'});root.append(host);let busy=false;
 signal.addEventListener('abort',()=>{for(const n of host.querySelectorAll('audio,video')){n.pause();n.removeAttribute('src');n.load();}},{once:true});
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   if(!uuid(lessonId)){host.replaceChildren(missing(dict));return;}
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   if(raw.kind==='not_found'){host.replaceChildren(missing(dict));return;}
   if(raw.kind!=='lesson')throw Error('invalid_reading_lesson');
   const detail=readingLessonDTO(raw.detail,lessonId);
   host.replaceChildren(lessonPage(context,detail,url.searchParams.get('tab'),session.user));
   for(const media of host.querySelectorAll('audio,video'))media.addEventListener('error',()=>{if(media.nextElementSibling?.hasAttribute('data-lesson-media-error'))return;const status=el('div',{'data-lesson-media-error':'',role:'alert'},dict.listening.speedAudioError),retry=el('button',{class:'btn-secondary',type:'button'},dict.globalDictionary.retry);retry.addEventListener('click',()=>{media.load();status.remove();},{signal});status.append(retry);media.after(status);},{signal});
  }catch(e){
   if(signal.aborted)return;
   if(e.status===404){host.replaceChildren(missing(dict));return;}
   host.replaceChildren(RegionFailureNotice({region:'reading-lesson',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}

function lessonPage(context,detail,requested,user){
 const {dict,signal}=context,t={...dict.listening.lessons,areaLabel:dict.readingV4.products.lessons.title,backToList:dict.readingV4.lessonBack};
 const tab=TABS.includes(requested??'')?requested:'description',lesson=detail.lesson,media=detail.media,mediaUrl=detail.mediaUrl;
 const minutesLine=(n)=>t.descriptionMinutes.replace('{n}',String(n));
 const page=el('div',{class:'mx-auto flex max-w-3xl flex-col gap-5','data-route-usable':'reading-lesson'});
 page.append(
  el('div',{},
   BackLink({fallbackHref:'/app/reading/lessons',label:t.backToList,'data-reading-lesson-back':true}),
   el('h1',{class:'mt-2 font-display text-2xl text-ink-900'},lesson.title),
   el('p',{class:'mt-1 text-xs uppercase tracking-wide text-ink-300'},t.areaLabel)));
 const bodyCard=el('div',{class:'card p-5','data-reading-lesson-body-card':true},el('h2',{class:'mb-3 font-display text-lg text-ink-900'},t.bodyTitle));
 if(media&&media.mediaKind==='audio'&&mediaUrl)bodyCard.append(el('figure',{class:'mb-4 flex flex-col gap-2'},
  el('audio',{controls:true,preload:'none',class:'w-full',src:mediaUrl,'data-reading-lesson-audio':true}),
  el('figcaption',{class:'text-xs text-ink-300'},t.mediaKind.audio+(media.durationSeconds?` · ${Math.round(media.durationSeconds/60)} ${t.minutes}`:''))));
 if(media&&media.mediaKind==='video'&&mediaUrl)bodyCard.append(el('video',{controls:true,preload:'none',class:'mb-4 w-full rounded-md bg-ink-950',src:mediaUrl,'data-reading-lesson-video':true}));
 if(media&&!mediaUrl)bodyCard.append(el('p',{class:'mb-4 text-sm text-ink-500','data-reading-lesson-media-elsewhere':true},
  el('a',{class:'underline',href:`/app/video-lessons/${media.id}`,'data-reading-lesson-media-link':true},media.title)));
 bodyCard.append(body({dict,blocks:detail.blocks,highlightScope:`${user.id}:${lesson.id}`,LessonQuizBlock:props=>lessonQuiz(context,props),ReadingLessonText:props=>readingLessonText(context,props)}));
 page.append(bodyCard);
 page.append(lessonWorkspace(context,{lessonId:lesson.id,state:detail.progress.state,initialNotes:'',completedAt:detail.progress.completedAt?new Date(detail.progress.completedAt):null,showNotes:false}));
 page.append(el('div',{class:'flex flex-wrap gap-2',role:'tablist','data-reading-lesson-tabs':true},TABS.map(candidate=>el('a',{href:`/app/reading/lessons/${lesson.id}?tab=${candidate}`,role:'tab','aria-selected':tab===candidate?'true':'false',class:tab===candidate?'btn-primary':'btn-secondary','data-reading-lesson-tab':candidate,'data-active':tab===candidate?'true':'false'},t.tabs[candidate==='teacher-notes'?'teacherNotes':candidate]))));
 const panel=el('div',{class:'card p-5','data-reading-lesson-panel':tab});
 if(tab==='description')panel.append(el('div',{class:'flex flex-col gap-2'},
  lesson.summary?el('p',{class:'text-sm leading-relaxed text-ink-700','data-reading-description':true},lesson.summary):el('p',{class:'text-sm text-ink-500','data-reading-description-empty':true},t.descriptionEmpty),
  media?.focus?el('p',{class:'text-sm leading-relaxed text-ink-700','data-reading-description-focus':true},media.focus):null,
  lesson.estimatedMinutes?el('p',{class:'text-xs text-ink-300'},minutesLine(lesson.estimatedMinutes)):null));
 if(tab==='teacher-notes')panel.append(el('div',{class:'flex flex-col gap-2'},
  el('p',{class:'text-xs text-ink-300'},detail.teacherNotesSource==='media'?t.teacherNotesLegacyHint:t.teacherNotesHint),
  detail.teacherNotes?el('p',{class:'whitespace-pre-line text-sm leading-relaxed text-ink-700','data-reading-teacher-notes':true,'data-teacher-notes-source':detail.teacherNotesSource??'none'},detail.teacherNotes):el('p',{class:'text-sm text-ink-500','data-reading-teacher-notes-empty':true},t.teacherNotesEmpty)));
 if(tab==='xulosangiz')panel.append(el('div',{class:'flex flex-col gap-2'},
  el('p',{class:'text-xs text-ink-300'},t.xulosangizHint),
  lessonNotes(context,{lessonId:lesson.id,initialNotes:detail.note})));
 page.append(panel);
 return page;
}
