import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,words,uuid,missing,errMessage,fill} from './shared.js';
const modes=['task1','task2','full'];
const clock=n=>{const s=Math.max(0,Math.floor(n)),h=Math.floor(s/3600),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),sec=String(s%60).padStart(2,'0');return h?`${h}:${m}:${sec}`:`${m}:${sec}`;};
/** V49: original WritingExamHome, ExamRunner, exam final result. */
export function mountTab(ctx,root){const host=el('div',{'data-writing-exam-home':'',class:'flex flex-col gap-5'});root.append(host);viewRegion(ctx,host,'writing-exam-home',data=>{
 const t=ctx.dict.writingWorkspace.exam;const d=data.exam??data,avail=d.availability??{},open=d.open??null;
 const main=el('section',{class:'writing-groups'},modes.map(m=>{
  const n=m==='full'?Math.min(avail.task1??0,avail.task2??0):(avail[m]??0);
  const start=button(open?.mode===m?t.resume:t.start,async()=>{if(open?.mode===m){void ctx.navigate(`/app/writing/exam/${open.id}`);return;}start.disabled=true;msg.textContent='';try{const body=await post(ctx,'/api/writing/exam',{mode:m});if(!uuid(body.id))throw Error('Missing id');void ctx.navigate(`/app/writing/exam/${body.id}`);}catch(e){msg.textContent=e.code==='other_paper_open'?t.otherOpen:t.startError;start.disabled=false;}},{signal:ctx.signal,attrs:{'data-exam-start':m}});
  start.disabled=n===0||Boolean(open&&open.mode!==m);const msg=el('p',{role:'alert',class:'writing-error'});
  return card(el('h3',{class:'font-display text-lg'},t.modes?.[m]?.title??m),el('p',{class:'text-base text-ink-500'},t.modes?.[m]?.body??''),el('p',{class:'text-sm text-ink-500'},n>0?`${n} ${t.promptsAvailable}`:t.noPrompts),start,msg);
 }));const resume=open?card(el('p',{},t.resumeTitle),link(`/app/writing/exam/${open.id}`,t.resume,'btn-primary')):null;
 const recent=safeArray(d.recent).map(p=>el('li',{},link(`/app/writing/exam/${p.id}`,`${t.modeLabel?.[p.mode]??p.mode} · ${p.finalizeReason?t.reason?.[p.finalizeReason]:t.inProgress}`,'card flex min-h-11 items-center p-4')));
 host.replaceChildren(el('header',{},el('h2',{class:'font-display text-xl'},t.title),el('p',{class:'text-base text-ink-500'},t.body)),resume,main,recent.length?el('ul',{class:'flex flex-col gap-2','data-exam-recent':''},recent):null);
 });}
export function mount(ctx){const id=ctx.url.pathname.split('/')[4],host=el('main',{'data-writing-native':'','data-route-usable':'writing-exam',class:'mx-auto flex max-w-6xl flex-col gap-4'});ctx.root.append(host);if(!uuid(id)){host.append(missing(ctx));return;}viewRegion(ctx,host,'writing-exam',data=>{const p=data.paper??data.exam??data;if(p.id!==id||!Array.isArray(p.entries)){host.replaceChildren(missing(ctx));return;}if(p.finalizedAt)result(ctx,host,p,data);else runner(ctx,host,p);});}
function runner(ctx,host,paper){const t=ctx.dict.writingWorkspace.exam,signal=ctx.signal;
 const values=new Map(),server=new Map(),positions=paper.entries.map(e=>e.position),backups=pos=>`la:writing-exam:${paper.id}:${pos}`;
 for(const e of paper.entries){let text=e.content??'',rev=e.revision??0;try{const raw=localStorage.getItem(backups(e.position)),b=raw?JSON.parse(raw):null;if(typeof b?.text==='string'&&Number.isInteger(b.revision)&&b.revision>rev){text=b.text;rev=b.revision;}}catch{}values.set(e.position,{text,revision:rev,savedRevision:e.revision??0});}
 let active=positions[0],busy=false,frozen=false,saveTimer=null,retryTimer=null,timeoutRefresh=null,retryIndex=0,queue=Promise.resolve();
 const timeOrigin=performance.now(),timeBase=Math.max(0,Number(paper.remainingSeconds??0)),timer=el('output',{role:'timer','aria-live':'off','data-exam-timer':'',class:''},clock(timeBase)),saveStatus=el('span',{role:'status','data-exam-save':'idle',class:'text-sm text-ink-500'}),message=el('p',{role:'alert',class:'writing-error'});
 const tabs=el('div',{role:'tablist',class:'flex flex-wrap gap-2'}),prompt=el('p',{'data-exam-prompt':'',class:'whitespace-pre-line text-base leading-relaxed'}),textArea=el('textarea',{class:'input writing-editor','data-exam-editor':'',spellcheck:'false'}),wordCount=el('span',{'data-exam-words':'',class:'text-sm text-ink-500'});
 frozen=timeBase<=0;
 const retry=button(t.retryNow,()=>void flush(),{signal,cls:'btn-secondary'});retry.hidden=true;
 async function flush(){clearTimeout(saveTimer);try{await queue;}catch{}const dirty=[...values].filter(([,v])=>v.revision>v.savedRevision);if(!dirty.length)return true;
  saveStatus.dataset.examSave='saving';saveStatus.textContent=t.saving;let all=true;
  const run=(async()=>{for(const [pos,s] of dirty){const revision=s.revision,content=s.text;try{await post(ctx,`/api/writing/exam/${paper.id}/draft`,{position:Number(pos),content,revision},'PUT');const latest=values.get(pos);if(latest)latest.savedRevision=Math.max(latest.savedRevision,revision);}catch(e){all=false;if(e.status===409)frozen=true;}}})();queue=run;await run;
  saveStatus.dataset.examSave=all?'saved':'failed';saveStatus.textContent=all?t.saved:t.saveFailed;retry.hidden=all;
  return all;
 }
 function retryLater(){clearTimeout(retryTimer);const delay=[2000,4000,8000,15000,30000][Math.min(retryIndex++,4)];retryTimer=setTimeout(()=>{void flush().then(ok=>{if(!ok)retryLater();else retryIndex=0;});},delay);}
 function renderActive(){const e=paper.entries.find(e=>e.position===active),v=values.get(active);tabs.replaceChildren(...paper.entries.map(entry=>button(t.modeLabel?.[entry.taskType]??entry.taskType,()=>{active=entry.position;renderActive();},{signal,cls:entry.position===active?'btn-primary':'btn-secondary',attrs:{role:'tab','aria-selected':String(entry.position===active),'data-exam-task-tab':entry.taskType}})));prompt.textContent=e.prompt;textArea.value=v.text;textArea.readOnly=frozen;wordCount.textContent=`${words(v.text)} ${t.words}`;}
 textArea.addEventListener('input',()=>{if(frozen)return;const v=values.get(active);v.text=textArea.value;v.revision++;try{localStorage.setItem(backups(active),JSON.stringify({text:v.text,revision:v.revision}));}catch{}wordCount.textContent=`${words(v.text)} ${t.words}`;saveStatus.dataset.examSave='idle';saveStatus.textContent='';clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void flush().then(ok=>{if(!ok)retryLater();});},1500);},{signal});
 async function finish(reason){if(busy)return;if(!confirm(reason==='submitted'?t.submitConfirm:t.leaveConfirm))return;busy=true;submit.disabled=true;leave.disabled=true;message.textContent='';clearTimeout(saveTimer);try{const saved=await flush();if(!saved&&reason==='submitted'){retryLater();message.textContent=t.saveFailed;return;}await post(ctx,`/api/writing/exam/${paper.id}/finalize`,{reason});for(const pos of positions){try{localStorage.removeItem(backups(pos));}catch{}}if(reason==='abandoned')void ctx.navigate('/app/writing?tab=exam');else void ctx.refresh();}catch(e){message.textContent=errMessage(ctx,e);}finally{busy=false;submit.disabled=false;leave.disabled=false;}}
 const submit=button(t.submit,()=>void finish('submitted'),{signal,attrs:{'data-exam-submit':''}}),leave=button(t.leave,()=>void finish('abandoned'),{signal,cls:'btn-secondary',attrs:{'data-exam-leave':''}});
 const tick=setInterval(()=>{const left=Math.max(0,timeBase-Math.floor((performance.now()-timeOrigin)/1000));timer.textContent=clock(left);if(left===0&&!timeoutRefresh){frozen=true;textArea.readOnly=true;submit.disabled=true;message.textContent=t.timeUp;void flush().then(ok=>{if(!ok)retryLater();});timeoutRefresh=setTimeout(()=>{if(!signal.aborted)void ctx.refresh();},16000);}},250);
 const before=e=>{if([...values.values()].some(v=>v.revision>v.savedRevision))e.preventDefault();};window.addEventListener('beforeunload',before);
 signal.addEventListener('abort',()=>{clearInterval(tick);clearTimeout(saveTimer);clearTimeout(retryTimer);clearTimeout(timeoutRefresh);window.removeEventListener('beforeunload',before);},{once:true});
 host.replaceChildren(navBack(ctx,'/app/writing?tab=exam'),el('div',{class:'flex flex-wrap gap-3 items-center'},timer,wordCount,saveStatus,retry,leave,submit),message,tabs,card(prompt,textArea));renderActive();if(frozen){submit.disabled=true;timeoutRefresh=setTimeout(()=>{if(!signal.aborted)void ctx.refresh();},16000);}}
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
