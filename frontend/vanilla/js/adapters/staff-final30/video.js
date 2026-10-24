import {bad,isObj,str,int,oneOf,arr,date,staffData,rawJson,UUID} from './core.js';
import {PUB} from './reading.js';
/** Video lesson authoring (staff: teacher/admin/owner). Read PROPOSED; write = existing POST /api/admin/video-lessons. */
export function validateVideoAdmin(d){
 return {lessons:arr(d.lessons,5000).map(l=>{if(!isObj(l)||!UUID.test(l.id))throw bad();return {id:l.id,title:str(l.title,{max:300})};}),
  authored:arr(d.authored,5000).map(a=>{if(!isObj(a)||!UUID.test(a.id))throw bad();return {id:a.id,title:str(a.title,{max:300}),lessonTitle:a.lessonTitle==null?null:str(a.lessonTitle,{max:300}),provider:str(a.provider,{max:40}),transcriptSource:a.transcriptSource==null?null:oneOf(a.transcriptSource,['authored','licensed','permitted']),hasNotes:a.hasNotes===true,publicationState:oneOf(a.publicationState,PUB),publishAt:a.publishAt==null?null:(date(a.publishAt),a.publishAt)};})};
}
export const videoAdmin=signal=>staffData('video-admin',{},signal).then(validateVideoAdmin);
const TIMED_LINE=/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/;
/** Port of parseTranscriptInput: all timed -> timed lines; none timed -> plain paragraphs; mix -> refused with line numbers. */
export function parseTranscriptInput(text){
 const rows=text.replace(/\r\n?/g,'\n').split('\n'),nonEmpty=rows.map((raw,index)=>({line:raw.trim(),index})).filter(r=>r.line);
 if(!nonEmpty.length)return {kind:'empty'};const timed=nonEmpty.filter(r=>TIMED_LINE.test(r.line));
 if(timed.length===nonEmpty.length)return {kind:'timed',lines:nonEmpty.map(r=>{const m=r.line.match(TIMED_LINE),[,a,b,c,body]=m;return {startSeconds:c?Number(a)*3600+Number(b)*60+Number(c):Number(a)*60+Number(b),text:body.trim()};})};
 if(!timed.length){const normalized=text.replace(/\r\n?/g,'\n').trim().replace(/\n{3,}/g,'\n\n');return {kind:'plain',text:normalized,paragraphs:normalized.split(/\n\s*\n/).filter(p=>p.trim()).length};}
 return {kind:'mixed',untimedLines:nonEmpty.filter(r=>!TIMED_LINE.test(r.line)).map(r=>r.index+1)};
}
/** Source parseQuestions: "prompt || a | b" ; a leading "gap_fill " switches stage; rows needing prompt>=3 and >=1 answer only. */
export function parseQuestions(text){
 const out=[];for(const raw of text.split('\n')){const line=raw.trim();if(!line)continue;const stage=line.startsWith('gap_fill ')?'gap_fill':'comprehension',body=stage==='gap_fill'?line.slice(9):line;
  const [p,a]=body.split('||'),prompt=(p??'').trim(),accepted=(a??'').split('|').map(x=>x.trim()).filter(Boolean);if(prompt.length>=3&&accepted.length>0)out.push({stage,prompt,acceptedAnswers:accepted});}
 return out;
}
/** Source vocabulary lines: word||pos||def||uz||ex. Each example MUST occur in the transcript text or the notes. */
export function parseVocabulary(text){return text.trim()?text.trim().split(/\r?\n/).map(line=>{const [word='',pos='',def='',uz='',ex='']=line.split('||').map(p=>p.trim());return {word,pos,def,uz,ex};}):[];}
export const vocabularyHasContext=(vocab,transcript,notes)=>{const hay=[transcript.kind==='plain'?transcript.text:transcript.kind==='timed'?transcript.lines.map(l=>l.text).join('\n'):'',notes].join('\n');return !vocab.some(e=>!hay.includes(e.ex)||!e.ex);};
/** Result {ok:true} or throws {status,code,reason}. `reason` (parse failure of the link) maps to dict.videoLessonAdmin.rejection. */
export async function createVideoLesson(input,signal){
 const r=await rawJson('POST','/api/admin/video-lessons',input,signal,{timeout:12000});
 if(!r.ok)throw Object.assign(new Error('video'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed',reason:typeof r.data?.reason==='string'?r.data.reason:undefined});
 return r.data;
}
