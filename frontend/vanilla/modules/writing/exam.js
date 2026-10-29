import {formatDateTime} from '../../js/generated/time.js';
import {resourceBlocks} from '../live-classes/resources.js';
import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,words,uuid,missing,errMessage,fill} from './shared.js';
import {questionPicker,attachExamImageZoom} from './exam-picker.js';
const modes=['task1','task2','full'];
const clock=n=>{const s=Math.max(0,Math.floor(n)),h=Math.floor(s/3600),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),sec=String(s%60).padStart(2,'0');return h?`${h}:${m}:${sec}`:`${m}:${sec}`;};
/** V49: original WritingExamHome, ExamRunner, exam final result. */
export function mountTab(ctx,root){
 const host=el('section',{'data-writing-exam-home':'',class:'flex flex-col gap-5'});root.append(host);
 viewRegion(ctx,host,'writing-exam-home',data=>{
  const t=ctx.dict.writingWorkspace.exam,d=data.exam??data,avail=d.availability??{},open=d.open??null;
  const source=d.sourceMaterials??{},fullTests=safeArray(source.fullTests);let fullChoice=null;
  const questions=safeArray(d.questions);
  const intro=el('header',{},el('p',{class:'text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400'},t.eyebrow),el('h2',{class:'font-display text-xl text-ink-900'},t.title),el('p',{class:'mt-1 max-w-3xl text-base text-ink-500'},t.body));
  const grid=el('div',{class:'grid gap-4 md:grid-cols-3'});
  for(const mode of modes){
   const tasks=mode==='full'?['task1','task2']:[mode],minutes=mode==='task1'?20:mode==='task2'?40:60,n=Math.min(...tasks.map(task=>avail[task]??0));
   const message=el('p',{role:'alert',class:'writing-error',hidden:true});
   const start=button(open?.mode===mode?t.resume:t.start,async()=>{
    if(open?.mode===mode){void ctx.navigate(`/app/writing/exam/${open.id}`);return;}
    if(mode!=='full'&&questions.some(p=>p.taskType===mode)){
     const saved=[...host.childNodes];
     questionPicker(ctx,host,{mode,questions,types:safeArray(d.questionTypes?.[mode]),onBack:()=>host.replaceChildren(...saved),onStart:async promptId=>{
      try{const result=await post(ctx,'/api/writing/exam',{mode,promptId});if(!uuid(result.id))throw Error('Missing id');void ctx.navigate(`/app/writing/exam/${result.id}`);}
      catch(error){throw Error(error.code==='other_paper_open'?t.otherOpen:t.startError);}
     }});return;
    }
    start.disabled=true;message.hidden=true;
    try{const result=await post(ctx,'/api/writing/exam',mode==='full'&&fullChoice?.value?{mode,fullTest:fullChoice.value}:{mode});if(!uuid(result.id))throw Error('Missing id');void ctx.navigate(`/app/writing/exam/${result.id}`);}
    catch(error){message.textContent=error.code==='other_paper_open'?t.otherOpen:t.startError;message.hidden=false;start.disabled=false;}
   },{signal:ctx.signal,attrs:{'data-exam-start':mode}});
   start.disabled=n===0||Boolean(open&&open.mode!==mode);
   const metric=(label,value)=>el('div',{},el('dt',{class:'text-ink-500'},label),el('dd',{class:'font-semibold text-ink-900'},value));
   grid.append(el('article',{class:'card motion-lift flex flex-col gap-3 p-5','data-exam-mode-card':mode},el('h3',{class:'font-display text-lg text-ink-900'},t.modes[mode].title),el('p',{class:'text-base text-ink-500'},t.modes[mode].body),el('dl',{class:'mt-auto grid grid-cols-2 gap-2 text-sm'},metric(t.timeLeft,`${minutes} ${t.minutes}`),metric(t.minWords,tasks.map(task=>task==='task1'?'150+':'250+').join(' / '))),el('p',{class:'text-sm text-ink-500'},n>0?`${n} ${t.promptsAvailable}`:t.noPrompts),start,message));
  }
  host.replaceChildren(intro);
  if(open){const info=el('div',{},el('p',{class:'font-semibold text-ink-900'},`${t.resumeTitle} · ${t.modeLabel[open.mode]}`),el('p',{class:'text-sm text-ink-500'},t.resumeBody,' ',t.timeLeft,': ',clock(open.remainingSeconds??Math.max(0,Math.floor((Date.parse(open.expiresAt)-Date.now())/1000)))));host.append(el('div',{class:'card flex flex-wrap items-center justify-between gap-3 border-signal-300 p-4',role:'status','data-exam-resume':''},info,link(`/app/writing/exam/${open.id}`,t.resume,'btn-primary min-h-11')));}
  host.append(grid);
  if(fullTests.length){fullChoice=el('select',{class:'input min-w-0 w-full','data-writing-full-test':'','aria-label':ctx.locale==='uz'?'To‘liq test':'Full test'},fullTests.map(x=>el('option',{value:x.code},x.title)));const fullCard=grid.querySelector('[data-exam-mode-card="full"]');fullCard.insertBefore(fullChoice,fullCard.querySelector('[data-exam-start]'));}
  for(const task of ['task1','task2']){const rows=safeArray(source[task]);if(!rows.length)continue;host.append(el('details',{class:'card p-5','data-writing-source-practice':task},el('summary',{class:'cursor-pointer font-semibold'},task==='task1'?'Task 1 · Visual drills':'Task 2 · Argument drills'),el('ul',{class:'mt-3 flex flex-col gap-2'},rows.map(x=>el('li',{},link(`/app/writing/prompts/${x.id}`,x.title,'block min-h-11 rounded-sm border border-signal-300 px-3 py-2'))))));}
  if(safeArray(d.recent).length)host.append(el('div',{},el('h3',{class:'mb-2 text-sm font-semibold text-ink-900'},t.recent),el('ul',{class:'flex flex-col gap-2','data-exam-recent':''},d.recent.map(p=>el('li',{},el('a',{href:`/app/writing/exam/${p.id}`,class:'card flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm'},el('span',{class:'font-semibold text-ink-900'},t.modeLabel[p.mode]),el('span',{class:'text-ink-500'},formatDateTime(p.startedAt,ctx.locale)),el('span',{class:'text-ink-500'},p.finalizeReason?t.reason[p.finalizeReason]:t.inProgress)))))));
 });
}
export function mount(ctx){const id=ctx.url.pathname.split('/')[4],host=el('main',{'data-writing-native':'','data-route-usable':'writing-exam',class:'mx-auto flex max-w-6xl flex-col gap-4'});ctx.root.append(host);if(!uuid(id)){host.append(missing(ctx));return;}viewRegion(ctx,host,'writing-exam',data=>{const p=data.paper??data.exam??data;if(p.id!==id||!Array.isArray(p.entries)){host.replaceChildren(missing(ctx));return;}if(p.finalizedAt)result(ctx,host,p,data);else runner(ctx,host,p,data.materials??{});});}
function runner(ctx,host,paper,materials={}){const t=ctx.dict.writingWorkspace.exam,signal=ctx.signal;
 const values=new Map(),server=new Map(),positions=paper.entries.map(e=>e.position),backups=pos=>`la:writing-exam:${paper.id}:${pos}`;
 for(const e of paper.entries){let text=e.content??'',rev=e.revision??0;try{const raw=localStorage.getItem(backups(e.position)),b=raw?JSON.parse(raw):null;if(typeof b?.text==='string'&&Number.isInteger(b.revision)&&b.revision>rev){text=b.text;rev=b.revision;}}catch{}values.set(e.position,{text,revision:rev,savedRevision:e.revision??0});}
 let active=positions[0],busy=false,frozen=false,saveTimer=null,retryTimer=null,timeoutRefresh=null,retryIndex=0,queue=Promise.resolve();
 const timeOrigin=performance.now(),timeBase=Math.max(0,Number(paper.remainingSeconds??0)),timer=el('output',{role:'timer','aria-live':'off','data-exam-timer':'','aria-label':t.timeLeft,class:'font-display text-2xl tabular-nums text-ink-900'},clock(timeBase)),saveStatus=el('span',{role:'status','data-exam-save':'idle',class:'text-sm text-ink-500'}),message=el('p',{role:'alert',class:'writing-error'});
 const tabs=el('div',{role:'tablist','aria-label':t.modeLabel.full,class:'flex gap-2'}),prompt=el('p',{'data-exam-prompt':'',class:'whitespace-pre-line text-base leading-relaxed text-ink-900'}),textArea=el('textarea',{class:'input min-h-[24rem] flex-1 resize-y text-base leading-relaxed','data-exam-editor':'',spellcheck:'false',autocorrect:'off',autocapitalize:'off',autocomplete:'off',maxlength:'20000','aria-describedby':'exam-words-hint'}),wordCount=el('span',{'data-exam-words':'',class:'text-sm text-ink-500'});
 const answerLabel=el('label',{class:'text-sm font-semibold text-ink-900'},t.yourAnswer),answerCount=el('p',{id:'exam-words-hint',class:'text-sm text-ink-500'}),questionLabel=el('p',{id:'exam-question',class:'text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400'}),minHint=el('p',{class:'text-sm text-ink-500'}),materialHost=el('div',{'data-exam-materials':''});
 const minimum=e=>e.taskType==='task1'?150:250;
 function updateCounts(){const e=paper.entries.find(e=>e.position===active),v=values.get(active),n=words(v.text),min=minimum(e);wordCount.textContent=answerCount.textContent=`${n} ${t.words} · ${fill(t.wordsOf,{n:min})}`;answerCount.className=`text-sm ${n<min?'text-ink-500':'text-band-good'}`;for(const button of tabs.querySelectorAll('button')){const entry=paper.entries.find(e=>String(e.position)===button.dataset.position);button.textContent=`${t.modeLabel[entry.taskType]} · ${words(values.get(entry.position).text)}/${minimum(entry)}`;}}

 frozen=timeBase<=0;
 const retry=button(t.retryNow,()=>void flush(),{signal,cls:'btn-secondary min-h-11'});retry.hidden=true;
 async function flush(){clearTimeout(saveTimer);try{await queue;}catch{}const dirty=[...values].filter(([,v])=>v.revision>v.savedRevision);if(!dirty.length)return true;
  saveStatus.dataset.examSave='saving';saveStatus.textContent=t.saving;let all=true;
  const run=(async()=>{for(const [pos,s] of dirty){const revision=s.revision,content=s.text;try{await post(ctx,`/api/writing/exam/${paper.id}/draft`,{position:Number(pos),content,revision},'PUT');const latest=values.get(pos);if(latest)latest.savedRevision=Math.max(latest.savedRevision,revision);}catch(e){all=false;if(e.status===409)frozen=true;}}})();queue=run;await run;
  saveStatus.dataset.examSave=all?'saved':'failed';saveStatus.textContent=all?t.saved:t.saveFailed;retry.hidden=all;
  return all;
 }
 function retryLater(){clearTimeout(retryTimer);const delay=[2000,4000,8000,15000,30000][Math.min(retryIndex++,4)];retryTimer=setTimeout(()=>{void flush().then(ok=>{if(!ok)retryLater();else retryIndex=0;});},delay);}
 function renderActive(){const e=paper.entries.find(e=>e.position===active),v=values.get(active);tabs.hidden=paper.entries.length<2;tabs.replaceChildren(...paper.entries.map(entry=>button('',()=>{active=entry.position;renderActive();},{signal,cls:`min-h-11 rounded-lg border px-4 text-sm ${entry.position===active?'border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30':'border-ink-100 text-ink-500'}`,attrs:{role:'tab','aria-selected':String(entry.position===active),'data-exam-task-tab':entry.taskType,'data-position':entry.position}})));questionLabel.textContent=`${t.question} · ${t.modeLabel[e.taskType]}`;minHint.textContent=`${t.minWords} ${minimum(e)} ${t.words}`;prompt.textContent=e.prompt;materialHost.replaceChildren();const blocks=resourceBlocks(ctx,materials[e.position]??[]);if(blocks)materialHost.append(blocks);attachExamImageZoom(ctx,materialHost);textArea.id=`exam-answer-${active}`;answerLabel.htmlFor=textArea.id;textArea.value=v.text;textArea.readOnly=frozen;updateCounts();}
 textArea.addEventListener('input',()=>{if(frozen)return;const v=values.get(active);v.text=textArea.value;v.revision++;try{localStorage.setItem(backups(active),JSON.stringify({text:v.text,revision:v.revision}));}catch{}updateCounts();saveStatus.dataset.examSave='idle';saveStatus.textContent='';clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void flush().then(ok=>{if(!ok)retryLater();});},1500);},{signal});
 async function finish(reason){if(busy)return;if(!confirm(reason==='submitted'?t.submitConfirm:t.leaveConfirm))return;busy=true;submit.disabled=true;leave.disabled=true;message.textContent='';clearTimeout(saveTimer);try{const saved=await flush();if(!saved&&reason==='submitted'){retryLater();message.textContent=t.saveFailed;return;}await post(ctx,`/api/writing/exam/${paper.id}/finalize`,{reason});for(const pos of positions){try{localStorage.removeItem(backups(pos));}catch{}}if(reason==='abandoned')void ctx.navigate('/app/writing?tab=exam');else void ctx.refresh();}catch(e){message.textContent=errMessage(ctx,e);}finally{busy=false;submit.disabled=false;leave.disabled=false;}}
 const submit=button(t.submit,()=>void finish('submitted'),{signal,cls:'btn-primary min-h-11',attrs:{'data-exam-submit':''}}),leave=button(t.leave,()=>void finish('abandoned'),{signal,cls:'btn-secondary min-h-11',attrs:{'data-exam-leave':''}});
 const tick=setInterval(()=>{const left=Math.max(0,timeBase-Math.floor((performance.now()-timeOrigin)/1000));timer.textContent=clock(left);timer.className=`font-display text-2xl tabular-nums ${left<=300?'text-band-bad':'text-ink-900'}`;if(left===0&&!timeoutRefresh){frozen=true;textArea.readOnly=true;submit.disabled=true;message.textContent=t.timeUp;void flush().then(ok=>{if(!ok)retryLater();});timeoutRefresh=setTimeout(()=>{if(!signal.aborted)void ctx.refresh();},16000);}},250);
 const before=e=>{if([...values.values()].some(v=>v.revision>v.savedRevision))e.preventDefault();};window.addEventListener('beforeunload',before);
 signal.addEventListener('abort',()=>{clearInterval(tick);clearTimeout(saveTimer);clearTimeout(retryTimer);clearTimeout(timeoutRefresh);window.removeEventListener('beforeunload',before);},{once:true});
 host.replaceChildren(navBack(ctx,'/app/writing?tab=exam'),el('div',{'data-exam-runner':'','data-exam-mode':paper.mode,class:'flex flex-col gap-4'},el('div',{class:'sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper-raised px-4 py-3 shadow-sm'},timer,wordCount,saveStatus,retry,el('div',{class:'ml-auto flex gap-2'},leave,submit)),message,tabs,el('div',{class:'exam-writing-workspace'},el('section',{class:'card exam-question-pane','aria-labelledby':'exam-question'},questionLabel,prompt,minHint,materialHost),el('section',{class:'card exam-answer-pane'},answerLabel,textArea,answerCount))));renderActive();if(frozen){submit.disabled=true;timeoutRefresh=setTimeout(()=>{if(!signal.aborted)void ctx.refresh();},16000);}}
/** Original finalized paper: show existing grades, weighted Full Writing
 * score only when both task estimates are available, and allow grading a
 * previously ungraded eligible entry through the EXISTING /api/writing/grade.
 */
function result(ctx,host,p,data={}){
 const t=ctx.dict.writingWorkspace.exam;
 const gradeMap=data.grades??{},getGrade=e=>e.grade??gradeMap[e.position]??null;
 const task1=p.entries.find(e=>e.taskType==='task1'),task2=p.entries.find(e=>e.taskType==='task2');
 const g1=task1&&getGrade(task1)?.status==='evaluated'?getGrade(task1).overall:null;
 const g2=task2&&getGrade(task2)?.status==='evaluated'?getGrade(task2).overall:null;
 const combined=p.mode==='full'&&typeof g1==='number'&&Number.isFinite(g1)&&typeof g2==='number'&&Number.isFinite(g2)
  ?Math.round(((g1+2*g2)/3)*2)/2:null;
 const entries=p.entries.map(e=>{
  const g=getGrade(e),count=words(e.content),minimum=e.taskType==='task1'?150:250;
  const pieces=[el('h2',{class:'font-display text-lg'},t.modeLabel?.[e.taskType]??e.taskType),
   el('p',{class:'whitespace-pre-line'},e.prompt),
   el('p',{class:`text-sm ${count<minimum?'text-band-bad':'text-band-good'}`},`${count} ${t.words} · ${fill(t.wordsOf,{n:minimum})}${count<minimum?' — '+t.belowMin:''}`),
   el('p',{class:'whitespace-pre-line rounded-md bg-paper-sunken p-3'},e.content??'')];
  if(g?.requestId&&g.status==='evaluated')pieces.push(link(`/app/writing/grade/${g.requestId}`,t.viewGrade+(typeof g.overall==='number'?` · ${g.overall.toFixed(1)}`:''),'btn-secondary'));
  else if(data.aiReady===true&&p.finalizeReason!=='abandoned'&&count>=50){
   const warning=el('p',{role:'alert',class:'writing-error'});
   const grade=button(g?t.viewGrade:t.gradeWithAi,async()=>{
    grade.disabled=true;warning.textContent='';
    try{const r=await post(ctx,'/api/writing/grade',{taskType:e.taskType,question:e.prompt,essay:e.content,idempotencyKey:`exam_${p.id}_${e.position}`,promptId:e.promptId},'POST',60000);
     if(!uuid(r.id))throw Error('Grade result was not persisted');void ctx.navigate(`/app/writing/grade/${r.id}`);
    }catch{warning.textContent=t.gradeFailed;grade.disabled=false;}
   },{signal:ctx.signal,attrs:{'data-exam-grade':''}});
   pieces.push(grade,warning);
  }
  return card(...pieces);
 });
 host.replaceChildren(navBack(ctx,'/app/writing?tab=exam'),
  el('h1',{class:'font-display text-2xl'},t.finishedTitle),
  el('p',{},t.reason?.[p.finalizeReason]??''),
  combined!==null?el('section',{'data-exam-combined':'',class:'card flex items-center gap-4 p-5'},el('strong',{class:'font-display text-4xl'},combined.toFixed(1)),el('span',{},t.combined)):null,
  data.aiReady===false?el('p',{role:'status',class:'writing-help'},t.gradeUnavailable):null,
  el('section',{class:'writing-groups'},entries));
}
