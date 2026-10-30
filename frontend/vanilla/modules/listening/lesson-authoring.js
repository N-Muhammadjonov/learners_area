import {anySignal} from '../../js/signals.js';
// V41: Listening → Lessons → /app/listening/lessons/author (staff-only lesson authoring desk).
// Native port of src/components/lessons/LessonAuthoringDesk.tsx and its page. Behaviour is the source's:
// the lesson is hydrated from its editable revision, live lessons are never edited in place, the unit
// search is cursor-paged and generation-fenced, uploads keep the current file until a replacement
// finishes, and publication controls exist only when the server says the role may publish.
// Writes go through the existing content APIs only. Initial lists come from the proposed view projection.
import {el} from '../../js/dom.js';
import {viewData,requireFields} from '../../js/adapters/frontend.js';
import {failure} from '../../js/request-errors.js';
import {LESSON_BLOCK_TYPES,LEARNING_AREAS,LEARNING_AREA_LABELS,QUESTION_TYPES} from '../../js/generated/lesson-authoring-constants.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';

const MEDIA_KINDS=new Set(['audio','video','image','file']);
/** Full utility name in one literal: the compiled stylesheet is pinned, so the desk uses only existing utilities. */
const WIDE_SPAN='sm:col-span-2';
const ACCEPT={image:'image/*',audio:'audio/*',video:'video/*',file:'.pdf,.docx,.txt'};
/** Quiz payloads use a type id without a module: expose each selectable id once (first wins), as the source does. */
const quizTypes=QUESTION_TYPES.filter((type,index)=>QUESTION_TYPES.findIndex(entry=>entry.id===type.id)===index);
let counter=0;const localId=()=>`blk-${++counter}-${Date.now()}`;

function emptyQuiz(){return {questionType:'mcq_single',prompt:'',options:null,answer:'',explanation:null};}
function emptyBlock(type){
 const base={type,localId:localId(),uploadState:'idle',uploadError:'',progress:0,text:null,url:null,objectKey:null,originalName:null,mimeType:null,size:null,ref:null,quiz:null,optionsText:''};
 if(type==='text')return {...base,text:''};
 if(type==='link')return {...base,text:'',url:''};
 if(type==='quiz')return {...base,quiz:emptyQuiz()};
 if(type==='content_reference')return {...base,ref:{module:'ted',contentType:'video_lesson',sourceRef:'',versionId:null}};
 return base;
}
function blockFromModel(block){return {...block,localId:localId(),uploadState:'idle',uploadError:'',progress:0,optionsText:(block.quiz?.options??[]).join('\n')};}
/** Editable block → authored payload, mirroring lib/content/lesson-edit-shape.ts blockPayload. */
function blockPayload(block){
 switch(block.type){
  case 'text':return {type:'text',text:block.text??''};
  case 'link':return {type:'link',text:block.text??null,url:block.url??''};
  case 'image':case 'audio':case 'video':case 'file':return {type:block.type,objectKey:block.objectKey??null,originalName:block.originalName??null,mimeType:block.mimeType??null,size:block.size??null};
  case 'quiz':{const q=block.quiz??emptyQuiz();return {type:'quiz',quiz:{questionType:q.questionType??'mcq_single',prompt:q.prompt??'',options:q.options??null,answer:q.answer??'',explanation:q.explanation??null}};}
  case 'content_reference':return {type:'content_reference',ref:block.ref?{module:block.ref.module,contentType:block.ref.contentType,sourceRef:block.ref.sourceRef,versionId:block.ref.versionId??null}:null};
  default:return {type:block.type};
 }
}
function formFromModel(model,fallbackUnitId){return {title:model.title,slug:model.slug,sourceRef:model.sourceRef,learningArea:model.learningArea??'general',unitId:model.unitId||fallbackUnitId,summary:model.summary??'',teacherNotes:model.teacherNotes??'',estimatedMinutes:model.estimatedMinutes===null||model.estimatedMinutes===undefined?'':String(model.estimatedMinutes),blocks:model.blocks.map(blockFromModel)};}
function blankForm(area,unitId){return {title:'',slug:'',sourceRef:'',learningArea:area,unitId,summary:'',teacherNotes:'',estimatedMinutes:'',blocks:[]};}

/** Server-shaped issues only: a code and a short sentence. Anything else is dropped, as in sanitizeIssues. */
function sanitizeIssues(raw){return Array.isArray(raw)?raw.filter(i=>i&&typeof i.code==='string'&&typeof i.message==='string'&&i.message.length<=400).slice(0,20).map(i=>({code:i.code,message:i.message,...(typeof i.field==='string'?{field:i.field}:{})})):[];}

/** Mirrors requestJson: never throws for a failed exchange; aborts are rethrown for the caller to ignore. */
async function deskRequest(path,{method='GET',body,signal,timeoutMs=25000}={}){
 const timeout=AbortSignal.timeout(timeoutMs);
 let res;
 try{res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?anySignal([signal,timeout]):timeout});}
 catch(e){if(signal?.aborted)throw e;return {ok:false,status:0,kind:'network',error:null,issues:[],name:e?.name};}
 if(res.status===401)window.dispatchEvent(new Event('learners-area:auth-failure'));
 let data=null;
 try{data=await res.json();}catch{return {ok:false,status:res.status,kind:'parse',error:null,issues:[]};}
 if(!res.ok)return {ok:false,status:res.status,kind:res.status>=500?'server':'http',error:typeof data?.error==='string'?data.error:null,issues:sanitizeIssues(data?.issues),data};
 return {ok:true,status:res.status,data};
}

/* ---------------- uploads: the browser half of src/lib/uploads/client.ts ---------------- */
const ascii=(b,start,text)=>[...text].every((c,i)=>b[start+i]===c.charCodeAt(0));
const isZip=b=>b[0]===0x50&&b[1]===0x4b&&(b[2]===3||b[2]===5||b[2]===7);
const isIsoBmff=b=>ascii(b,4,'ftyp')||ascii(b,4,'moov')||ascii(b,4,'mdat')||ascii(b,4,'wide')||ascii(b,4,'free');
const isText=b=>{for(let i=0;i<Math.min(b.length,4096);i++)if(b[i]===0)return false;return true;};
function fileExtension(name){const m=/\.[^./\\]+$/.exec(String(name).toLowerCase());return m?m[0]:'';}
/** Magic-byte pre-check: the executable test is exact; per-type checks are the source's, with audio checked leniently. */
function verifyHead(name,b){
 if(b.length===0)return 'mismatch';
 if((b[0]===0x4d&&b[1]===0x5a)||ascii(b,0,'\u007fELF')||ascii(b,0,'#!')||(b[0]===0xcf&&b[1]===0xfa&&b[2]===0xed&&b[3]===0xfe)||(b[0]===0xfe&&b[1]===0xed&&b[2]===0xfa&&b[3]===0xcf))return 'executable';
 const ok={'.pdf':ascii(b,0,'%PDF'),'.docx':isZip(b),'.pptx':isZip(b),'.xlsx':isZip(b),'.zip':isZip(b),'.txt':isText(b),'.csv':isText(b),'.md':isText(b),'.html':isText(b),'.htm':isText(b),'.xml':isText(b),'.json':isText(b),
  '.png':b[0]===0x89&&ascii(b,1,'PNG'),'.jpg':b[0]===0xff&&b[1]===0xd8,'.jpeg':b[0]===0xff&&b[1]===0xd8,'.gif':ascii(b,0,'GIF8'),'.webp':ascii(b,0,'RIFF')&&ascii(b,8,'WEBP'),
  '.mp4':isIsoBmff(b),'.mov':isIsoBmff(b),'.m4v':isIsoBmff(b),'.m4a':isIsoBmff(b),'.webm':b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3,
  '.mp3':ascii(b,0,'ID3')||(b[0]===0xff&&(b[1]&0xe0)===0xe0),'.wav':ascii(b,0,'RIFF')&&ascii(b,8,'WAVE'),'.aac':ascii(b,0,'ADIF')||(b[0]===0xff&&(b[1]&0xf6)===0xf0),
  '.ogg':ascii(b,0,'OggS'),'.oga':ascii(b,0,'OggS'),'.opus':ascii(b,0,'OggS'),'.flac':ascii(b,0,'fLaC')}[fileExtension(name)];
 return ok?'ok':'mismatch';
}
const UPLOAD_STATUS_CODES={401:'unauthenticated',403:'forbidden',404:'not_found',413:'file_too_large',429:'rate_limited',408:'upload_timeout',504:'upload_timeout'};
function uploadCodeFor(status,body,messages){
 const technical=typeof body?.code==='string'?body.code:typeof body?.error==='string'?body.error:null;
 if(technical&&messages[technical])return technical;
 if(UPLOAD_STATUS_CODES[status])return UPLOAD_STATUS_CODES[status];
 return status>=500?'server_error':'unknown';
}
function uploadMessage(code,correlationId,messages){const template=messages[code]??messages.unknown??'';return template.replace('{max}','').replace('{ref}',correlationId??'—');}

/** Upload one file for a block. Resolves with {ok,objectKey} or {ok:false,code,correlationId}. Never throws. */
function uploadFile(file,{blockKind,onState,onProgress,messages,track}){
 const fail=(code,correlationId)=>({ok:false,code,correlationId});
 const run=async()=>{
  onState('queued');
  let head;try{head=new Uint8Array(await file.slice(0,4096).arrayBuffer());}catch{return fail('missing_file');}
  const verdict=verifyHead(file.name,head);
  if(verdict!=='ok')return fail(verdict==='executable'?'dangerous_type':'type_mismatch');
  let intent;
  try{
   const res=await fetch('/api/uploads/intent',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'material_block',blockKind,filename:file.name,contentType:file.type||'application/octet-stream',size:file.size})});
   const data=await res.json().catch(()=>null);
   if(!res.ok)return fail(uploadCodeFor(res.status,data,messages),typeof data?.correlationId==='string'?data.correlationId.slice(0,64):undefined);
   if(!data||typeof data.uploadId!=='string')return fail('server_error');
   intent=data;
  }catch{return fail('network_error');}
  onState('uploading');
  const put=await sendBytes(file,intent,onProgress,track);
  if(!put.ok)return put;
  onState('finalizing');
  try{
   const res=await fetch('/api/uploads/finalize',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:intent.uploadId})});
   const data=await res.json().catch(()=>null);
   if(!res.ok)return fail(uploadCodeFor(res.status,data,messages),typeof data?.correlationId==='string'?data.correlationId.slice(0,64):undefined);
  }catch{return fail('network_error');}
  onState('complete');
  return {ok:true,objectKey:intent.objectKey};
 };
 return run();
 function sendBytes(f,in_,progress,trackXhr){
  return new Promise(resolve=>{
   const request=new XMLHttpRequest();trackXhr(request);
   const direct=in_.mode==='direct'&&in_.uploadUrl;
   request.upload.addEventListener('progress',e=>{if(e.lengthComputable)progress(Math.round((e.loaded/e.total)*100));});
   request.addEventListener('load',()=>{if(request.status>=200&&request.status<300){progress(100);resolve({ok:true});}else{let body=null;try{body=JSON.parse(request.responseText);}catch{}resolve(direct&&!body&&request.status>=400&&request.status<500?fail('storage_rejected'):fail(uploadCodeFor(request.status,body,messages)));}});
   request.addEventListener('error',()=>resolve(fail(direct?'storage_rejected':'network_error')));
   request.addEventListener('abort',()=>resolve(fail('cancelled')));
   request.addEventListener('timeout',()=>resolve(fail('upload_timeout')));
   if(direct){request.open('PUT',in_.uploadUrl);request.setRequestHeader('Content-Type',in_.contentType);request.send(f);}
   else{const form=new FormData();form.append('uploadId',in_.uploadId);form.append('file',f);request.open('POST','/api/uploads');request.send(form);}
  });
 }
}

/* ---------------- the desk ---------------- */
export function mount(context){
 const {root,url,signal,dict,navigate,session,locale}=context;
 const t=dict.listening.lessons.authoring,issueText=dict.listening.lessons.authoringIssues,messages=dict.uploadErrors;
 const routePath=url.pathname;
 const authorArea=routePath==='/app/grammar/lessons/author'?'grammar':routePath==='/app/reading/lessons/author'?'reading':routePath==='/app/listening/lessons/author'?'listening':null;
 if(!authorArea)throw Error('Unknown lesson authoring area');
 if(!['teacher','admin','owner'].includes(session?.user?.role)){void navigate('/app',{replace:true});return;}
 const lessonListHref='/app/'+authorArea+'/lessons';
 const lessonBackLabel=authorArea==='grammar'?dict.grammar.lessonBack:authorArea==='reading'?dict.readingV4.lessonBack:dict.listening.lessons.backToList;
 const lessonListLabel=authorArea==='grammar'?dict.grammar.lessonsTitle:authorArea==='reading'?dict.readingV4.products.lessons.title:dict.listening.lessons.title;
 const host=el('div',{'data-listening-lesson-authoring':'','data-lesson-authoring-area':authorArea});root.append(host);
 const lang=locale==='uz'?'uz':'en';
 const areaLabel=value=>LEARNING_AREA_LABELS[value]?.[lang]??value;
 const pending=new Set();const xhrs=new Set();
 let lessons=[],units=[],canPublish=false,selection='none',model=null,form=null,loading=false,busy=false,issues=[],notice=null,dirty=false,publishAt='',uploadTarget=null,loadToken=0;
 const unit={query:'',results:null,searching:false,cursor:null,failed:false,selected:null,gen:0,abort:null,timer:null};
 const sel={};
 let disposed=false;
 const fileInput=el('input',{type:'file',class:'hidden','data-lesson-authoring-file':''});
 fileInput.addEventListener('change',()=>{const picked=Array.from(fileInput.files??[]);fileInput.value='';onFilePicked(picked);},{signal});

 /* ---- structure: built once, regions re-rendered as state changes ---- */
 const listEl=el('div',{class:'flex flex-col gap-2'});
 const mainEl=el('section',{class:'flex min-w-0 flex-col gap-4 sm:col-span-2'});
 const desk=el('div',{class:'grid grid-cols-1 sm:grid-cols-3 gap-5','data-lesson-authoring-desk':'','data-lesson-authoring-can-publish':'false'},
  el('aside',{class:'flex flex-col gap-2'},listEl),mainEl,fileInput);

 function renderList(){
  const newButton=el('button',{type:'button',class:'btn-secondary','data-lesson-authoring-new':''},t.newLesson);
  newButton.addEventListener('click',startNew,{signal});
  const children=[el('div',{class:'flex items-center justify-between gap-2'},el('h2',{class:'font-display text-lg text-ink-900'},t.lessonsTitle),newButton)];
  if(lessons.length===0)children.push(el('p',{class:'text-sm text-ink-500','data-lesson-authoring-empty':''},t.lessonsEmpty));
  else children.push(el('ul',{class:'flex flex-col gap-1','data-lesson-authoring-list':''},lessons.map(lesson=>{
   const item=el('button',{type:'button',class:`w-full rounded-lg border px-3 py-2 text-left text-sm ${selection===lesson.id?'border-ink-300 bg-ink-50':'border-ink-100'}`,'data-lesson-authoring-item':lesson.id,
    'data-lesson-authoring-item-published':lesson.published?lesson.published.versionNo:null,'data-lesson-authoring-item-draft':lesson.draft?lesson.draft.versionNo:null},
    el('span',{class:'block font-medium text-ink-900',text:lesson.title}),
    el('span',{class:'block text-xs text-ink-300'},`${lesson.learningArea?areaLabel(lesson.learningArea):t.unclassified}${lesson.published?` · ${t.publishedLabel} v${lesson.published.versionNo}`:''}${lesson.draft?` · ${t.editingLabel} v${lesson.draft.versionNo}`:''}`));
   item.addEventListener('click',()=>void openLesson(lesson.id),{signal});
   return el('li',{},item);
  })));
  listEl.replaceChildren(...children);
 }

 function renderMain(){
  desk.setAttribute('data-lesson-authoring-can-publish',canPublish?'true':'false');
  if(selection==='none'||!form){
   mainEl.replaceChildren(el('div',{class:'rounded-xl border border-ink-100 p-6 text-sm text-ink-500','data-lesson-authoring-idle':''},
    el('p',{},loading?t.loadingLesson:t.selectLesson),...(canPublish?[]:[el('p',{class:'mt-2 text-xs text-ink-300','data-lesson-authoring-no-publish':''},t.cannotPublish)]),...feedbackNodes()));
   return;
  }
  const existing=selection!=='new'?selection:null;
  const heading=el('h2',{class:'font-display text-lg text-ink-900'},selection==='new'?t.newLessonHeading:t.editingLessonHeading);
  sel.statusSlot=el('span',{},statusNode());
  sel.status=el('div',{class:'flex flex-wrap items-center justify-between gap-2'},heading,sel.statusSlot);
  sel.revision=el('div',{});
  sel.loading=el('p',{class:'text-sm text-ink-500'});
  const field=(id,label,control,extra=[],wide=false)=>el('div',{class:wide?WIDE_SPAN:''},el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},label),control,...extra);
  const input=(id,value,attrs={},onInput)=>{const node=el('input',{id,class:'input',...attrs});node.value=value??'';if(onInput)node.addEventListener('input',()=>onInput(node.value),{signal});return node;};
  const textarea=(id,value,attrs={},onInput)=>{const node=el('textarea',{id,class:'input min-h-[160px] resize-y font-sans leading-relaxed',...attrs});node.value=value??'';if(onInput)node.addEventListener('input',()=>onInput(node.value),{signal});return node;};
  const title=input('lesson-title',form.title,{'data-lesson-authoring-title':''},v=>patchForm({title:v}));
  const slug=input('lesson-slug',form.slug,{'data-lesson-authoring-slug':''},v=>patchForm({slug:v}));
  const sourceRef=input('lesson-ref',form.sourceRef,{'data-lesson-authoring-source-ref':'','data-lesson-authoring-source-ref-locked':existing?'true':'false',...(existing?{readonly:'',disabled:''}:{})},v=>patchForm({sourceRef:v}));
  const areaSelect=el('select',{id:'lesson-area',class:'input','data-lesson-authoring-area':''},LEARNING_AREAS.map(c=>el('option',{value:c},areaLabel(c))));
  areaSelect.value=form.learningArea;
  areaSelect.addEventListener('change',()=>patchForm({learningArea:areaSelect.value}),{signal});
  const unitSearch=el('input',{type:'search',class:'input mb-2',placeholder:t.fieldUnitSearch,'aria-label':t.fieldUnitSearch,'aria-controls':'lesson-unit','data-lesson-unit-search':''});
  unitSearch.value=unit.query;
  unitSearch.addEventListener('input',()=>onUnitQuery(unitSearch.value),{signal});
  sel.unitSelect=el('select',{id:'lesson-unit',class:'input','data-lesson-authoring-unit':''});
  sel.unitSelect.addEventListener('change',()=>{const picked=unitOptions().find(u=>u.id===sel.unitSelect.value);if(picked)unit.selected={id:picked.id,label:picked.label};patchForm({unitId:sel.unitSelect.value});},{signal});
  sel.unitStatus=el('p',{class:'mt-1 text-xs text-ink-300',role:'status','data-lesson-unit-status':''});
  sel.unitRetry=el('button',{type:'button',class:'mt-1 text-xs underline','data-lesson-unit-retry':''},t.fieldUnitRetry);
  sel.unitRetry.addEventListener('click',()=>onUnitQuery(unit.query,true),{signal});
  sel.unitMore=el('button',{type:'button',class:'mt-1 text-xs underline','data-lesson-unit-more':''},t.fieldUnitMore);
  sel.unitMore.addEventListener('click',()=>{void fetchUnits(unit.query.trim(),unit.cursor,invalidateUnits());},{signal});
  const minutes=input('lesson-minutes',form.estimatedMinutes,{type:'number',min:1,max:600,'data-lesson-authoring-minutes':''},v=>patchForm({estimatedMinutes:v}));
  const summary=textarea('lesson-summary',form.summary,{'data-lesson-authoring-summary':''},v=>patchForm({summary:v}));
  const teacherNotes=textarea('lesson-teacher-notes',form.teacherNotes,{'data-lesson-authoring-teacher-notes':''},v=>patchForm({teacherNotes:v}));
  sel.blocksHost=el('div',{class:'flex flex-col gap-2'});
  const typeButtons=LESSON_BLOCK_TYPES.map(type=>{const b=el('button',{type:'button',class:'btn-secondary','data-lesson-authoring-add':type},`+ ${t.blockTypes[type]}`);b.addEventListener('click',()=>addBlock(type),{signal});return b;});
  sel.save=el('button',{type:'button',class:'btn-primary','data-lesson-authoring-save':''});
  sel.save.addEventListener('click',()=>void save(),{signal});
  sel.footer=el('div',{class:'flex flex-col gap-3'});
  mainEl.replaceChildren(
   sel.status,
   sel.revision,
   sel.loading,
   el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2'},
    field('lesson-title',t.fieldTitle,title,[],true),
    field('lesson-slug',t.fieldSlug,slug),
    field('lesson-ref',t.fieldSourceRef,sourceRef,existing?[el('p',{class:'mt-1 text-xs text-ink-300'},t.sourceRefLocked)]:[]),
    field('lesson-area',t.fieldArea,areaSelect,[]),
    field('lesson-unit',t.fieldUnit,el('div',{},unitSearch,sel.unitSelect,sel.unitStatus,sel.unitRetry,sel.unitMore)),
    field('lesson-minutes',t.fieldMinutes,minutes),
    field('lesson-summary',t.fieldDescription,summary,[],true),
    field('lesson-teacher-notes',t.fieldTeacherNotes,teacherNotes,[el('p',{class:'mt-1 text-xs text-ink-300'},t.fieldTeacherNotesHelp)],true)),
   el('div',{class:'flex flex-col gap-2'},
    el('div',{class:'flex flex-wrap items-center gap-2'},el('h3',{class:'font-display text-base text-ink-900'},t.blocksTitle),...typeButtons),
    sel.blocksHost),
   sel.footer);
  // Re-used controls keep their state across rebuilds of the footer and blocks.
  renderBlocks();renderUnits();renderRevision();renderFooter();renderLoading();
  void ensureUnitLabel();
 }

 function statusNode(){
  if(selection==='none')return el('span',{});
  if(selection==='new')return el('span',{class:'flex flex-wrap items-center gap-2 text-xs text-ink-500','data-lesson-authoring-status':''},el('span',{class:'text-ink-300'},t.newLessonHeading),dirty?el('span',{class:'text-ink-500','data-lesson-authoring-dirty':''},t.unsavedChanges):null);
  const pub=model?.published,draft=model?.draft,scheduled=model?.scheduled;
  return el('span',{class:'flex flex-wrap items-center gap-2 text-xs text-ink-500','data-lesson-authoring-status':''},
   pub?el('span',{class:'rounded-full bg-ink-50 px-2 py-0.5','data-lesson-authoring-published':pub.versionNo},`${t.publishedLabel} v${pub.versionNo}`):el('span',{class:'rounded-full bg-ink-50 px-2 py-0.5'},t.noRevisionLabel),
   draft?el('span',{class:'rounded-full bg-ink-50 px-2 py-0.5','data-lesson-authoring-draft':draft.versionNo},`${t.editingLabel} v${draft.versionNo}`):null,
   scheduled?el('span',{class:'rounded-full bg-ink-50 px-2 py-0.5','data-lesson-authoring-scheduled':scheduled.versionNo},`${t.scheduledLabel} v${scheduled.versionNo}`):null,
   dirty?el('span',{class:'text-ink-500','data-lesson-authoring-dirty':''},t.unsavedChanges):el('span',{class:'text-ink-300'},t.allChangesSaved));
 }
 function renderStatus(){if(sel.statusSlot)sel.statusSlot.replaceChildren(statusNode());}
 function renderLoading(){if(sel.loading)sel.loading.textContent=loading?t.loadingLesson:'';}
 const liveWithoutDraft=()=>Boolean(model&&model.live&&!model.draft);

 function renderRevision(){
  if(!sel.revision)return;
  if(!liveWithoutDraft()){sel.revision.replaceChildren();return;}
  const b=el('button',{type:'button',class:'btn-primary mt-2','data-lesson-authoring-start-revision':''},busy?t.creatingRevision:t.createRevision);
  b.disabled=busy;b.addEventListener('click',()=>void startRevision(),{signal});
  sel.revision.replaceChildren(el('div',{class:'rounded-xl border border-ink-100 p-3','data-lesson-authoring-needs-revision':''},el('p',{class:'text-sm text-ink-500'},t.revisionNoneBody),b));
 }

 function feedbackNodes(){
  const nodes=[];
  if(issues.length)nodes.push(el('div',{class:'rounded-xl border border-band-bad/40 p-3','data-lesson-authoring-issues':''},
   el('p',{class:'text-sm font-medium text-band-bad'},t.issuesTitle),
   el('ul',{class:'mt-1 list-disc pl-5 text-sm text-ink-700'},issues.map(issue=>el('li',{'data-lesson-authoring-issue':issue.code},`${issue.field?`${issue.field}: `:''}${describeIssue(issue)}`)))));
  if(notice)nodes.push(el('p',{class:'text-sm text-band-good','data-lesson-authoring-message':''},notice));
  return nodes;
 }
 function renderFooter(){
  if(!sel.footer)return;
  sel.save.textContent=busy?dict.common.saving:t.save;
  sel.save.disabled=busy||liveWithoutDraft();
  const editable=Boolean(model?.draft?.versionId);
  const actions=[sel.save];
  if(canPublish){
   const at=el('input',{type:'datetime-local',class:'input max-w-xs','aria-label':t.scheduleAt,'data-lesson-authoring-schedule-at':''});
   at.value=publishAt;at.addEventListener('input',()=>{publishAt=at.value;sel.schedule.disabled=busy||!editable||!publishAt;},{signal});
   const mk=(label,attr,to,disabled)=>{const b=el('button',{type:'button',class:'btn-secondary',...attr},label);b.disabled=disabled;b.addEventListener('click',()=>void movePublication(to),{signal});return b;};
   sel.schedule=mk(t.schedule,{'data-lesson-authoring-schedule':''},'scheduled',busy||!editable||!publishAt);
   actions.push(at,mk(t.publish,{'data-lesson-authoring-publish':''},'published',busy||!editable),sel.schedule,mk(t.archive,{'data-lesson-authoring-archive':''},'archived',busy||!editable));
  }else actions.push(el('span',{class:'text-xs text-ink-300','data-lesson-authoring-no-publish':''},t.cannotPublish));
  const feedback=[];
  if(editable&&!canPublish)feedback.push(el('p',{class:'text-xs text-ink-300'},t.draftSaveHint));
  feedback.push(...feedbackNodes());
  sel.footer.replaceChildren(el('div',{class:'flex flex-wrap items-center gap-2'},...actions),...feedback);
 }

 function describeIssue(issue){return issueText[issue.code]??issue.message;}

 function renderBlocks(){
  if(!sel.blocksHost||!form)return;
  if(form.blocks.length===0){sel.blocksHost.replaceChildren(el('p',{class:'text-sm text-ink-500'},t.blocksEmpty));return;}
  sel.blocksHost.replaceChildren(el('ol',{class:'flex flex-col gap-2','data-lesson-authoring-blocks':''},form.blocks.map((block,index)=>blockNode(block,index))));
 }

 function blockNode(block,index){
  const id=block.localId;
  const btn=(label,aria,handler,attrs={})=>{const b=el('button',{type:'button',class:'btn-secondary','aria-label':aria,...attrs},label);b.addEventListener('click',handler,{signal});return b;};
  const li=el('li',{class:'rounded-xl border border-ink-100 p-3','data-lesson-authoring-block':block.type,'data-local-id':id},
   el('div',{class:'flex flex-wrap items-center justify-between gap-2'},
    el('span',{class:'text-xs uppercase tracking-wide text-ink-300'},`${index+1}. ${t.blockTypes[block.type]??block.type}`),
    el('span',{class:'flex items-center gap-1'},
     btn('↑',t.moveUp,()=>moveBlock(id,-1),{'data-lesson-authoring-move-up':''}),
     btn('↓',t.moveDown,()=>moveBlock(id,1),{'data-lesson-authoring-move-down':''}),
     btn('✕',t.removeBlock,()=>removeBlock(id),{'data-lesson-authoring-remove':''}))));
  if(block.type==='text'||block.type==='link'){
   const ta=el('textarea',{class:'input min-h-[160px] resize-y font-sans leading-relaxed mt-2',placeholder:t.blockTextPlaceholder});ta.value=block.text??'';
   ta.addEventListener('input',()=>patchBlock(id,{text:ta.value}),{signal});li.append(ta);
  }
  if(block.type==='link'){
   const url=el('input',{class:'input mt-2',placeholder:'https://'});url.value=block.url??'';
   url.addEventListener('input',()=>patchBlock(id,{url:url.value}),{signal});li.append(url);
  }
  if(MEDIA_KINDS.has(block.type)){
   const upload=el('button',{type:'button',class:'btn-secondary','data-lesson-authoring-upload':''},block.objectKey?t.replaceFile:t.chooseFile);
   upload.addEventListener('click',()=>pickFile(id),{signal});
   li.append(el('div',{class:'mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500','data-upload-slot':''},upload,...uploadParts(block),el('span',{class:'text-ink-300'},t.mediaKeepHint)));
  }
  if(block.type==='quiz'){
   const q=block.quiz??emptyQuiz();
   const typeSelect=el('select',{class:'input','aria-label':t.quizType,'data-lesson-authoring-quiz-type':''},quizTypes.map(type=>el('option',{value:type.id},type.label)));
   typeSelect.value=q.questionType??'mcq_single';
   typeSelect.addEventListener('change',()=>patchQuiz(id,{questionType:typeSelect.value}),{signal});
   const prompt=el('input',{class:'input',placeholder:t.quizPrompt});prompt.value=q.prompt??'';
   prompt.addEventListener('input',()=>patchQuiz(id,{prompt:prompt.value}),{signal});
   const options=el('textarea',{class:'input min-h-[160px] resize-y font-sans leading-relaxed',placeholder:t.quizOptionsLabel});options.value=block.optionsText??'';
   options.addEventListener('input',()=>{const b=findBlock(id);if(!b)return;b.optionsText=options.value;patchQuiz(id,{options:options.value.split('\n').map(l=>l.trim()).filter(Boolean)});},{signal});
   const answer=el('input',{class:'input',placeholder:t.quizAnswer});answer.value=q.answer??'';
   answer.addEventListener('input',()=>patchQuiz(id,{answer:answer.value}),{signal});
   const explanation=el('input',{class:'input',placeholder:t.quizExplanation});explanation.value=q.explanation??'';
   explanation.addEventListener('input',()=>patchQuiz(id,{explanation:explanation.value}),{signal});
   li.append(el('div',{class:'mt-2 flex flex-col gap-2'},typeSelect,prompt,options,answer,explanation));
  }
  if(block.type==='content_reference'){
   const r=block.ref??{module:'ted',contentType:'video_lesson',sourceRef:'',versionId:null};
   const field=(key,placeholder)=>{const node=el('input',{class:'input',placeholder});node.value=r[key]??'';node.addEventListener('input',()=>patchRef(id,{[key]:node.value}),{signal});return node;};
   li.append(el('div',{class:'mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2'},field('module',t.refModule),field('contentType',t.refContentType),field('sourceRef',t.refSourceRef)),el('p',{class:'mt-1 text-xs text-ink-300'},t.referenceHint));
  }
  return li;
 }

 function uploadParts(block){
  const parts=[];
  if(block.uploadState==='uploading')parts.push(el('span',{'data-lesson-authoring-upload-state':'uploading'},`${t.uploading} ${block.progress}%`));
  if(block.uploadState==='failed')parts.push(el('span',{class:'text-band-bad','data-lesson-authoring-upload-state':'failed'},block.uploadError));
  if(block.objectKey)parts.push(el('span',{'data-lesson-authoring-object':block.objectKey},block.originalName??block.objectKey));
  return parts;
 }
 function renderBlockUpload(id){
  const li=sel.blocksHost?.querySelector(`[data-local-id="${CSS.escape(id)}"]`);const block=findBlock(id);
  const slot=li?.querySelector('[data-upload-slot]');if(!slot||block==null)return;
  const upload=slot.querySelector('[data-lesson-authoring-upload]');
  upload.textContent=block.objectKey?t.replaceFile:t.chooseFile;
  slot.replaceChildren(upload,...uploadParts(block),el('span',{class:'text-ink-300'},t.mediaKeepHint));
 }

 /* ---- units ---- */
 function invalidateUnits(){unit.abort?.abort();unit.abort=null;unit.gen+=1;return unit.gen;}
 function unitOptions(){
  const visible=unit.results??units;const chosen=form?.unitId;
  if(!chosen||visible.some(u=>u.id===chosen))return visible;
  const known=(unit.selected?.id===chosen?unit.selected:undefined)??units.find(u=>u.id===chosen)??unit.results?.find(u=>u.id===chosen);
  return known?[{id:known.id,label:known.label,course:''},...visible]:visible;
 }
 function renderUnits(){
  if(!sel.unitSelect)return;
  const options=unitOptions();
  sel.unitSelect.replaceChildren(...options.map(u=>el('option',{value:u.id},u.label)));
  if(form)sel.unitSelect.value=form.unitId;
  sel.unitStatus.textContent=unit.searching?t.fieldUnitSearching:unit.failed?t.fieldUnitFailed:unit.results?t.fieldUnitResults.replace('{n}',String(unit.results.length)):'';
  sel.unitRetry.hidden=!(unit.failed&&!unit.searching);
  sel.unitMore.hidden=!(unit.cursor&&!unit.searching&&!unit.failed);
 }
 function onUnitQuery(value,retry=false){
  unit.query=value;const term=value.trim();const gen=invalidateUnits();clearTimeout(unit.timer);
  if(!term){unit.results=null;unit.cursor=null;unit.searching=false;unit.failed=false;renderUnits();return;}
  if(retry){void fetchUnits(term,null,gen);return;}
  unit.timer=setTimeout(()=>{void fetchUnits(term,null,gen);},250);
 }
 async function fetchUnits(term,cursor,gen){
  if(gen!==unit.gen||disposed)return;
  const controller=new AbortController();unit.abort=controller;unit.searching=true;unit.failed=false;renderUnits();
  try{
   const params=new URLSearchParams();if(term)params.set('q',term);if(cursor)params.set('cursor',cursor);
   const res=await fetch(`/api/lessons/units?${params.toString()}`,{credentials:'same-origin',signal:controller.signal});
   if(gen!==unit.gen)return;
   if(!res.ok){unit.failed=true;return;}
   const data=await res.json();
   if(gen!==unit.gen)return;
   const batch=Array.isArray(data.options)?data.options:[];
   unit.results=cursor&&unit.results?[...unit.results,...batch]:batch;
   unit.cursor=typeof data.nextCursor==='string'?data.nextCursor:null;
  }catch{if(gen===unit.gen&&!controller.signal.aborted)unit.failed=true;}
  finally{if(gen===unit.gen){unit.searching=false;renderUnits();}}
 }
 async function ensureUnitLabel(){
  const chosen=form?.unitId;
  if(!chosen){unit.selected=null;return;}
  if(unit.selected?.id===chosen)return;
  const known=(unit.results??[]).find(u=>u.id===chosen)??units.find(u=>u.id===chosen);
  if(known){unit.selected={id:known.id,label:known.label};renderUnits();return;}
  try{
   const res=await fetch(`/api/lessons/units?ids=${encodeURIComponent(chosen)}`,{credentials:'same-origin'});
   if(!res.ok||signal.aborted)return;
   const data=await res.json();
   const found=Array.isArray(data.options)?data.options.find(u=>u.id===chosen):null;
   if(found&&form?.unitId===chosen&&!signal.aborted){unit.selected={id:found.id,label:found.label};renderUnits();}
  }catch{/* A failed label lookup leaves the selection intact and unnamed. */}
 }

 /* ---- state transitions ---- */
 function findBlock(id){return form?.blocks.find(b=>b.localId===id)??null;}
 function patchForm(changes){if(!form)return;Object.assign(form,changes);dirty=true;renderStatus();}
 function patchBlock(id,changes){const b=findBlock(id);if(!b)return;Object.assign(b,changes);dirty=true;renderStatus();}
 function patchQuiz(id,changes){const b=findBlock(id);if(!b)return;b.quiz={...(b.quiz??emptyQuiz()),...changes};dirty=true;renderStatus();}
 function patchRef(id,changes){const b=findBlock(id);if(!b)return;b.ref={...(b.ref??{module:'ted',contentType:'video_lesson',sourceRef:'',versionId:null}),...changes};dirty=true;renderStatus();}
 function addBlock(type){if(!form)return;form.blocks=[...form.blocks,emptyBlock(type)];dirty=true;renderBlocks();renderStatus();}
 function removeBlock(id){if(!form)return;form.blocks=form.blocks.filter(b=>b.localId!==id);dirty=true;renderBlocks();renderStatus();}
 function moveBlock(id,direction){
  if(!form)return;const index=form.blocks.findIndex(b=>b.localId===id);const target=index+direction;
  if(index<0||target<0||target>=form.blocks.length)return;
  const blocks=[...form.blocks];[blocks[index],blocks[target]]=[blocks[target],blocks[index]];form.blocks=blocks;dirty=true;
  renderBlocks();renderStatus();
  sel.blocksHost?.querySelector(`[data-local-id="${CSS.escape(id)}"] ${direction<0?'[data-lesson-authoring-move-up]':'[data-lesson-authoring-move-down]'}`)?.focus();
 }
 function pickFile(id){
  const block=findBlock(id);if(block==null||block.uploadState==='uploading')return;
  uploadTarget=id;fileInput.accept=ACCEPT[block.type]??'';fileInput.value='';fileInput.click();
 }
 function onFilePicked(files){
  const target=uploadTarget;const file=files?.[0];uploadTarget=null;
  if(!target||!file||!form)return;
  const block=findBlock(target);if(block==null)return;
  const kind=MEDIA_KINDS.has(block.type)?block.type:'file';
  patchBlock(target,{uploadState:'uploading',uploadError:'',progress:0});renderBlockUpload(target);
  let trackedXhr=null;
  const run=uploadFile(file,{blockKind:kind,messages,track:x=>{xhrs.add(x);trackedXhr=x;},
   onState:state=>{if(state==='complete')return;const b=findBlock(target);if(b){b.uploadState=state==='failed'?'failed':'uploading';renderBlockUpload(target);}},
   onProgress:progress=>{const b=findBlock(target);if(b){b.progress=progress;renderBlockUpload(target);}}});
  pending.add(run);
  void run.then(outcome=>{
   pending.delete(run);if(trackedXhr)xhrs.delete(trackedXhr);
   if(disposed)return;
   const b=findBlock(target);
   if(!b)return;
   if(outcome.ok){Object.assign(b,{objectKey:outcome.objectKey,originalName:file.name,mimeType:file.type,size:file.size,uploadState:'idle',uploadError:''});notice=t.mediaReplaced;}
   else{Object.assign(b,{uploadState:'failed',uploadError:uploadMessage(outcome.code,outcome.correlationId,messages)});notice=t.mediaFailed;}
   dirty=dirty||outcome.ok;renderBlockUpload(target);renderStatus();renderFooter();
  });
 }

 function revisionFrom(lesson){model=lesson;form=formFromModel(lesson,unitOptions()[0]?.id??'');dirty=false;}

 async function loadLesson(lessonId,{keepNotice=false}={}){
  const token=++loadToken;
  loading=true;issues=[];if(!keepNotice)notice=null;form=null;model=null;renderMain();
  const result=await deskRequest(`/api/admin/content/lessons/${encodeURIComponent(lessonId)}/edit`,{signal});
  if(disposed||token!==loadToken)return null;
  loading=false;
  if(!result.ok){issues=result.issues?.length?result.issues:[{code:'load_failed',message:t.loadFailed}];renderMain();return null;}
  revisionFrom(result.data.lesson);
  renderMain();
  return model;
 }

 async function openLesson(lessonId){
  if(selection===lessonId)return;
  if(dirty&&!window.confirm(t.discardConfirm))return;
  selection=lessonId;renderList();
  await loadLesson(lessonId);
  renderList();
 }
 function startNew(){
  if(dirty&&!window.confirm(t.discardConfirm))return;
  selection='new';model=null;form=blankForm(authorArea,unitOptions()[0]?.id??'');issues=[];notice=null;dirty=false;loading=false;loadToken++;
  renderList();renderMain();
 }

 async function startRevision(){
  const existing=selection!=='new'&&selection!=='none'?selection:null;
  if(!existing||busy)return;
  busy=true;issues=[];notice=null;renderRevision();renderFooter();
  const result=await deskRequest(`/api/admin/content/lessons/${encodeURIComponent(existing)}/revision`,{method:'POST',signal});
  if(disposed)return;
  busy=false;
  if(!result.ok){issues=result.issues?.length?result.issues:[{code:'revision_failed',message:failureMessageFor(result)}];renderRevision();renderFooter();return;}
  revisionFrom(result.data.lesson);
  notice=result.data.created?t.revisionCreated:t.revisionExistsOpened;
  renderMain();await refreshList();
 }

 async function save(){
  if(!form||busy)return;
  const missing=!form.title.trim()||!form.slug.trim()||!form.sourceRef.trim()||!form.unitId||!form.learningArea;
  if(missing){issues=[{code:'missing_fields',message:t.saveNeedsFields}];renderFooter();return;}
  if(form.blocks.some(b=>b.uploadState==='uploading')){issues=[{code:'upload_in_progress',message:t.saveWhileUploading}];renderFooter();return;}
  if(liveWithoutDraft()){issues=[{code:'live_lesson',message:t.liveLessonLocked}];renderFooter();return;}
  busy=true;issues=[];notice=null;renderFooter();renderRevision();
  const minutes=Number.parseInt(form.estimatedMinutes,10);
  const result=await deskRequest('/api/admin/content/drafts',{method:'POST',signal,body:{
   module:'lesson',contentType:'lesson',sourceRef:form.sourceRef.trim(),title:form.title.trim(),
   payload:{unitId:form.unitId,slug:form.slug.trim(),learningArea:form.learningArea,summary:form.summary.trim()?form.summary:null,teacherNotes:form.teacherNotes.trim()?form.teacherNotes:null,estimatedMinutes:Number.isFinite(minutes)?minutes:null,blocks:form.blocks.map(blockPayload)},
   versionId:model?.draft?.versionId??null}});
  if(disposed)return;
  busy=false;
  if(!result.ok){issues=result.issues?.length?result.issues:[{code:'save_failed',message:failureMessageFor(result)}];renderFooter();renderRevision();return;}
  notice=t.savedDraft;dirty=false;
  const savedId=selection==='new'?result.data.targetId:selection;
  if(savedId){selection=savedId;await loadLesson(savedId,{keepNotice:true});}
  await refreshList();
  renderFooter();renderStatus();
 }

 async function movePublication(to){
  const versionId=model?.draft?.versionId??null;
  if(!versionId||busy)return;
  if(to==='published'&&!window.confirm(t.publishConfirm))return;
  busy=true;issues=[];notice=null;renderFooter();
  const publishIso=to==='scheduled'&&publishAt?(()=>{const d=new Date(publishAt);return Number.isNaN(d.getTime())?null:d.toISOString();})():null;
  const result=await deskRequest(`/api/admin/content/versions/${encodeURIComponent(versionId)}/publication`,{method:'POST',signal,body:{to,publishAt:publishIso}});
  if(disposed)return;
  busy=false;
  if(!result.ok){issues=result.issues?.length?result.issues:[{code:'publication_refused',message:failureMessageFor(result)}];renderFooter();return;}
  notice=`${t.publicationMoved}: ${result.data.publicationState}`;
  await loadLesson(selection,{keepNotice:true});
  await refreshList();
 }

 function failureMessageFor(result){
  return failure({status:result.status,code:result.error},dict,{publish_forbidden:t.publicationRefused})||dict.common.error;
 }

 /** Re-read the authoring list after a write, as router.refresh() did in the source. */
 async function refreshList(){
  try{
   const raw=await viewData(routePath+url.search,signal);
   const p=parseProjection(raw);
   lessons=p.lessons;units=p.units;canPublish=p.canPublish;
   if(selection!=='none'&&selection!=='new'&&!lessons.some(l=>l.id===selection)){selection='none';model=null;form=null;}
   renderList();renderMain();
  }catch{
   if(signal.aborted||disposed)return;
   issues=[{code:'load_failed',message:t.loadFailed}];renderMain();
  }
 }

 function parseProjection(raw){
  requireFields(raw,['authorized','canPublish','lessons','units']);
  if(!Array.isArray(raw.lessons)||!Array.isArray(raw.units))throw new Error('invalid lesson authoring projection');
  if(raw.lessons.some(l=>!l||l.learningArea!=null&&l.learningArea!==authorArea))throw new Error('cross-area lesson authoring projection');
  return {authorized:raw.authorized===true,canPublish:raw.canPublish===true,lessons:raw.lessons.map(l=>({id:String(l.id),title:String(l.title),slug:String(l.slug),sourceRef:String(l.sourceRef??''),learningArea:typeof l.learningArea==='string'?l.learningArea:null,publicationState:String(l.publicationState??''),draft:l.draft??null,published:l.published??null})),units:raw.units.map(u=>({id:String(u.id),label:String(u.label),course:String(u.course??'')}))};
 }

 /* ---- page frame and load ---- */
 const host2=host;
 async function load(){
  if(disposed)return;
  host2.replaceChildren(el('p',{role:'status','aria-busy':'true'},dict.common.loading));
  try{
   const raw=await viewData(routePath+url.search,signal);
   if(disposed)return;
   const p=parseProjection(raw);
   if(!p.authorized){void navigate('/app',{replace:true});return;}
   lessons=p.lessons;units=p.units;canPublish=p.canPublish;
   renderPage();
  }catch(e){
   if(signal.aborted||disposed)return;
   host2.replaceChildren(RegionFailureNotice({region:'lesson-authoring',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }
 }
 function renderPage(){
  const children=[
   el('div',{},
    BackLink({fallbackHref:lessonListHref,label:lessonBackLabel,'data-lesson-authoring-back':''}),
    el('h1',{class:'mt-2 font-display text-2xl text-ink-900'},t.title),
    el('p',{class:'mt-1 text-sm text-ink-500'},t.subtitle))];
  if(units.length===0)children.push(el('div',{class:'card p-5','data-lesson-authoring-no-structure':''},el('h2',{class:'font-display text-lg text-ink-900'},t.noUnitsTitle),el('p',{class:'mt-1 text-sm text-ink-500'},t.noUnitsHint)));
  else{children.push(desk);}
  children.push(el('p',{class:'text-xs text-ink-300'},`${t.footer} `,el('a',{class:'underline',href:lessonListHref},lessonListLabel)));
  host2.replaceChildren(el('div',{class:'mx-auto flex max-w-6xl flex-col gap-5','data-route-usable':'lesson-authoring'},...children));
  renderList();
  renderMain();
 }

 signal.addEventListener('abort',()=>{
  disposed=true;clearTimeout(unit.timer);unit.abort?.abort();
  for(const x of xhrs)x.abort();xhrs.clear();
  host2.replaceChildren();
},{once:true});
 void load();
}
