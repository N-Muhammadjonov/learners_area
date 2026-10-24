import {el,listen,mountStaff,errorText,heading,publicationControl} from './kit.js';
import {videoAdmin,parseTranscriptInput,parseQuestions,parseVocabulary,vocabularyHasContext,createVideoLesson} from '../../js/adapters/staff-final30/video.js';
const STAFF=['teacher','admin','owner'];
function form(ctx,lessons,view){
 const {dict,signal}=ctx,t=dict.videoLessonAdmin,S=(ctx.state.video??={lessonId:'',title:'',videoUrl:'',before:'',duration:'',notes:'',transcriptText:'',transcriptSource:'authored',vocabularyText:'',questionsText:'',busy:false,message:null});
 const bind=(n,k,evt='input')=>{n.value=S[k];listen(n,evt,()=>{const had=S.transcriptText.trim()!=='';S[k]=n.value;if(k==='transcriptText'&&had!==(S.transcriptText.trim()!==''))view.rerender();},signal);return n;};
 const lab=(text,node,help)=>el('label',{class:'flex flex-col gap-1 text-sm'},text,node,help?el('span',{class:'text-xs text-ink-500'},help):null);
 const sel=bind(el('select',{class:'input','data-video-lesson-select':''},el('option',{value:''},t.standaloneOption),lessons.map(l=>el('option',{value:l.id},l.title))),'lessonId','change');
 const f=el('form',{class:'flex flex-col gap-3','data-video-admin-form':''},el('p',{class:'text-sm text-ink-600'},t.intro),
  lab(t.videoUrl,bind(el('input',{class:'input',placeholder:'https://www.youtube.com/watch?v=…',required:'','data-video-url-input':'','data-focus-key':'v-url'}),'videoUrl')),
  lab(t.videoTitle,bind(el('input',{class:'input',required:'',minlength:'3',maxlength:'200','data-focus-key':'v-title'}),'title')),
  lab(t.notes,bind(el('textarea',{class:'input min-h-24',maxlength:'4000','data-video-notes-input':''}),'notes'),t.notesHelp),
  lab(t.transcriptText,bind(el('textarea',{class:'input min-h-28',maxlength:'20000','data-video-transcript-input':'','data-focus-key':'v-transcript'}),'transcriptText'),t.transcriptTextHelp),
  S.transcriptText.trim()?lab(t.transcriptSource,bind(el('select',{class:'input'},[['authored',t.sourceAuthored],['licensed',t.sourceLicensed],['permitted',t.sourcePermitted]].map(([v,l])=>el('option',{value:v},l))),'transcriptSource','change')):null,
  lab(t.vocabulary,bind(el('textarea',{class:'input min-h-24',maxlength:'20000','data-video-vocabulary-input':''}),'vocabularyText'),t.vocabularyHelp),
  lab(t.lessonOptional,sel),lab(t.beforeYouWatch,bind(el('textarea',{class:'input min-h-20',maxlength:'2000'}),'before')),
  lab(t.durationSeconds,bind(el('input',{type:'number',min:'0',class:'input max-w-40'}),'duration')),
  lab(t.questions,bind(el('textarea',{class:'input min-h-28 font-mono text-xs',placeholder:"What is the speaker's main point? || education matters | learning matters\ngap_fill The speaker says it is ___ || possible | achievable",'data-video-questions-input':''}),'questionsText'),t.questionsHelp),
  el('div',{class:'flex items-center gap-3'},el('button',{type:'submit',class:'btn-primary',disabled:S.busy},S.busy?t.saving:t.save),S.message?el('span',{class:S.message.tone==='ok'?'text-sm text-band-700':'text-sm text-warn-700','data-video-admin-message':S.message.tone},S.message.text):null));
 listen(f,'submit',async e=>{e.preventDefault();if(S.busy||signal.aborted||!f.checkValidity())return;
  const transcript=parseTranscriptInput(S.transcriptText);if(transcript.kind==='mixed'){S.message={tone:'bad',text:t.transcriptMixed};view.rerender();return;}
  const vocabulary=parseVocabulary(S.vocabularyText);if(!vocabularyHasContext(vocabulary,transcript,S.notes)){S.message={tone:'bad',text:t.vocabularyContextRequired};view.rerender();return;}
  S.busy=true;S.message=null;view.rerender();
  try{await createVideoLesson({lessonId:S.lessonId||null,title:S.title,videoUrl:S.videoUrl,beforeYouWatch:S.before||null,durationSeconds:S.duration?Number(S.duration):null,transcriptSource:transcript.kind==='empty'?null:S.transcriptSource,transcriptAttribution:null,transcript:transcript.kind==='timed'?transcript.lines:null,transcriptText:transcript.kind==='plain'?transcript.text:null,...(vocabulary.length?{vocabulary}:{}),notes:S.notes.trim()||null,questions:parseQuestions(S.questionsText)},signal);
   if(signal.aborted)return;Object.assign(S,{busy:false,message:{tone:'ok',text:t.saved},title:'',videoUrl:'',before:'',notes:'',questionsText:'',transcriptText:'',vocabularyText:''});view.rerender();await view.reload({quiet:true});}
  catch(x){if(signal.aborted)return;S.busy=false;S.message={tone:'bad',text:(x.reason&&t.rejection[x.reason])||(x.status?errorText(x,dict,{vocabulary_context_required:t.vocabularyContextRequired}):dict.errors.unknown)};view.rerender();}},signal);
 return f;
}
/** Source: admin/video-lessons/page.tsx + NewVideoLessonForm. Roles: teacher, admin, owner (publication control: admin/owner only). */
export const mount=mountStaff({name:'video-admin',roles:STAFF,load:c=>videoAdmin(c.signal),
 render(ctx,d,view){const {dict,session}=ctx,t=dict.videoLessonAdmin,isAdmin=['admin','owner'].includes(session.user.role);
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4','data-route-usable':'video-admin'},heading(t.title),
   el('div',{class:'flex flex-col gap-4','data-async-content':'video-admin'},el('div',{class:'card'},form(ctx,d.lessons,view)),
    el('div',{class:'card','data-video-admin-list':''},el('h2',{class:'mb-2 font-display text-lg text-ink-900'},t.existing),
     d.authored.length===0?el('p',{class:'text-sm text-ink-500'},t.none):el('ul',{class:'flex flex-col gap-2 text-sm'},d.authored.map(v=>el('li',{class:'flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/60 pb-2 last:border-0','data-video-lesson':v.id},el('span',{class:'text-ink-800'},v.title),
      el('div',{class:'flex flex-col items-end gap-1'},el('span',{class:'max-w-full break-words text-right text-xs text-ink-500'},v.lessonTitle?v.lessonTitle:el('span',{'data-video-admin-standalone':''},t.standaloneBadge),` · ${v.provider} · ${v.transcriptSource??t.transcriptSourceNone} · `,el('span',{'data-video-admin-notes':v.hasNotes?'yes':'no'},`${t.notes}: ${v.hasNotes?t.notesPresent:t.notesAbsent}`)),
       isAdmin?publicationControl(ctx,{type:'video',id:v.id,state:v.publicationState,publishAt:v.publishAt,onSaved:()=>view.reload({quiet:true})}):null)))))));}});
