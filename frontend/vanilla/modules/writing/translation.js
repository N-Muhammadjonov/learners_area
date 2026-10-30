import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,uuid,missing,errMessage,fill} from './shared.js';
/** Writing Translation: original setup (random/topic), server-owned sentence checks and completion. */
export function mountTab(ctx,root){const host=el('section',{'data-translation-setup':'',class:'flex flex-col gap-5'});root.append(host);viewRegion(ctx,host,'writing-translation-home',data=>setup(ctx,host,data));}
function setup(ctx,host,data){
 const t=ctx.dict.writingWorkspace.translation,sets=safeArray(data.sets??data.translationSets??data.rows);
 const types=['opinion','discussion','problem_solution','advantages_disadvantages','two_part'],bands=[6,7,8];
 const selection={path:'random',type:'',band:'',setId:'',busy:false,error:''};
 const chip=(text,active,select,disabled=false,key)=>{const node=button(text,()=>{select();draw();},{signal:ctx.signal,cls:`min-h-11 rounded-full border px-4 text-sm disabled:opacity-40 ${active?'border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30':'border-ink-100 text-ink-700'}`,attrs:{'aria-pressed':String(active),...(key?{'data-chip':key}:{})}});node.disabled=disabled;return node;};
 const fieldset=(legend,choices)=>el('fieldset',{},el('legend',{class:'mb-2 text-sm font-semibold text-ink-900'},legend),el('div',{class:'flex flex-wrap gap-2'},choices));
 async function start(){if(selection.busy)return;selection.busy=true;selection.error='';draw();const body=selection.path==='topic'?{setId:selection.setId}:{random:{...(selection.type?{questionType:selection.type}:{}),...(selection.band?{targetBand:selection.band}:{})}};
  try{const result=await post(ctx,'/api/writing/translation',body);const id=result.attemptId??result.id;if(!uuid(id))throw Error('Missing attempt id');void ctx.navigate(`/app/writing/translation/${id}`);}catch(e){selection.error=e.status===404?t.noMatch:t.startError;}finally{selection.busy=false;if(!ctx.signal.aborted)draw();}}
 function draw(){const S=selection;
  const paths=el('div',{role:'radiogroup','aria-label':t.eyebrow,class:'grid gap-3 sm:grid-cols-2'},['random','topic'].map(path=>button([el('span',{class:'font-display text-lg text-ink-900'},path==='random'?t.pathRandom:t.pathTopic),el('span',{class:'text-sm text-ink-500'},path==='random'?t.pathRandomBody:t.pathTopicBody)],()=>{S.path=path;draw();},{signal:ctx.signal,cls:`card motion-lift flex min-h-11 flex-col items-start gap-1 p-4 text-left ${S.path===path?'border-signal-600 ring-2 ring-signal-600/30':''}`,attrs:{role:'radio','aria-checked':String(S.path===path),'data-translation-path':path}})));
  const typeChoices=[chip(t.anyType,S.type==='',()=>{S.type='';}),...types.map(type=>chip(t.types[type],S.type===type,()=>{S.type=type;},!sets.some(s=>s.questionType===type),type))];
  const bandChoices=[chip(t.anyBand,S.band==='',()=>{S.band='';}),...bands.map(band=>chip(`${t.band} ${band}`,S.band===band,()=>{S.band=band;},!sets.some(s=>s.targetBand===band)))];
  const children=[paths,fieldset(t.questionType,typeChoices),fieldset(t.targetBand,bandChoices)];
  if(S.path==='topic'){const filtered=sets.filter(s=>(!S.type||s.questionType===S.type)&&(!S.band||s.targetBand===S.band));children.push(el('ul',{class:'grid gap-2 sm:grid-cols-2','data-translation-sets':''},filtered.length?filtered.map(s=>{const radio=el('input',{type:'radio',name:'translation-set',value:s.id,class:'mt-1'});radio.checked=S.setId===s.id;radio.addEventListener('change',()=>{S.setId=s.id;draw();},{signal:ctx.signal});return el('li',{},el('label',{'data-translation-selected':String(S.setId===s.id),class:`card flex min-h-11 cursor-pointer items-start gap-3 p-3 ${S.setId===s.id?'border-signal-600':''}`},radio,el('span',{class:'flex flex-col'},el('span',{class:'font-semibold text-ink-900'},s.title),el('span',{class:'text-sm text-ink-500'},`${s.topic} · ${t.types[s.questionType]} · ${t.band} ${s.targetBand} · ${s.sentences??0} ${t.sentences}`))));}):el('li',{class:'text-sm text-ink-500'},t.noMatch)));}
  const go=button(S.busy?t.starting:t.start,()=>void start(),{signal:ctx.signal,cls:'btn-primary min-h-11 self-start',attrs:{'data-translation-start':''}});go.disabled=S.busy||(S.path==='topic'&&!S.setId);
  children.push(el('div',{class:'flex flex-col gap-1'},go,S.error?el('p',{role:'alert',class:'text-sm text-band-bad'},S.error):null));host.replaceChildren(...children);
 }draw();}
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
  if(cur){const field=el('textarea',{id:'translation-answer',class:'input leading-relaxed text-base',rows:4,maxlength:1200,'data-translation-input':''});field.value=answer;field.addEventListener('input',()=>{answer=field.value;check.disabled=busy||!answer.trim();},{signal:ctx.signal});field.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void submit();}},{signal:ctx.signal});
  const check=button(last==='needs_revision'?t.tryAgain:t.check,()=>void submit(),{signal:ctx.signal,cls:'btn-primary min-h-11 self-start',attrs:{'data-translation-check':''}});check.disabled=busy||!answer.trim();
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
