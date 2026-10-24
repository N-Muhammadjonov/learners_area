import {el,listen,mountStaff,BackLink,fill,nextId,put,setChildren} from './kit.js';
import {retentionDeleteText} from './retention-delete-strings.js';
import {bank,staged,setActive,permanentlyDelete,loadText,validateRemote,saveText,Timeout,countWords,LEVELS,LEVEL_CONFIG,isLevel,decodeMeasurementDraft,measurementLines,measurementIssues} from '../../js/adapters/staff-final30/retention.js';
const ROLES=['admin','owner'];
const first=(u,k)=>u.searchParams.get(k)??undefined;
export const queryOf=url=>{const l=first(url,'level'),f=first(url,'filter'),s=first(url,'sort'),p=Number.parseInt(first(url,'page')??'1',10);return {level:isLevel(l)?l:'A2',filter:f==='all'||f==='archived'?f:'active',sort:s==='uses'||s==='newest'?s:'label',page:Number.isFinite(p)&&p>0?p:1};};
const href=(level,filter,sort,page=1)=>`/app/admin/reading/retention?level=${level}&filter=${filter}&sort=${sort}${page>1?`&page=${page}`:''}`;
const lab=(text,node,cls='flex flex-col gap-1')=>el('label',{class:cls},el('span',{},text),node);
/** Accessible row menu: labelled trigger, role=menu items, Arrow/Home/End roving focus, Escape + outside press close, focus returns to trigger. */
function rowMenu({label,items,disabled,signal}){
 const id=nextId('rm');let open=false;const wrap=el('div',{class:'relative inline-block','data-retention-row-menu':''});
 const trigger=el('button',{type:'button',class:'btn-secondary min-h-[40px] min-w-[40px] px-2','aria-label':label,'aria-haspopup':'menu','aria-expanded':'false',disabled,'data-retention-row-menu-trigger':''},el('span',{'aria-hidden':'true'},'⋯'));
 put(wrap,trigger);let menu=null,btns=[];
 const close=ret=>{open=false;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');menu?.remove();menu=null;if(ret)trigger.focus();};
 const onDown=e=>{if(open&&!wrap.contains(e.target))close(false);};document.addEventListener('pointerdown',onDown);signal.addEventListener('abort',()=>document.removeEventListener('pointerdown',onDown),{once:true});
 function show(){open=true;trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',id);
  btns=items.map(it=>{const b=el('button',{type:'button',role:'menuitem',tabindex:'-1',class:'rounded px-3 py-2 text-left text-sm text-ink-700 hover:bg-paper-sunken focus:bg-paper-sunken',...it.marker},it.label);listen(b,'click',()=>{close(true);it.onSelect();},signal);return b;});
  menu=el('div',{id,role:'menu','aria-label':label,class:'absolute right-0 z-10 mt-1 flex min-w-[10rem] flex-col rounded-md border border-ink-100 bg-paper-raised p-1 shadow-card'},btns);
  listen(menu,'keydown',e=>{const i=btns.indexOf(document.activeElement),last=btns.length-1,f=n=>btns[n]?.focus();
   if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='ArrowDown'){e.preventDefault();f(i>=last?0:i+1);}else if(e.key==='ArrowUp'){e.preventDefault();f(i<=0?last:i-1);}else if(e.key==='Home'){e.preventDefault();f(0);}else if(e.key==='End'){e.preventDefault();f(last);}else if(e.key==='Tab')close(false);},signal);
  put(wrap,menu);btns[0]?.focus();}
 listen(trigger,'click',()=>open?close(false):show(),signal);listen(trigger,'keydown',e=>{if(e.key==='ArrowDown'&&!open){e.preventDefault();show();}},signal);
 return wrap;
}
/**
 * The editor is ONE long-lived DOM widget (state in closure) so typing never rebuilds the text areas. The status line,
 * counter and Save button are patched in place. Validation is debounced (400 ms), generation-guarded (a stale answer is
 * ignored), cancelled on unmount; Save is locked synchronously and never retried.
 */
function createEditor(ctx,{level,target,onClose,onSaved,onConflict}){
 const {dict,signal}=ctx,t=dict.retentionMemory.admin,b=t.builder,cfg=LEVEL_CONFIG[level],debounce=ctx.retentionDebounceMs??400;
 const E={body:'',structure:'',load:target.mode==='change'?'loading':'ready',currentVersionId:null,val:{kind:'idle'},saving:false,saveError:null,gen:0,timer:null};
 const node=el('div',{class:'panel flex flex-col gap-3','data-retention-editor':''});
 const ctl=new AbortController();const rq=AbortSignal.any([signal,ctl.signal]); /* requests only: jsdom/DOM listeners must receive the page's own signal */signal.addEventListener('abort',()=>clearTimeout(E.timer),{once:true});
 const ta=el('textarea',{class:'input min-h-[12rem] w-full','data-retention-editor-text':''}),json=el('textarea',{class:'input min-h-[12rem] w-full font-mono text-xs',spellcheck:'false','data-retention-editor-structure':''});
 const live=el('span',{class:'meta-text','aria-live':'polite'}),status=el('div',{class:'meta-text',role:'status','aria-live':'polite'}),issues=el('ul',{class:'meta-text list-disc pl-5','data-retention-editor-issues':''}),err=el('p',{class:'text-sm text-signal-700',role:'alert',hidden:true,'data-retention-editor-save-error':''});
 const builder=el('div',{class:'flex flex-col gap-3','data-retention-measurement-builder':''}),save=el('button',{type:'button',class:'btn-primary','data-retention-editor-save':''},target.mode==='change'?t.saveVersion:t.save),cancel=el('button',{type:'button',class:'btn-secondary','data-retention-editor-cancel':''},t.cancel);
 const words=()=>countWords(E.body);
 function statusText(){const v=E.val,w=words();switch(v.kind){case'checking':return dict.common.loading;case'valid':return `${fill(t.pointsValid,{n:v.points})} ${t.valid}`;case'unavailable':return t.validationUnavailable;case'invalid':return v.error==='retention_word_count_out_of_range'?fill(t.wordCountInvalid,{n:w,level,min:cfg.minWords,max:cfg.maxWords}):fill(t.issueStructure,{n:v.issues.length});default:return t.invalid;}}
 function patch(){
  const w=words(),inRange=w>=cfg.minWords&&w<=cfg.maxWords;live.textContent=fill(t.wordCountLive,{n:w,level,min:cfg.minWords,max:cfg.maxWords});live.dataset.retentionEditorLiveCount=String(w);live.dataset.retentionEditorLiveInRange=String(inRange);live.className=`meta-text ${inRange?'':'text-signal-700'}`;
  status.textContent=statusText();status.dataset.retentionEditorStatus=E.val.kind;status.dataset.retentionEditorWordCount=E.val.kind==='valid'?String(E.val.wordCount):'';
  setChildren(issues,...(E.val.kind==='invalid'?E.val.issues.slice(0,8).map(i=>el('li',{},i)):[]));issues.hidden=!issues.childNodes.length;
  err.hidden=!E.saveError;err.textContent=E.saveError??'';save.disabled=E.saving||E.val.kind!=='valid';save.textContent=E.saving?t.saving:target.mode==='change'?t.saveVersion:t.save;if(E.saving)save.setAttribute('aria-busy','true');else save.removeAttribute('aria-busy');cancel.disabled=false;
 }
 async function check(){
  const gen=++E.gen;if(!E.body.trim()||!E.structure.trim()){E.val={kind:'idle'};patch();return;}
  let structure;try{structure=JSON.parse(E.structure);}catch{E.val={kind:'invalid',error:'retention_invalid_structure',issues:[t.structureJsonInvalid]};patch();return;}
  E.val={kind:'checking'};patch();
  try{const r=await validateRemote({level,bodyText:E.body,structure},rq);if(gen!==E.gen||rq.aborted)return;
   E.val=r.invalidInput?{kind:'invalid',error:'retention_invalid_input',issues:[]}:r.unavailable?{kind:'unavailable'}:r.valid?{kind:'valid',wordCount:r.wordCount,points:100}:{kind:'invalid',error:r.error,issues:r.issues};}
  catch{if(gen===E.gen&&!rq.aborted)E.val={kind:'unavailable'};}
  patch();
 }
 const schedule=()=>{clearTimeout(E.timer);if(E.load!=='ready')return;E.timer=setTimeout(()=>void check(),debounce);};
 const setStructure=(s,fromJson)=>{E.structure=s;if(!fromJson)json.value=s;paintBuilder();patch();schedule();};
 function paintBuilder(){
  const draft=decodeMeasurementDraft(E.structure),valid=draft?measurementIssues(draft).length===0:false,total=draft?.claims.reduce((n,c)=>n+c.points,0);
  const upd=n=>setStructure(JSON.stringify(n,null,2),false),repClaim=(i,c)=>upd({...draft,claims:draft.claims.map((x,j)=>j===i?c:x)}),sum=gs=>gs.reduce((n,g)=>n+g.points,0);
  const repGroup=(ci,gi,g)=>{const c=draft.claims[ci];const groups=c.groups.map((x,k)=>k===gi?g:x);repClaim(ci,{...c,groups,points:sum(groups)});};
  const newId=p=>`${p}_${crypto.randomUUID().replaceAll('-','')}`;
  const focus=document.activeElement?.getAttribute?.('data-focus-key');
  const btn=(text,fn,attrs={})=>{const x=el('button',{type:'button',class:'btn-secondary w-fit',...attrs},text);listen(x,'click',fn,signal);return x;};
  const kids=[el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('h3',{class:'section-title'},b.title),el('span',{class:'technical-text',role:'status','data-retention-measurement-total':''},`${total??'—'} / 100 · ${valid?b.valid:b.incomplete}`)),el('p',{class:'meta-text'},b.hint)];
  if(!draft)kids.push(el('p',{role:'alert',class:'meta-text text-signal-700'},b.rawWarning));
  draft?.claims.forEach((c,ci)=>{
   const scope=el('select',{class:'input'},el('option',{value:'sentence'},b.sentence),el('option',{value:'answer'},b.answer));scope.value=c.scope;listen(scope,'change',()=>repClaim(ci,{...c,scope:scope.value}),signal);
   const groups=c.groups.map((g,gi)=>{
    const kind=el('select',{class:'input'},['concept','entity','number','date'].map(k=>el('option',{value:k},b[k])));kind.value=g.kind;listen(kind,'change',()=>repGroup(ci,gi,{...g,kind:kind.value}),signal);
    const pts=el('input',{type:'number',min:'1',max:'100',step:'1',class:'input','data-focus-key':`m-${ci}-${gi}-p`});pts.value=String(g.points);listen(pts,'input',()=>{const n=Number(pts.value);if(Number.isFinite(n))repGroup(ci,gi,{...g,points:n});},signal);
    const any=el('textarea',{class:'input min-h-20','data-focus-key':`m-${ci}-${gi}-a`});any.value=g.anyOf.join('\n');listen(any,'input',()=>repGroup(ci,gi,{...g,anyOf:measurementLines(any.value)}),signal);
    const crit=el('input',{type:'checkbox'});crit.checked=g.critical;listen(crit,'change',()=>repGroup(ci,gi,{...g,critical:crit.checked}),signal);
    return el('fieldset',{class:'rounded-lg border border-ink-100 p-3 flex flex-col gap-2','data-retention-group':''},el('legend',{class:'meta-text'},`${b.group} ${gi+1}`),el('div',{class:'grid gap-2 sm:grid-cols-2'},lab(b.kind,kind),lab(b.points,pts)),lab(b.alternatives,any),el('label',{class:'flex items-center gap-2'},crit,el('span',{},b.critical)),btn(b.removeGroup,()=>{const gs=c.groups.filter((_,k)=>k!==gi);repClaim(ci,{...c,groups:gs,points:sum(gs)});},{'data-retention-remove-group':''}));});
   const acc=el('textarea',{class:'input','data-focus-key':`m-${ci}-acc`});acc.value=c.acceptedPhrases.join('\n');listen(acc,'input',()=>repClaim(ci,{...c,acceptedPhrases:measurementLines(acc.value)}),signal);
   const rej=el('textarea',{class:'input','data-focus-key':`m-${ci}-rej`});rej.value=c.rejectPhrases.join('\n');listen(rej,'input',()=>repClaim(ci,{...c,rejectPhrases:measurementLines(rej.value)}),signal);
   const label=el('input',{class:'input',maxlength:'300','data-focus-key':`m-${ci}-label`});label.value=c.label;listen(label,'input',()=>repClaim(ci,{...c,label:label.value}),signal);
   kids.push(el('fieldset',{class:'panel flex flex-col gap-3','data-retention-claim':String(ci)},el('legend',{class:'meta-text'},`${b.claim} ${ci+1} · ${c.points}/100`),lab(b.label,label),lab(b.scope,scope),groups,
    btn(b.addGroup,()=>{const gs=[...c.groups,{id:newId('g'),points:1,kind:'concept',anyOf:[],critical:false}];repClaim(ci,{...c,groups:gs,points:sum(gs)});},{disabled:c.groups.length>=20,'data-retention-add-group':''}),
    el('details',{},el('summary',{class:'btn-secondary w-fit'},b.phrases),el('div',{class:'grid gap-3 pt-3 sm:grid-cols-2'},lab(b.accepted,acc),lab(b.rejected,rej))),btn(b.removeClaim,()=>upd({...draft,claims:draft.claims.filter((_,k)=>k!==ci)}),{'data-retention-remove-claim':''})));
  });
  if(draft)kids.push(btn(b.addClaim,()=>upd({...draft,claims:[...draft.claims,{id:newId('c'),label:'',points:1,scope:'sentence',groups:[{id:newId('g'),points:1,kind:'concept',anyOf:[],critical:false}],acceptedPhrases:[],rejectPhrases:[]}]}),{disabled:draft.claims.length>=40,'data-retention-add-claim':''}));
  const det=el('details',{},el('summary',{class:'btn-secondary w-fit'},b.json),el('div',{class:'meta-text block pt-3'},t.structureLabel),json);if(!draft)det.open=true;kids.push(det);
  setChildren(builder,...kids);
  if(focus){const n=builder.querySelector(`[data-focus-key="${focus}"]`);n?.focus();try{if(n&&typeof n.value==='string'&&n.setSelectionRange)n.setSelectionRange(n.value.length,n.value.length);}catch{}}
 }
 listen(ta,'input',()=>{E.body=ta.value;patch();schedule();},signal);listen(json,'input',()=>setStructure(json.value,true),signal);listen(cancel,'click',()=>onClose(),signal);
 listen(save,'click',async()=>{if(E.saving||rq.aborted)return;let structure;try{structure=JSON.parse(E.structure);}catch{E.val={kind:'invalid',error:'retention_invalid_structure',issues:[t.structureJsonInvalid]};patch();return;}
  E.saving=true;E.saveError=null;patch();
  try{const r=await saveText({mode:target.mode,textId:target.textId,level,bodyText:E.body,structure,currentVersionId:E.currentVersionId},rq);if(rq.aborted)return;
   if(r.conflict){onConflict();}else if(r.invalid){E.val={kind:'invalid',error:r.error,issues:r.issues};}else onSaved();}
  catch(e){if(rq.aborted)return;E.saveError=e instanceof Timeout?t.saveUnknown:t.saveFailed;}
  finally{E.saving=false;if(!rq.aborted)patch();}},signal);
 function body(){
  setChildren(node,el('div',{class:'flex items-center justify-between'},el('h3',{class:'card-title'},target.mode==='change'?t.changeTitle:t.addTitle),el('span',{class:'meta-text','data-retention-editor-mode':target.mode},target.mode==='change'?target.label:level)));
  if(E.load==='loading'){put(node,el('p',{class:'body-text',role:'status'},dict.common.loading));return;}
  if(E.load==='failed'){const retry=el('button',{type:'button',class:'btn-secondary','data-retention-editor-load-retry':''},t.retry),c2=el('button',{type:'button',class:'btn-secondary'},t.cancel);listen(retry,'click',()=>void doLoad(),signal);listen(c2,'click',()=>onClose(),signal);
   put(node,el('div',{class:'flex flex-wrap items-center gap-3',role:'alert','data-retention-editor-load-failed':''},el('p',{class:'body-text'},t.loadFailed),retry,c2));return;}
  put(node,el('label',{class:'flex flex-col gap-1'},el('span',{class:'meta-text'},t.textLabel),el('span',{class:'meta-text'},fill(t.textHint,{min:cfg.minWords,max:cfg.maxWords})),ta,live),builder,status,issues,err,el('div',{class:'flex flex-wrap gap-2'},save,cancel));
  ta.value=E.body;json.value=E.structure;paintBuilder();patch();
 }
 async function doLoad(){E.load='loading';body();
  try{const r=await loadText(target.textId,rq);if(rq.aborted)return;E.body=r.bodyText;E.structure=JSON.stringify(r.structure,null,2);E.currentVersionId=r.currentVersionId;E.load='ready';body();schedule();}
  catch{if(rq.aborted)return;E.load='failed';body();}}
 if(target.mode==='change')void doLoad();else body();
 return {node,dispose:()=>{ctl.abort();clearTimeout(E.timer);}};
}
/** Source: admin/reading/retention/page.tsx + RetentionBankPanel.tsx. Role: admin, owner. Archive keeps the source's native confirm. */
export const bankMount=mountStaff({name:'retention-admin',roles:ROLES,load:c=>bank(queryOf(c.url),c.signal),
 render(ctx,d,view){
  const {dict,signal}=ctx,t={...dict.retentionMemory.admin,...retentionDeleteText(dict,ctx.locale)},S=(ctx.state.retentionBank??={editor:null,notice:null,conflict:false,busy:null}),{level,filter,sort}=d;
  if(S.editor&&S.editor.level!==level){S.editor.handle.dispose();S.editor=null;}
  const askConfirm=ctx.confirm??(m=>window.confirm(m));
  const askLabel=ctx.prompt??(m=>window.prompt(m));
  const canPermanentlyDelete=ctx.session?.user?.role==='owner';
  async function toggle(row,active){
   if(S.busy)return;if(!active&&!askConfirm(t.confirmArchive))return;S.busy=row.textId;S.conflict=false;view.rerender();
   try{await setActive(row.textId,active,signal);if(signal.aborted)return;S.notice=t.saved;S.busy=null;await view.reload({quiet:true});}
   catch(e){if(signal.aborted)return;S.notice=e instanceof Timeout?t.saveUnknown:t.archiveFailed;S.busy=null;view.rerender();}
  }
  async function removeForever(row){
   if(!canPermanentlyDelete||S.busy||signal.aborted)return;
   if(!askConfirm(fill(t.confirmPermanentDelete,{label:row.internalLabel})))return;
   if(askLabel(fill(t.confirmDeleteLabel,{label:row.internalLabel}))!==row.internalLabel)return;
   S.busy=row.textId;S.conflict=false;view.rerender();
   try{
    const result=await permanentlyDelete(row.textId,row.internalLabel,signal);
    if(signal.aborted)return;
    S.notice=result.blocked?t.deleteBlocked:t.saved;
    S.busy=null;
    if(result.blocked)view.rerender();else await view.reload({quiet:true});
   }catch(e){if(signal.aborted)return;S.notice=e instanceof Timeout?t.saveUnknown:t.deleteFailed;S.busy=null;view.rerender();}
  }
  function openEditor(target){S.editor?.handle.dispose();const handle=createEditor(ctx,{level,target,onClose:()=>{S.editor?.handle.dispose();S.editor=null;S.conflict=false;view.rerender();},onConflict:()=>{S.conflict=true;view.rerender();},onSaved:()=>{S.editor?.handle.dispose();S.editor=null;S.notice=t.saved;view.reload({quiet:true});}});S.editor={level,handle};view.rerender();}
  const inv=d.inventory.map(r=>el('li',{},el('a',{href:`/app/admin/reading/retention?level=${r.level}`,class:`panel flex flex-col gap-1 hover:border-signal-400 ${r.level===level?'border-signal-400':''}`,'data-retention-inventory-level':r.level},el('span',{class:'card-title'},fill(t.levelHeading,{level:r.level})),el('span',{class:'body-text','data-retention-inventory-count':r.level},`${r.activeCount} / ${r.target}`),
   el('span',{class:'meta-text'},`${r.remainingToTarget===0?t.targetReached:fill(t.toTarget,{n:r.remainingToTarget})} · ${fill(t.lifetimeUses,{n:r.lifetimeUses})}`),el('span',{class:'meta-text'},fill(t.archivedCount,{n:r.archivedCount})))));
  const tab=(key,label,h,attr)=>el('a',{href:h,class:(attr==='filter'?filter:sort)===key?'tab tab-active':'tab',[`data-retention-${attr}`]:key},label);
  const add=el('button',{type:'button',class:'btn-primary w-fit','data-retention-add':''},t.addText);listen(add,'click',()=>openEditor({mode:'add'}),signal);
  const rows=d.bank.rows;
  const table=rows.length===0?el('p',{class:'body-text','data-retention-bank-empty':''},t.emptyBank):el('div',{class:'overflow-x-auto'},el('table',{class:'w-full text-left text-sm','data-retention-bank-table':''},el('thead',{},el('tr',{class:'text-xs uppercase tracking-wide text-ink-300'},[t.tableLabel,t.tableWords,t.tableVersion,t.tableCurrentUses,t.tableLifetimeUses].map(x=>el('th',{scope:'col'},x)),el('th',{scope:'col'},el('span',{class:'sr-only'},t.tableActions)))),
   el('tbody',{},rows.map(r=>el('tr',{class:'border-t border-ink-100 align-top','data-retention-row':r.textId,'data-retention-row-active':String(r.active)},el('td',{class:'py-2 pr-3'},el('div',{class:'flex flex-wrap items-center gap-2'},el('span',{class:'text-ink-900'},r.internalLabel),el('span',{class:`rounded-full px-2 py-0.5 text-xs ${r.active?'bg-paper-sunken text-ink-700':'text-signal-600'}`,'data-retention-row-status':r.active?'active':'archived'},r.active?t.activeBadge:t.archivedBadge)),r.preview?el('p',{class:'meta-text mt-1 line-clamp-2 max-w-[36rem]','data-retention-row-preview':''},r.preview):null),
    el('td',{class:'py-2 text-ink-500'},String(r.wordCount)),el('td',{class:'py-2 text-ink-500'},fill(t.versionBadge,{n:r.versionNumber})),el('td',{class:'py-2 text-ink-500','data-retention-row-current-uses':String(r.currentVersionUses)},String(r.currentVersionUses)),el('td',{class:'py-2 text-ink-500','data-retention-row-lifetime-uses':String(r.lifetimeUses)},String(r.lifetimeUses)),
    el('td',{class:'py-2'},rowMenu({label:fill(t.rowActions,{label:r.internalLabel}),disabled:S.busy===r.textId,signal,items:[{key:'change',label:t.change,marker:{'data-retention-change':r.textId},onSelect:()=>openEditor({mode:'change',textId:r.textId,label:r.internalLabel})},r.active?{key:'archive',label:t.archive,marker:{'data-retention-archive':r.textId},onSelect:()=>void toggle(r,false)}:{key:'restore',label:t.restore,marker:{'data-retention-restore':r.textId},onSelect:()=>void toggle(r,true)},...(canPermanentlyDelete?[{key:'delete',label:t.archive,marker:{'data-retention-delete':r.textId},onSelect:()=>void removeForever(r)}]:[])]})))))));
  const {page,pageCount,total}=d.bank,dis=(x)=>el('span',{class:'btn-secondary pointer-events-none opacity-50','aria-disabled':'true'},x);
  const pager=pageCount>1||total>0?el('nav',{class:'flex flex-wrap items-center gap-3','aria-label':t.pagination,'data-retention-pagination':''},page>1?el('a',{class:'btn-secondary',href:href(level,filter,sort,page-1),'data-retention-page-prev':''},t.previousPage):dis(t.previousPage),el('span',{class:'meta-text','data-retention-page-status':`${page}/${pageCount}`},fill(t.pageStatus,{page,pages:pageCount,total})),page<pageCount?el('a',{class:'btn-secondary',href:href(level,filter,sort,page+1),'data-retention-page-next':''},t.nextPage):dis(t.nextPage)):null;
  const reload=el('button',{type:'button',class:'link-inline','data-retention-conflict-reload':''},t.cancel);listen(reload,'click',()=>{S.conflict=false;void view.reload({quiet:true});},signal);
  return el('div',{class:'flex flex-col gap-4','data-route-usable':'retention-admin'},el('h1',{class:'page-title'},t.title),
   el('div',{class:'mx-auto flex w-full max-w-5xl flex-col gap-6','data-retention-admin':''},el('header',{class:'flex flex-col gap-2'},el('div',{class:'flex flex-wrap items-center justify-between gap-2'},BackLink({fallbackHref:'/app/admin/reading',label:t.backToReading}),el('a',{href:'/app/admin/reading/retention/staged',class:'link-inline','data-retention-staged-review-link':''},'Retention FINAL V2 · QA Review')),el('p',{class:'page-subtitle'},t.subtitle)),
    el('section',{class:'flex flex-col gap-3','data-retention-inventory':''},el('h2',{class:'section-title'},t.inventoryTitle),el('ul',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'},inv)),
    el('section',{class:'flex flex-col gap-4','data-retention-bank':level},el('div',{class:'flex flex-wrap items-center justify-between gap-3'},el('h2',{class:'section-title'},fill(t.levelHeading,{level})),add),
     el('nav',{class:'flex flex-wrap gap-2','aria-label':t.inventoryTitle,'data-retention-bank-filters':''},tab('all',t.filterAll,href(level,'all',sort),'filter'),tab('active',t.filterActive,href(level,'active',sort),'filter'),tab('archived',t.filterArchived,href(level,'archived',sort),'filter'),el('span',{class:'mx-1 h-6 w-px self-center bg-ink-100','aria-hidden':'true'}),tab('label',t.sortLabel,href(level,filter,'label'),'sort'),tab('uses',t.sortUses,href(level,filter,'uses'),'sort'),tab('newest',t.sortNewest,href(level,filter,'newest'),'sort')),
     S.notice&&!S.editor?el('p',{class:'meta-text',role:'status','data-retention-bank-notice':''},S.notice):null,S.editor?S.editor.handle.node:null,
     S.conflict?el('p',{class:'panel border-signal-300 text-sm text-signal-700',role:'alert','data-retention-conflict':''},`${t.conflict} `,reload):null,table,pager),
    el('p',{class:'meta-text','data-retention-levels-available':''},LEVELS.join(' · '))));
 }});
/** Source: admin/reading/retention/staged/page.tsx — read-only QA preview; performs no writes and offers no publish action. */
export const stagedMount=mountStaff({name:'retention-staged-review',roles:ROLES,load:c=>{const l=c.url.searchParams.get('level');return staged(isLevel(l)?l:'A2',c.signal);},
 render(ctx,d){const {dict,locale}=ctx,uz=locale==='uz',level=d.level,r=d.report;
  return el('div',{class:'mx-auto flex max-w-5xl flex-col gap-5','data-route-usable':'retention-staged-review','data-retention-qa-hold':''},el('header',{class:'flex flex-col gap-2'},el('a',{href:'/app/admin/reading/retention',class:'link-inline w-fit'},`← ${uz?'Retention boshqaruviga qaytish':'Back to Retention management'}`),el('h1',{class:'page-title'},uz?'Retention FINAL V2 — Owner tekshiruvi':'Retention FINAL V2 — Owner review'),el('p',{class:'body-text'},uz?"Manbadan o'qilgan 75 ta matnning faqat ko'rish sahifasi. Bu materiallar hali talabalarga ochilmagan.":'Read-only preview of the 75 authored texts. This content is not available to learners yet.')),
   el('section',{class:'panel flex flex-col gap-2 border-warning-300',role:'status','data-retention-staged-warning':''},el('h2',{class:'card-title'},uz?"NASHR TO'XTATILGAN — QA HOLD":'PUBLICATION BLOCKED — QA HOLD'),el('p',{class:'body-text'},uz?"Baholash qoidalaridagi nomuvofiqliklar tekshirilmaguncha ushbu matnlarni nashr qilmang. Bu sahifa hech narsani database'ga yozmaydi.":'Do not publish these texts until scoring discrepancies are reviewed. This page performs no database writes.'),
    el('p',{class:'meta-text','data-retention-staged-counts':''},`${level}: ${r.items.length} ${uz?'ta matn':'texts'} · ${r.heldTextCount} ${uz?'ta QA-hold matn':'held texts'} · ${r.mismatchCount} ${uz?'ta baholash nomuvofiqligi':'scoring mismatches'}`)),
   el('nav',{class:'flex flex-wrap gap-2','aria-label':uz?'Daraja':'Level','data-retention-staged-levels':''},LEVELS.map(l=>el('a',{href:`/app/admin/reading/retention/staged?level=${l}`,'aria-current':level===l?'page':null,class:`btn-secondary ${level===l?'border-signal-400':''}`},l))),
   el('section',{class:'flex flex-col gap-3','aria-label':uz?'Matnlarni tekshirish':'Review texts','data-retention-staged-items':''},r.items.map(i=>el('details',{class:'panel','data-retention-staged-item':i.sourceId},el('summary',{class:'cursor-pointer text-base font-semibold'},`${i.sourceId} · ${i.wordCount} ${uz?"so'z":'words'} · ${i.held?(uz?'Baholash tekshiruvi kerak':'Scoring needs review'):(uz?"Hozirgi testda nomuvofiqlik yo'q":'No current scoring discrepancy')}`),
    el('div',{class:'mt-4 flex flex-col gap-4'},el('p',{class:'body-text whitespace-pre-wrap','data-retention-staged-body':''},i.bodyText),el('p',{class:'meta-text','data-retention-staged-score':''},`${uz?'Asl matn balli':'Source-text score'}: ${i.sourceScore}/100 · ${uz?'Muallif claimlari balli':'Canonical-claim score'}: ${i.canonicalScore}/100`),
     i.missingGroups.length?el('p',{class:'meta-text','data-retention-staged-missing':''},`${uz?'Baholashda topilmagan guruhlar':'Missing scoring groups'}: ${i.missingGroups.map(c=>`${c.claimId} (${c.missingGroupIds.join(', ')})`).join('; ')}`):null)))));}});
