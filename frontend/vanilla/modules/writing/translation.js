import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,uuid,missing,errMessage,fill} from './shared.js';
/** Writing Translation: original setup (random/topic), server-owned sentence checks and completion. */
export function mountTab(ctx,root){const host=el('section',{'data-translation-setup':'',class:'flex flex-col gap-5'});root.append(host);viewRegion(ctx,host,'writing-translation-home',data=>setup(ctx,host,data));}
function setup(ctx,host,data){const t=ctx.dict.writingWorkspace.translation,sets=safeArray(data.sets??data.translationSets??data.rows);const types=[...new Set(sets.map(x=>x.questionType))],bands=[...new Set(sets.map(x=>x.targetBand))].sort((a,b)=>a-b);
 const state={path:'random',type:'',band:'',setId:'',busy:false};const error=el('p',{role:'alert',class:'writing-error'}),controls=el('div',{class:'flex flex-col gap-4'});
 function redraw(){controls.replaceChildren();const paths=el('div',{class:'writing-groups'},['random','topic'].map(path=>button(t.paths?.[path]?.title??t[path]??path,()=>{state.path=path;redraw();},{signal:ctx.signal,cls:state.path===path?'btn-primary':'btn-secondary',attrs:{role:'radio','aria-checked':String(state.path===path),'data-translation-path':path}})));
 controls.append(paths);
 const typeList=el('div',{class:'flex flex-wrap gap-2'},['',...types].map(k=>button(k?(t.types?.[k]??k):t.anyType,()=>{state.type=k;state.setId='';redraw();},{signal:ctx.signal,cls:state.type===k?'btn-primary':'btn-secondary'})));
 const bandList=el('div',{class:'flex flex-wrap gap-2'},['',...bands].map(k=>button(k?`${t.band} ${k}`:t.anyBand,()=>{state.band=k;state.setId='';redraw();},{signal:ctx.signal,cls:state.band===k?'btn-primary':'btn-secondary'})));
 controls.append(typeList,bandList);
 if(state.path==='topic'){const chosen=sets.filter(x=>(!state.type||x.questionType===state.type)&&(!state.band||x.targetBand===state.band));const list=el('div',{class:'writing-groups','data-translation-sets':''},chosen.map(x=>{const input=el('input',{type:'radio',name:'translation-set',value:x.id});input.checked=state.setId===x.id;input.addEventListener('change',()=>{state.setId=x.id;redraw();},{signal:ctx.signal});return el('label',{class:'card p-4 flex gap-3'},input,el('span',{},x.title,' · ',String(x.targetBand)));}));controls.append(list);}
 start.disabled=state.busy||(state.path==='topic'&&!state.setId);
 }
 const start=button(t.start,async()=>{if(state.busy)return;state.busy=true;start.disabled=true;error.textContent='';const body=state.path==='topic'?{setId:state.setId}:{random:{...(state.type?{questionType:state.type}:{}),...(state.band?{targetBand:Number(state.band)}:{})}};try{const result=await post(ctx,'/api/writing/translation',body);const id=result.attemptId??result.id;if(!uuid(id))throw Error('Missing attempt id');void ctx.navigate(`/app/writing/translation/${id}`);}catch(e){error.textContent=errMessage(ctx,e);state.busy=false;redraw();}},{signal:ctx.signal,attrs:{'data-translation-start':''}});
 host.replaceChildren(el('h2',{class:'font-display text-xl'},t.title),controls,error,start);redraw();}
export function mount(ctx){const id=ctx.url.pathname.split('/')[4],host=el('main',{'data-writing-native':'','data-route-usable':'writing-translation',class:'mx-auto max-w-6xl flex flex-col gap-5'});ctx.root.append(host);if(!uuid(id)){host.append(missing(ctx));return;}viewRegion(ctx,host,'writing-translation',data=>{const v=data.view??data.translation??data;if(v.attemptId!==id){host.replaceChildren(missing(ctx));return;}renderView(ctx,host,v);});}
function renderView(ctx,host,initial){const t=ctx.dict.writingWorkspace.translation;let view=initial,answer=view.current?.lastAnswer??'',busy=false,last=null,error='';
 function draw(){const v=view,cur=v.current;host.replaceChildren(navBack(ctx,'/app/writing?tab=translation'),el('h1',{class:'font-display text-2xl'},v.set?.title??t.title));
  const total=Number(v.total??1),done=safeArray(v.finished).length,progress=el('div',{class:'flex items-center gap-3'},el('div',{class:'writing-progress',role:'progressbar','aria-valuemin':0,'aria-valuemax':total,'aria-valuenow':done},el('span',{style:{width:Math.min(100,done/Math.max(1,total)*100)+'%'}})),el('span',{class:'text-sm'},`${done}/${total}`));host.append(progress);
  if(v.status==='completed'){
   const r=v.result??{};
   const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(1):t.notChecked;
   const metrics=el('dl',{class:'writing-groups','data-translation-scores':''},
    [[t.meaning,r.meaning==null?t.notChecked:`${r.meaning}%`],[t.grammar,fmt(r.grammar)],[t.vocabulary,fmt(r.vocabulary)],[t.bandWords,`${safeArray(r.bandWords?.used).length}/${r.bandWords?.total??0}`]]
    .map(([name,num])=>el('div',{class:'writing-criterion'},el('dt',{class:'text-sm'},name),el('dd',{class:'font-display text-xl'},num))));
   const summary=card(el('p',{class:'text-sm'},t.overall),el('strong',{'data-translation-overall':'',class:'font-display text-4xl'},fmt(r.overall)),metrics,
     el('p',{class:'text-sm text-ink-500'},fill(t.checkedOf,{n:r.checked??0,total:v.total}), ' · ',t.estimate),
     safeArray(r.bandWords?.used).length?el('p',{},safeArray(r.bandWords.used).join(', ')):null);
   const fixes=card(el('h3',{class:'font-display text-lg'},t.topFixes),safeArray(r.topFixes).length?
     el('ol',{'data-translation-fixes':'',class:'list-decimal pl-5'},safeArray(r.topFixes).map(f=>el('li',{},'#',f.position,' ',f.text))):el('p',{},t.noFixes));
   host.append(el('h2',{class:'font-display text-xl'},t.resultTitle),summary,fixes,
     el('section',{'data-translation-result':'',class:'flex flex-col gap-3'},...safeArray(v.finished).map(f=>
       card(el('p',{class:'text-sm'},'#',f.position,' · ',f.uzbek??''),
       el('p',{class:'text-sm font-semibold'},f.status==='unavailable'?t.verdict?.unchecked:t.verdict?.[f.verdict]??''),
       el('p',{},t.yours,': ',f.yours??''),
       el('p',{},t.model,': ',f.model??''),
       f.improved&&f.verdict==='needs_revision'?el('p',{},t.improved,': ',f.improved):null,
       f.feedback||safeArray(f.notes).length?el('p',{class:'text-sm'},t.note,': ',[f.feedback,...safeArray(f.notes)].filter(Boolean).join(' · ')):null))),
     link('/app/writing?tab=translation',t.newAttempt,'btn-primary'));return;}
  if(cur){const field=el('textarea',{id:'translation-answer',class:'input w-full text-base',rows:4,maxlength:1200,'data-translation-input':''});field.value=answer;field.addEventListener('input',()=>{answer=field.value;check.disabled=busy||!answer.trim();},{signal:ctx.signal});field.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void submit();}},{signal:ctx.signal});
  const check=button(last==='needs_revision'?t.tryAgain:t.check,()=>void submit(),{signal:ctx.signal,attrs:{'data-translation-check':''}});check.disabled=busy||!answer.trim();
  const alert=error?el('p',{role:'alert',class:'writing-error'},error):last?el('p',{role:'status'},t.verdict?.[last]??last):null;
  host.append(el('div',{class:'writing-two-column'},card(el('p',{class:'text-xs text-signal-600'},fill(t.sentenceOf,{n:cur.position,total}), ' · ',t.uzbek),el('p',{'data-translation-current':'',class:'text-lg'},cur.uzbek)),card(el('label',{for:'translation-answer'},t.yourEnglish),field,cur.lastFeedback?el('p',{class:'writing-help'},cur.lastFeedback):null,alert,check)));}
  for(const f of safeArray(v.finished))host.append(card(el('p',{},f.uzbek??''),el('p',{},f.answer??'')));
 }
 async function submit(){const cur=view.current;if(busy||!answer.trim()||!cur)return;busy=true;error='';
  const buttonNode=host.querySelector('[data-translation-check]');if(buttonNode)buttonNode.disabled=true;
  try{const result=await post(ctx,`/api/writing/translation/${view.attemptId}/answer`,{position:cur.position,answer},'POST',60000);
   if(!result.view)throw Error('Missing view');last=result.verdict??null;
   const moved=result.view.current?.position!==cur.position;view=result.view;if(moved)answer='';
   if(view.status==='completed')void ctx.refresh();
  }catch(e){error=t.checkError;}finally{busy=false;if(!ctx.signal.aborted)draw();}}
 draw();}
