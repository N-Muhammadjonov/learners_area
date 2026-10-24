import {el,listen,mountStaff,BackLink,fill} from './kit.js';
import {materialDelete} from './delete-material.js';
import {deletionType,trackLabel,trackValue} from './content-compat.js';
import {api,validateBank,validateCapabilities,validateVersions,validatePreview,bankQuery,itemPath,PAGE_SIZE,STATES,enc} from '../../js/adapters/staff-final30/content.js';
const IMPORT_PATHS={reading:'/app/admin/reading/import',listening:'/app/admin/listening/import'};
const stamp=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toISOString().slice(0,16).replace('T',' ');};
const pillClass=s=>s==='published'?'badge-done':s==='scheduled'?'badge bg-signal-100 text-signal-700':s==='archived'?'badge-locked':'badge bg-band-warn/10 text-band-warn';
const card=(...c)=>el('div',{class:'card'},c);
const field=(label,node)=>el('label',{class:'block text-xs text-muted'},el('span',{class:'mb-1 block'},label),node);
const EMPTY={module:'',contentType:'',state:'',hasState:'',track:'',sourceRef:'',title:'',q:'',versionNo:'',from:'',to:''};
/**
 * Source: admin/content/workspace/page.tsx + components/admin/ContentWorkspace.tsx. A CLIENT of existing services: it owns no
 * publication rule. Preview parts are rendered as TEXT only; a revision holding executable material is withheld by the server
 * (canonical === null) and the screen says so instead of rendering it. The publish buttons mirror `mayPublishImportedContent`
 * (admin/owner) as a courtesy; the service refuses everyone else.
 */
export const mount=mountStaff({name:'content-workspace',roles:['admin','owner'],load:async()=>({}),
 render(ctx,_d,view){
  const {dict,signal,session}=ctx,t=dict.admin.contentWorkspace,states=dict.admin.publication.states,canPublish=['admin','owner'].includes(session.user.role);
  const W=(ctx.state.workspace??={filters:{...EMPTY},offset:0,bank:null,busy:false,error:'',caps:[],open:null,panel:null,newItem:null,started:false,gen:0});
  const rer=()=>view.rerender();
  async function load(){const gen=++W.gen;W.busy=true;W.error='';rer();
   const res=await api('GET',`/api/admin/content/bank?${bankQuery(W.filters,W.offset)}`,undefined,signal);if(signal.aborted||gen!==W.gen)return;
   try{if(!res.ok)W.error=t.errorUnknown;else W.bank=validateBank(res.data);}catch{W.error=t.errorUnknown;}W.busy=false;rer();}
  if(!W.started){W.started=true;queueMicrotask(()=>{if(!signal.aborted)void load();});void api('GET','/api/admin/content/authoring-capabilities',undefined,signal).then(r=>{if(signal.aborted||!r.ok)return;try{W.caps=validateCapabilities(r.data);rer();}catch{/* capabilities are best-effort in the source */}});}
  const setFilter=p=>{W.offset=0;Object.assign(W.filters,p);void load();};
  const modules=W.caps,types=(modules.find(m=>m.module===W.filters.module)?.contentTypes??modules.flatMap(m=>m.contentTypes.map(c=>({...c,module:m.module}))));
  const sel=(key,attr,opts,withAny=true)=>{const s=el('select',{class:'w-full',[attr]:''},withAny?el('option',{value:''},t.any):null,opts.map(([v,l])=>el('option',{value:v},l)));s.value=W.filters[key];listen(s,'change',()=>setFilter(key==='module'?{module:s.value,contentType:''}:{[key]:s.value}),signal);return s;};
  const inp=(key,attr,extra={})=>{const i=el('input',{class:'w-full',[attr]:'','data-focus-key':'f-'+key,...extra});i.value=W.filters[key];listen(i,'input',()=>setFilter({[key]:key==='versionNo'?i.value.replace(/\D/g,''):i.value}),signal);return i;};
   const trackFilter=()=>{
    const module=W.filters.module,academic=dict.listening.academic.title;
    const node=el('input',{class:'w-full','data-bank-track':'','data-focus-key':'f-track',placeholder:module==='listening'?academic:'academic'});
    node.value=trackLabel(module,W.filters.track,academic);
    listen(node,'input',()=>setFilter({track:trackValue(module,node.value,academic)}),signal);
    return node;
   };
  const search=el('button',{type:'button',class:'btn-primary','data-bank-search':'',disabled:W.busy},W.busy?t.searching:t.search);listen(search,'click',()=>void load(),signal);
  const clear=el('button',{type:'button',class:'btn-secondary','data-bank-clear':''},t.clear);listen(clear,'click',()=>{W.filters={...EMPTY};W.offset=0;void load();},signal);
  const rows=W.bank?.rows??[],total=W.bank?.total??0;
  const table=el('table',{class:'w-full text-sm','data-bank-table':''},el('thead',{},el('tr',{class:'text-left text-xs uppercase text-muted'},[t.columnItem,t.columnVersions,t.columnState,t.columnUpdated].map(x=>el('th',{class:'py-2'},x)),el('th',{class:'py-2'}))),
   el('tbody',{},rows.map(r=>{const open=el('button',{type:'button',class:'btn-secondary','data-bank-row-open':''},t.open);listen(open,'click',()=>{W.open=r;W.panel={versions:null,preview:null,busy:false,error:'',publishAt:'',revising:null,note:'',saving:false,validity:null};void panelLoad();},signal);
    return el('tr',{class:'border-t border-border','data-bank-row':r.key},el('td',{class:'py-2'},el('div',{class:'font-medium'},r.title),el('div',{class:'font-mono text-xs text-muted','data-bank-row-identity':''},`${r.module}:${r.contentType}:${r.sourceRef}`)),
     el('td',{class:'py-2'},el('span',{'data-bank-row-versions':''},String(r.versions)),el('span',{class:'text-muted'},` · v${r.latestVersionNo}`),el('div',{class:'text-xs text-muted'},STATES.filter(s=>(r.states[s]??0)>0).map(s=>`${states[s]} ${r.states[s]}`).join(' · '))),
     el('td',{class:'py-2'},el('span',{class:pillClass(r.latestState),'data-state':r.latestState},states[r.latestState]??r.latestState)),el('td',{class:'py-2 text-xs text-muted'},stamp(r.updatedAt)),el('td',{class:'py-2 text-right'},open));}),
    rows.length===0&&!W.busy?el('tr',{},el('td',{colspan:'5',class:'py-4 text-sm text-muted','data-bank-empty':''},t.empty)):null));
  const prev=el('button',{type:'button',class:'btn-secondary','data-bank-previous':'',disabled:W.offset===0||W.busy},t.previous),next=el('button',{type:'button',class:'btn-secondary','data-bank-next':'',disabled:W.offset+PAGE_SIZE>=total||W.busy},t.next);
  listen(prev,'click',()=>{W.offset=Math.max(W.offset-PAGE_SIZE,0);void load();},signal);listen(next,'click',()=>{W.offset+=PAGE_SIZE;void load();},signal);
  /* ---- item panel ---- */
  const P=()=>W.panel;
  async function panelLoad(){const p=P(),item=W.open;p.busy=true;rer();const r=await api('GET',itemPath(item),undefined,signal);if(signal.aborted||P()!==p)return;try{if(r.ok)p.versions=validateVersions(r.data);else p.error=t.errorUnknown;}catch{p.error=t.errorUnknown;}p.busy=false;rer();}
  async function showPreview(id){const p=P();p.busy=true;p.error='';rer();const r=await api('GET',`/api/admin/content/versions/${enc(id)}/preview`,undefined,signal);if(signal.aborted||P()!==p)return;try{if(r.ok)p.preview=validatePreview(r.data);else p.error=t.errorUnknown;}catch{p.error=t.errorUnknown;}p.busy=false;rer();}
  async function move(id,to){const p=P();p.busy=true;p.error='';rer();let at;if(to==='scheduled'&&p.publishAt){const d=new Date(p.publishAt);if(Number.isFinite(d.getTime()))at=d.toISOString();}
   const r=await api('POST',`/api/admin/content/versions/${enc(id)}/publication`,{to,...(at?{publishAt:at}:{})},signal);if(signal.aborted||P()!==p)return;
   if(!r.ok){p.error=r.status===403?t.forbidden:t.errorUnknown;p.busy=false;rer();return;}p.preview=null;p.busy=false;await panelLoad();void load();}
  async function startRevise(v){const p=P();p.busy=true;p.error='';rer();const r=await api('GET',`/api/admin/content/versions/${enc(v.id)}/preview`,undefined,signal);if(signal.aborted||P()!==p)return;p.busy=false;let pv;try{pv=r.ok?validatePreview(r.data):null;}catch{pv=null;}
   if(!pv){p.error=t.errorUnknown;rer();return;}if(pv.canonical===null){p.error=t.executable;rer();return;}p.revising={versionId:v.id,payload:JSON.stringify(pv.canonical,null,2),sourceRef:W.open.sourceRef,title:W.open.title};p.validity=null;rer();}
  async function validateRevision(){const p=P();let parsed;try{parsed=JSON.parse(p.revising.payload);}catch{p.error=t.invalid;p.validity='invalid';rer();return;}p.busy=true;p.error='';rer();const r=await api('POST','/api/admin/content/validate',{package:parsed},signal);if(signal.aborted||P()!==p)return;p.busy=false;p.validity=r.ok&&r.data?.ok===true?'valid':'invalid';rer();}
  async function saveRevision(){const p=P();if(p.saving)return;let payload;try{payload=JSON.parse(p.revising.payload);}catch{p.error=t.invalid;rer();return;}p.saving=true;p.error='';rer();
   const r=await api('POST','/api/admin/content/drafts',{module:W.open.module,contentType:W.open.contentType,sourceRef:p.revising.sourceRef,title:p.revising.title,payload,note:p.note||null,versionId:p.revising.versionId},signal);if(signal.aborted||P()!==p)return;p.saving=false;
   if(!r.ok){p.error=t.errorUnknown;rer();return;}p.revising=null;p.note='';await panelLoad();void load();}
  function itemPanel(){const item=W.open,p=P();if(!item||!p)return null;
   const close=el('button',{type:'button',class:'btn-secondary','data-item-close':''},t.close);listen(close,'click',()=>{W.open=null;W.panel=null;rer();},signal);
   const vb=(label,attr,cls,fn,disabled=false)=>{const b=el('button',{type:'button',class:cls,[attr]:'',disabled},label);listen(b,'click',fn,signal);return b;};
   const versions=(p.versions??[]).map(v=>el('tr',{class:'border-t border-border','data-item-version':String(v.versionNo)},el('td',{class:'py-2'},`v${v.versionNo}`),el('td',{class:'py-2'},el('span',{class:pillClass(v.publicationState),'data-state':v.publicationState},states[v.publicationState]??v.publicationState)),el('td',{class:'py-2 font-mono text-xs text-muted'},v.targetType??'—'),
    el('td',{class:'py-2 text-right'},el('span',{class:'inline-flex flex-wrap justify-end gap-1'},vb(t.preview,'data-version-preview','btn-secondary',()=>void showPreview(v.id)),vb(t.revise,'data-version-revise','btn-secondary',()=>void startRevise(v)),
     v.publicationState!=='published'?vb(t.publish,'data-version-publish','btn-primary',()=>void move(v.id,'published'),!canPublish||p.busy):null,v.publicationState!=='scheduled'?vb(t.schedule,'data-version-schedule','btn-secondary',()=>void move(v.id,'scheduled'),!canPublish||p.busy):null,v.publicationState!=='archived'?vb(t.archive,'data-version-archive','btn-secondary',()=>void move(v.id,'archived'),!canPublish||p.busy):null,
     v.targetId&&deletionType(v.targetType)?materialDelete(ctx,{type:deletionType(v.targetType),id:v.targetId,backTo:'/app/admin/content'}):null))));
   const when=canPublish?(()=>{const i=el('input',{class:'w-64',type:'datetime-local','data-item-publish-at':''});i.value=p.publishAt;listen(i,'input',()=>{p.publishAt=i.value;},signal);return el('label',{class:'mt-3 block text-xs text-muted'},el('span',{class:'mb-1 block'},t.publishAtHint),i);})():null;
   let revise=null;if(p.revising){const ta=el('textarea',{class:'mt-2 h-56 w-full font-mono text-xs','data-revise-payload':'','data-focus-key':'rv-payload'});ta.value=p.revising.payload;listen(ta,'input',()=>{p.revising.payload=ta.value;},signal);
    const note=el('input',{class:'w-64',placeholder:dict.admin.publication.changeState,'data-focus-key':'rv-note'});note.value=p.note;listen(note,'input',()=>{p.note=note.value;},signal);
    const cancel=el('button',{type:'button',class:'btn-secondary'},t.closeForm);listen(cancel,'click',()=>{p.revising=null;rer();},signal);
    revise=el('div',{class:'mt-4 rounded border border-border p-3','data-revise-panel':''},el('h3',{class:'text-xs font-semibold uppercase text-muted'},t.revise),el('p',{class:'mt-1 font-mono text-xs text-muted'},`${item.module}:${item.contentType}:${p.revising.sourceRef}`),ta,
     el('div',{class:'mt-2 flex flex-wrap items-center gap-2'},vb(p.busy?t.validating:t.validate,'data-revise-validate','btn-secondary',()=>void validateRevision(),p.busy),vb(p.saving?t.saving:t.saveDraft,'data-revise-save','btn-primary',()=>void saveRevision(),p.saving),cancel,p.validity?el('span',{class:p.validity==='valid'?'text-xs text-green-700':'text-xs text-red-600','data-revise-validity':''},p.validity==='valid'?t.valid:t.invalid):null,note));}
   let prevNode=null;if(p.preview){const pv=p.preview;prevNode=el('div',{class:'mt-4 rounded border border-border p-3','data-preview-panel':''},el('div',{class:'flex flex-wrap items-baseline justify-between gap-2'},el('h3',{class:'text-xs font-semibold uppercase text-muted'},fill(t.previewTitle,{identity:pv.identity.versionIdentity})),el('span',{class:pv.status==='PREVIEW_READY'?'badge-done':pv.status==='PARTIAL'?'badge bg-band-warn/10 text-band-warn':'badge-locked','data-preview-status':pv.status},pv.status==='PREVIEW_READY'?t.previewStatus:pv.status==='PARTIAL'?t.previewPartial:t.previewMissing)),
    pv.answerKeyVisible?el('p',{class:'mt-2 text-xs text-amber-700','data-preview-answer-key':''},t.previewAnswerKey):null,pv.problems.length?el('p',{class:'mt-2 text-xs text-red-600','data-preview-problems':''},`${t.previewProblems}: ${pv.problems.join(', ')}`):null,
    el('h4',{class:'mt-3 text-xs font-semibold uppercase text-muted'},t.previewParts),el('ul',{class:'mt-1 space-y-2 text-sm','data-preview-parts':''},pv.parts.map(x=>el('li',{class:'rounded border border-border p-2'},el('div',{class:'flex items-center justify-between gap-2'},el('span',{class:'font-medium'},x.label??x.key),x.status?el('span',{class:'text-xs text-muted'},x.status):null),x.note?el('p',{class:'text-xs text-muted'},x.note):null,
     x.items?.length?el('dl',{class:'mt-1 grid grid-cols-1 gap-1 text-xs md:grid-cols-2'},x.items.map(e=>el('div',{},el('dt',{class:'text-muted'},e.label),el('dd',{class:'whitespace-pre-wrap font-mono'},e.value)))):null))),pv.canonical===null?el('p',{class:'mt-2 text-xs text-amber-700','data-preview-redacted':''},t.executable):null);}
   return card(el('div',{class:'flex flex-wrap items-baseline justify-between gap-3'},el('div',{},el('h2',{class:'text-sm font-semibold','data-item-title':''},item.title),el('p',{class:'font-mono text-xs text-muted','data-item-identity':''},`${item.module}:${item.contentType}:${item.sourceRef}`)),close),
    p.error?el('p',{class:'mt-2 text-sm text-red-600','data-item-error':''},p.error):null,el('h3',{class:'mt-4 text-xs font-semibold uppercase text-muted'},t.versionsTitle),el('div',{class:'overflow-x-auto'},el('table',{class:'mt-2 w-full text-sm','data-item-versions':''},el('tbody',{},versions,p.versions!==null&&p.versions.length===0?el('tr',{},el('td',{class:'py-3 text-sm text-muted'},t.noVersions)):null))),when,revise,prevNode);}
  /* ---- new item ---- */
  function newItem(){
   const N=(W.newItem??={open:false,module:'',contentType:'',sourceRef:'',title:'',track:'unspecified',payload:'',busy:false,error:'',note:''});
   const toggle=el('button',{type:'button',class:'btn-secondary','data-new-item':''},t.newItem);listen(toggle,'click',()=>{N.open=!N.open;rer();},signal);
   if(!N.open)return toggle;
   const tps=modules.find(m=>m.module===N.module)?.contentTypes??[],cap=tps.find(c=>c.contentType===N.contentType)??null,importPath=cap?.importable===true?(IMPORT_PATHS[N.module]??null):null;
   const bind=(n,k,evt='input')=>{n.value=N[k];listen(n,evt,()=>{N[k]=n.value;if(k==='module'){N.contentType='';}if(['module','contentType'].includes(k))rer();else rer0();},signal);return n;};
   const rer0=()=>{/* typing must not rebuild the form: refresh only the dependent buttons */const ns=panelNode.querySelector('[data-new-save]'),nv=panelNode.querySelector('[data-new-validate]');if(ns)ns.disabled=N.busy||!N.payload||!N.sourceRef||!N.title||cap?.authorable===false;if(nv)nv.disabled=N.busy||!N.payload;};
   async function tpl(kind){if(!N.module||!N.contentType)return;N.busy=true;N.error='';rer();const r=await api('GET',`/api/admin/content/template?module=${enc(N.module)}&contentType=${enc(N.contentType)}&kind=${kind}`,undefined,signal);if(signal.aborted)return;N.busy=false;if(!r.ok||!r.data||typeof r.data!=='object'){N.error=t.errorUnknown;rer();return;}N.payload=JSON.stringify(r.data,null,2);if(typeof r.data.sourceRef==='string')N.sourceRef=r.data.sourceRef;if(typeof r.data.title==='string')N.title=r.data.title;rer();}
   async function validate(){let parsed;try{parsed=JSON.parse(N.payload);}catch{N.error=t.invalid;rer();return;}N.busy=true;N.error='';rer();const r=await api('POST','/api/admin/content/validate',{package:parsed},signal);if(signal.aborted)return;N.busy=false;N.error=r.ok&&r.data?.ok?'':t.invalid;rer();}
   async function save(){let parsed;try{parsed=JSON.parse(N.payload);}catch{N.error=t.invalid;rer();return;}N.busy=true;N.error='';rer();const r=await api('POST','/api/admin/content/drafts',{module:N.module,contentType:N.contentType,sourceRef:N.sourceRef,title:N.title,track:N.track,payload:parsed,note:N.note||null},signal);if(signal.aborted)return;N.busy=false;if(!r.ok){N.error=t.errorUnknown;rer();return;}N.open=false;N.payload='';rer();void load();}
   const b=(label,attr,cls,fn,disabled)=>{const x=el('button',{type:'button',class:cls,[attr]:'',disabled},label);listen(x,'click',fn,signal);return x;};
   const mod=el('select',{class:'w-full','data-new-module':''},el('option',{value:''},'—'),modules.map(m=>el('option',{value:m.module,disabled:m.contentTypes.length===0},m.label)));bind(mod,'module','change');
   const ty=el('select',{class:'w-full','data-new-type':''},el('option',{value:''},'—'),tps.map(c=>el('option',{value:c.contentType},c.label??c.contentType)));bind(ty,'contentType','change');
   const track=el('select',{class:'w-full','data-new-track':''},['unspecified','academic','general_training'].map(x=>el('option',{value:x},trackLabel(N.module,x,dict.listening.academic.title))));bind(track,'track','change');
   const payload=bind(el('textarea',{class:'mt-2 h-56 w-full font-mono text-xs','data-new-payload':'','data-focus-key':'nw-payload'}),'payload');
   const panelNode=el('div',{class:'mt-3 w-full rounded border border-border p-3','data-new-item-panel':''},el('p',{class:'text-xs text-muted'},t.newHint),
    el('div',{class:'mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4'},field(t.newModule,mod),field(t.newType,ty),field(t.newSourceRef,bind(el('input',{class:'w-full font-mono text-xs','data-new-source-ref':'','data-focus-key':'nw-ref'}),'sourceRef')),field(t.newTitle,bind(el('input',{class:'w-full','data-new-title':'','data-focus-key':'nw-title'}),'title')),field(t.newTrack,track),
     el('div',{class:'flex items-end gap-2 md:col-span-3'},b(t.template,'data-new-template','btn-secondary',()=>void tpl('template'),!N.contentType||N.busy),b(t.loadExample,'data-new-example','btn-secondary',()=>void tpl('example'),!N.contentType||N.busy),importPath?el('a',{class:'btn-secondary',href:importPath,'data-new-import':''},t.importInstead):null)),
    cap&&cap.authorable===false?el('p',{class:'mt-2 text-xs text-muted','data-new-not-authorable':''},t.importHint):null,payload,
    el('div',{class:'mt-2 flex flex-wrap items-center gap-2'},b(N.busy?t.validating:t.validate,'data-new-validate','btn-primary',()=>void validate(),N.busy||!N.payload),b(N.busy?t.saving:t.saveDraft,'data-new-save','btn-primary',()=>void save(),N.busy||!N.payload||!N.sourceRef||!N.title||cap?.authorable===false),bind(el('input',{class:'w-64',placeholder:dict.admin.publication.changeState,'data-focus-key':'nw-note'}),'note'),b(t.closeForm,'data-new-close','btn-secondary',()=>{N.open=false;rer();})),N.error?el('p',{class:'mt-2 text-sm text-red-600','data-new-error':''},N.error):null);
   return el('div',{class:'w-full'},toggle,panelNode);
  }
  return el('div',{class:'space-y-6','data-content-workspace':''},BackLink({fallbackHref:'/app/admin/content',label:dict.common.back}),
   card(el('div',{class:'flex flex-wrap items-baseline justify-between gap-3'},el('div',{},el('h1',{class:'text-lg font-semibold'},t.title),el('p',{class:'mt-1 max-w-3xl text-sm text-muted'},t.hint)),newItem())),
   card(el('h2',{class:'text-sm font-semibold'},t.bankTitle),el('div',{class:'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4'},
    field(t.filterModule,sel('module','data-bank-module',modules.map(m=>[m.module,m.label]))),field(t.filterType,sel('contentType','data-bank-type',types.map(c=>[c.contentType,typeof c.label==='string'?c.label:c.contentType]))),field(t.filterState,sel('state','data-bank-state',STATES.map(s=>[s,states[s]]))),field(t.filterHasState,sel('hasState','data-bank-has-state',STATES.map(s=>[s,states[s]]))),
    field(t.filterIdentity,inp('sourceRef','data-bank-identity',{placeholder:'reading:general_set:harbour-2024'})),field(t.filterTitle,inp('title','data-bank-title')),field(t.filterQuery,inp('q','data-bank-query')),field(t.filterVersion,inp('versionNo','data-bank-version',{inputmode:'numeric'})),field(t.filterTrack,trackFilter()),
    field(t.filterFrom,inp('from','data-bank-from',{type:'date'})),field(t.filterTo,inp('to','data-bank-to',{type:'date'})),el('div',{class:'flex items-end gap-2'},search,clear)),
    W.error?el('p',{class:'mt-3 text-sm text-red-600','data-bank-error':''},W.error):null,el('div',{class:'mt-4 overflow-x-auto'},table),
    el('div',{class:'mt-3 flex items-center justify-between text-sm'},el('span',{'data-bank-total':''},fill(t.results,{n:total})),el('div',{class:'flex items-center gap-2'},prev,el('span',{'data-bank-page':''},`${t.page} ${Math.floor(W.offset/PAGE_SIZE)+1}`),next))),
   itemPanel());
 }});
