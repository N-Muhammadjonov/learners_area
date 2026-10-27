import {ApiError} from '../api-client.js';
import {uuid} from './listening-v7.js';
import {YOUTUBE_ID,DIRECT_MEDIA_ID,safeDirectMedia,safeEmbedOrigin} from '../../modules/video/provider.js';

/** Validated TED / PODCAST projections (V47). The view projection is the only data source; a malformed payload
 * fails the region instead of rendering partial or invented lessons. Mutations use the existing
 * /api/video-lessons/:id/* contracts and never receive a verdict from this client. */
const bad=(code)=>{throw new ApiError(502,code);};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string';
const nstr=v=>v===null||typeof v==='string';
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const nnum=v=>v===null||num(v);
const PROVIDERS=new Set(['youtube','direct']);
const STATES=new Set(['locked','scheduled','available','assigned','in_progress','completed']);
const PROGRESS_STATES=new Set(['not_started','in_progress','completed']);
const STAGES=new Set(['comprehension','gap_fill']);

function videoIdValid(provider,videoId){
 if(!PROVIDERS.has(provider)||!str(videoId))return false;
 return provider==='youtube'?YOUTUBE_ID.test(videoId):DIRECT_MEDIA_ID.test(videoId);
}

/** Original library cards: progress badge from the student's own progress row (VideoLessonsPage). */
export function standaloneState(progressState){
 return progressState==='completed'?'completed':progressState==='in_progress'?'in_progress':'available';
}

/** Validated library payload: standalone items (always listed) and course-linked items (filtered by isOpen by the caller). */
export function videoLibraryDTO(data){
 if(!obj(data)||!Array.isArray(data.standalone)||!Array.isArray(data.course))bad('invalid_video_library');
 const standalone=data.standalone.map(row=>{
  if(!obj(row)||!uuid(row.id)||!str(row.title)||!videoIdValid(row.provider,row.videoId)||!nnum(row.durationSeconds)||!nstr(row.progressState))bad('invalid_video_library');
  return {id:row.id,title:row.title,provider:row.provider,videoId:row.videoId,durationSeconds:row.durationSeconds,watchedSeconds:num(row.watchedSeconds)?row.watchedSeconds:null,state:standaloneState(row.progressState)};
 });
 const course=data.course.map(row=>{
  if(!obj(row)||!uuid(row.id)||!str(row.title)||!videoIdValid(row.provider,row.videoId)||!nnum(row.durationSeconds)||!STATES.has(row.state)||!uuid(row.lessonId)||!str(row.courseSlug)||!str(row.courseTitle)||!str(row.unitTitle))bad('invalid_video_library');
  return {id:row.id,title:row.title,provider:row.provider,videoId:row.videoId,durationSeconds:row.durationSeconds,watchedSeconds:num(row.watchedSeconds)?row.watchedSeconds:null,state:row.state,progressState:row.progressState?standaloneState(row.progressState):null,lessonId:row.lessonId,courseSlug:row.courseSlug,courseTitle:row.courseTitle,unitTitle:row.unitTitle};
 });
 return {standalone,course};
}

/** One video's studio payload (shared by /app/video-lessons/:id and the course lesson route). */
export function videoStudioDTO(data){
 if(!obj(data))bad('invalid_video_lesson');
 const v=data.videoLesson;
 if(!obj(v)||!uuid(v.id)||!videoIdValid(v.provider,v.videoId)||!str(v.title)||!nstr(v.beforeYouWatch)||!nnum(v.durationSeconds)||!nstr(v.transcriptSource)&&v.transcriptSource!==undefined||!nstr(v.transcriptAttribution)&&v.transcriptAttribution!==undefined||!nstr(v.transcriptText)&&v.transcriptText!==undefined||!nstr(v.notes)&&v.notes!==undefined)bad('invalid_video_lesson');
 const transcript=v.transcript??null;
 if(transcript!==null&&(!Array.isArray(transcript)||!transcript.every(line=>obj(line)&&num(line.startSeconds)&&str(line.text))))bad('invalid_video_lesson');
 if(!Array.isArray(data.questions)||!data.questions.every(q=>obj(q)&&uuid(q.id)&&STAGES.has(q.stage)&&str(q.prompt)&&nnum(q.atSeconds)))bad('invalid_video_lesson');
 const progress=data.progress??null;
 if(progress!==null){
  if(!obj(progress)||!PROGRESS_STATES.has(progress.state)||!num(progress.watchedSeconds)||!nstr(progress.responseText??null)||!nstr(progress.summaryText??null))bad('invalid_video_lesson');
  const answers=progress.answers??{};
  if(!obj(answers)||!Object.values(answers).every(a=>obj(a)&&str(a.answer)&&typeof a.correct==='boolean'))bad('invalid_video_lesson');
 }
 const vocab=data.vocabulary;
 if(!obj(vocab)||typeof vocab.ready!=='boolean'||!Array.isArray(vocab.items)||!vocab.items.every(w=>obj(w)&&uuid(w.occurrenceId)&&uuid(w.id)&&str(w.term)&&nstr(w.partOfSpeech??null)&&str(w.definitionEn)&&nstr(w.translationUz??null)&&nstr(w.exampleSentence??null)))bad('invalid_video_lesson');
 const directMedia=v.provider==='direct'?(data.directMedia==null?null:safeDirectMedia(data.directMedia)):null;
 return {
  videoLesson:{
   id:v.id,provider:v.provider,videoId:v.videoId,title:v.title,beforeYouWatch:v.beforeYouWatch,durationSeconds:v.durationSeconds,
   transcript:transcript?transcript.map(line=>({startSeconds:line.startSeconds,text:line.text})):null,
   transcriptSource:v.transcriptSource??null,transcriptAttribution:v.transcriptAttribution??null,transcriptText:v.transcriptText??null,notes:v.notes??null,
  },
  questions:data.questions.map(q=>({id:q.id,stage:q.stage,prompt:q.prompt,atSeconds:q.atSeconds})),
  progress:progress===null?null:{state:progress.state,watchedSeconds:progress.watchedSeconds,answers:progress.answers??{},responseText:progress.responseText??null,summaryText:progress.summaryText??null},
  vocabulary:{ready:vocab.ready,items:vocab.items.map(w=>({occurrenceId:w.occurrenceId,id:w.id,term:w.term,partOfSpeech:w.partOfSpeech??null,definitionEn:w.definitionEn,translationUz:w.translationUz??null,exampleSentence:w.exampleSentence??null}))},
  directMedia,
  embedOrigin:safeEmbedOrigin(data.embedOrigin??null),
 };
}

/** Standalone detail: `detail: null` means not live / not found (same as a missing item). */
export function videoDetailDTO(data,id){
 if(!obj(data)||!('detail'in data))bad('invalid_video_lesson');
 if(data.detail===null)return null;
 const studio=videoStudioDTO(data.detail);
 if(studio.videoLesson.id!==id)bad('invalid_video_lesson');
 return studio;
}
