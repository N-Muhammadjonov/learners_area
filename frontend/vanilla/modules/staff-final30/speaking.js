import {el,listen,mountStaff,errorText,nextId,put,setChildren} from './kit.js';
import {preflight,startUpload,describeUploadError,acceptAttribute,maxBytesLabel,formatBytes} from '../../js/adapters/staff-final30/uploads.js';
import {manage,createMaterial,patchMaterial,deleteMaterial,blocksPayload,primaryPayload,resolveEmbedSource,CATEGORIES,saveTopic,blankSupport,sharedSpeakingChannels,usesSharedSpeakingBank} from '../../js/adapters/staff-final30/speaking.js';
import {cleanStudyHtml,cleanStudyNodes} from '../../js/adapters/staff-final30/study-html.js';
const STAFF=['teacher','admin','owner'],BUSY=['queued','uploading','finalizing'];
const lid=()=>`b_${Math.random().toString(36).slice(2,10)}`;
const isMedia=b=>['image','audio','file'].includes(b.type);
/**
 * Block draft store (useBlockDrafts.ts). Failed uploads are never dropped and finished ones are never discarded by a later
 * failure: every block carries its own state; only `complete` media + non-empty text/link are serializable. Text/link edits are
 * SILENT (no repaint) so typing never steals focus; structural changes call `changed()`.
 */
export function createDraftStore({materialId,signal,changed,onError,start=startUpload}){
 const S={blocks:[]},handles=new Map();let alive=true;
 const fire=()=>{if(alive&&!signal.aborted)changed();};
 const cleanup=()=>{alive=false;for(const h of handles.values())h.cancel();handles.clear();for(const b of S.blocks)if(b.previewUrl&&URL.revokeObjectURL)URL.revokeObjectURL(b.previewUrl);};
 signal.addEventListener('abort',cleanup,{once:true});
 const patch=(id,p)=>{if(!alive)return;S.blocks=S.blocks.map(b=>b.localId===id&&isMedia(b)?{...b,...p}:b);fire();};
 const preview=(file,kind)=>kind==='image'&&typeof URL.createObjectURL==='function'?URL.createObjectURL(file):undefined;
 function launch(id,file,kind){
  const h=start(file,{purpose:'material_block',blockKind:kind,materialId,onState:s=>patch(id,{state:s}),onProgress:p=>patch(id,{progress:p})});handles.set(id,h);
  void h.promise.then(o=>{if(!alive||handles.get(id)!==h)return;handles.delete(id);
   if(o.ok){S.blocks=S.blocks.map(b=>{if(b.localId!==id||!isMedia(b))return b;if(b.previewUrl&&URL.revokeObjectURL)URL.revokeObjectURL(b.previewUrl);return {...b,state:'complete',progress:100,uploadId:o.uploadId,objectKey:o.objectKey,previewUrl:undefined,error:undefined};});fire();}
   else patch(id,{state:o.error==='cancelled'?'cancelled':'failed',error:o.error});});
 }
 const api={get blocks(){return S.blocks;},get anyUploading(){return S.blocks.some(b=>isMedia(b)&&BUSY.includes(b.state));},
  uploadMedia(file,kind){const pre=preflight(file,kind);if(!pre.ok){onError?.(pre.error);return;}const id=lid();S.blocks=[...S.blocks,{localId:id,type:kind,state:'queued',progress:0,originalName:file.name,mimeType:file.type||'application/octet-stream',size:file.size,previewUrl:preview(file,kind),file}];fire();launch(id,file,kind);},
  replaceMedia(id,file){const d=S.blocks.find(b=>b.localId===id);if(!d||!isMedia(d))return;const pre=preflight(file,d.type);if(!pre.ok){onError?.(pre.error);return;}handles.get(id)?.cancel();handles.delete(id);if(d.previewUrl&&URL.revokeObjectURL)URL.revokeObjectURL(d.previewUrl);patch(id,{state:'queued',progress:0,uploadId:undefined,objectKey:undefined,originalName:file.name,mimeType:file.type||'application/octet-stream',size:file.size,previewUrl:preview(file,d.type),error:undefined,file});launch(id,file,d.type);},
  retry(id){const d=S.blocks.find(b=>b.localId===id);if(!d||!isMedia(d)||!d.file)return;handles.get(id)?.cancel();handles.delete(id);patch(id,{state:'queued',progress:0,error:undefined});launch(id,d.file,d.type);},
  cancel(id){handles.get(id)?.cancel();handles.delete(id);patch(id,{state:'cancelled'});},
  addText(t){S.blocks=[...S.blocks,{localId:lid(),type:'text',textContent:t}];fire();},addLink(u){S.blocks=[...S.blocks,{localId:lid(),type:'link',linkUrl:u}];fire();},
  setText(id,v){const b=S.blocks.find(x=>x.localId===id&&x.type==='text');if(b)b.textContent=v;},setLink(id,v){const b=S.blocks.find(x=>x.localId===id&&x.type==='link');if(b)b.linkUrl=v;},
  remove(id){const t=S.blocks.find(b=>b.localId===id);if(t&&isMedia(t)&&t.previewUrl&&URL.revokeObjectURL)URL.revokeObjectURL(t.previewUrl);S.blocks=S.blocks.filter(b=>b.localId!==id);handles.get(id)?.cancel();handles.delete(id);fire();},
  move(id,dir){const i=S.blocks.findIndex(b=>b.localId===id),j=i+dir;if(i<0||j<0||j>=S.blocks.length)return;const n=[...S.blocks];const [m]=n.splice(i,1);n.splice(j,0,m);S.blocks=n;fire();},
  reorderTo(from,to){if(from===to)return;const a=S.blocks.findIndex(b=>b.localId===from),b2=S.blocks.findIndex(b=>b.localId===to);if(a<0||b2<0)return;const n=[...S.blocks];const [m]=n.splice(a,1);n.splice(b2,0,m);S.blocks=n;fire();},
  setInitial(d){S.blocks=d;fire();}};
 return api;
}
export const draftsFromBlocks=blocks=>blocks.slice().sort((a,b)=>a.position-b.position).map(b=>b.type==='text'?{localId:lid(),type:'text',textContent:b.textContent??''}:b.type==='link'?{localId:lid(),type:'link',linkUrl:b.linkUrl??''}:{localId:lid(),type:b.type,state:'complete',progress:100,objectKey:b.objectKey??undefined,originalName:b.originalName??'file',mimeType:b.mimeType??'application/octet-stream',size:b.size??undefined});
const btn=(text,cls,fn,signal,attrs={})=>{const b=el('button',{type:'button',class:cls,...attrs},text);listen(b,'click',fn,signal);return b;};
/** BlockComposer.tsx — reorder by drag AND ▲▼ buttons; real per-file state; "kept as-is" label for stored blocks. */
export function blockComposer(ctx,store){
 const {dict,signal}=ctx,t=dict.speaking,S={menu:false,adding:null,draftText:'',draftLink:'',editingText:null,editingLink:null,dragging:null,drop:false,pickKind:'file',replace:null};
 const node=el('div',{class:'flex flex-col gap-2','data-block-composer':''}),list=el('div',{class:'flex flex-col gap-2'}),tools=el('div',{class:'flex flex-col gap-2'});
 const file=el('input',{type:'file',class:'hidden','data-block-file':''});
 listen(file,'change',()=>{for(const f of [...(file.files??[])]){if(S.replace)store.replaceMedia(S.replace,f);else store.uploadMedia(f,S.pickKind);}S.replace=null;file.value='';},signal);
 const pick=(kind,forId)=>{S.pickKind=kind;S.replace=forId??null;file.accept=acceptAttribute(kind);file.value='';file.click();};
 const row=(b,i,total)=>{
  const kind={text:t.blockText,link:t.blockLink,image:t.blockImage,audio:t.blockAudio,file:t.blockFile}[b.type];
  const r=el('div',{draggable:'true',class:`flex items-start gap-2 rounded-sm border bg-paper-sunken p-2 ${S.dragging===b.localId?'border-signal-400 opacity-60':'border-ink-100'}`,'data-block-row':b.type,'data-block-id':b.localId});
  listen(r,'dragstart',()=>{S.dragging=b.localId;},signal);listen(r,'dragend',()=>{S.dragging=null;},signal);listen(r,'dragover',e=>e.preventDefault(),signal);listen(r,'drop',e=>{e.preventDefault();if(S.dragging)store.reorderTo(S.dragging,b.localId);S.dragging=null;},signal);
  const body=el('div',{class:'min-w-0 flex-1'},el('p',{class:'mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-200'},kind));
  if(b.type==='text'){if(S.editingText===b.localId){const ta=el('textarea',{class:'input min-h-[72px]','aria-label':t.editText,'data-block-text-edit':''});ta.value=b.textContent;listen(ta,'input',()=>store.setText(b.localId,ta.value),signal);put(body,ta,btn(t.doneEditingText,'btn-secondary',()=>{S.editingText=null;paint();},signal));setTimeout(()=>ta.focus(),0);}else put(body,btn(b.textContent,'w-full rounded-sm px-1 py-0.5 text-left text-sm whitespace-pre-line text-ink-700 hover:bg-paper',()=>{S.editingText=b.localId;paint();},signal,{'data-block-text':''}));}
  if(b.type==='link'){if(S.editingLink===b.localId){const i=el('input',{type:'url',class:'input','aria-label':t.addLink,'data-block-link-edit':''});i.value=b.linkUrl;listen(i,'input',()=>store.setLink(b.localId,i.value),signal);put(body,i,btn(t.doneEditingText,'btn-secondary',()=>{S.editingLink=null;paint();},signal));setTimeout(()=>i.focus(),0);}else put(body,btn(`🔗 ${b.linkUrl}`,'w-full truncate rounded-sm px-1 py-0.5 text-left text-sm text-signal-600 hover:bg-paper',()=>{S.editingLink=b.localId;paint();},signal,{'data-block-link':''}));}
  if(isMedia(b)){
   const inflight=BUSY.includes(b.state),readUrl=b.objectKey?`/api/resources/${b.objectKey}`:b.previewUrl;
   put(body,el('div',{class:'flex items-center gap-2'},b.type==='image'&&readUrl?el('img',{src:readUrl,alt:'',class:'h-10 w-10 shrink-0 rounded-sm border border-ink-100 object-cover'}):null,el('span',{class:'min-w-0 flex-1 truncate text-sm text-ink-900','data-block-name':''},b.originalName),el('span',{class:'shrink-0 text-xs text-ink-300'},formatBytes(b.size))));
   if(b.type==='audio'&&b.state==='complete'&&b.objectKey)put(body,el('audio',{controls:'',preload:'none',class:'w-full',src:`/api/resources/${b.objectKey}`}));
   if(inflight)put(body,el('div',{class:'flex items-center gap-2','data-block-progress':String(b.progress)},el('div',{class:'h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100',role:'progressbar','aria-valuenow':String(b.progress),'aria-valuemin':'0','aria-valuemax':'100','aria-label':t.uploadState[b.state]},el('div',{class:'h-full bg-signal-500',style:{width:`${b.progress}%`}})),el('span',{class:'w-24 shrink-0 text-xs text-ink-300'},b.state==='finalizing'?t.uploadState.finalizing:t.progressLabel.replace('{percent}',String(b.progress))),btn(t.cancelUpload,'shrink-0 text-xs text-ink-400 hover:text-band-bad',()=>store.cancel(b.localId),signal,{'data-block-cancel':''})));
   if(b.state==='complete')put(body,el('div',{class:'flex items-center gap-2','data-block-state':'complete'},el('span',{'aria-hidden':'true',class:'text-xs text-band-good'},'✓'),el('span',{class:'text-xs text-band-good'},t.uploadState.complete),b.objectKey?el('span',{class:'text-xs text-ink-300','data-block-kept':b.uploadId?'no':'yes'},b.uploadId?'':t.keepAttachment):null,btn(t.replaceAttachment,'btn-secondary ml-auto',()=>pick(b.type,b.localId),signal,{'data-block-replace':''})));
   if(b.state==='failed'||b.state==='cancelled')put(body,el('div',{class:'flex flex-wrap items-center gap-2','data-block-state':b.state},el('span',{class:'text-xs text-band-bad'},`${t.uploadState[b.state]}${b.error?` — ${describeUploadError(b.error,dict.uploadErrors)}`:''}`),btn(t.retryUpload,'btn-secondary',()=>store.retry(b.localId),signal,{'data-block-retry':''})));
  }
  put(r,el('span',{'aria-hidden':'true',title:t.dragToReorder,class:'mt-1 cursor-grab select-none text-xs leading-none text-ink-200'},'⠿'),el('div',{class:'flex flex-col'},btn('▲','px-1 text-xs leading-tight text-ink-300 hover:text-ink-700 disabled:opacity-30',()=>store.move(b.localId,-1),signal,{disabled:i===0,'aria-label':`${t.moveBlockUp} — ${kind}`,'data-block-up':''}),btn('▼','px-1 text-xs leading-tight text-ink-300 hover:text-ink-700 disabled:opacity-30',()=>store.move(b.localId,1),signal,{disabled:i===total-1,'aria-label':`${t.moveBlockDown} — ${kind}`,'data-block-down':''})),body,btn('✕','btn-secondary mt-1 shrink-0 text-band-bad',()=>store.remove(b.localId),signal,{'aria-label':`${t.removeBlock} — ${kind}`,'data-block-remove':''}));
  return r;};
 const menuId=nextId('bm');
 function paint(){
  const bs=store.blocks;setChildren(list,...(bs.length===0?[el('p',{class:'px-1 py-2 text-xs text-ink-300','data-block-empty':''},t.noBlocks)]:bs.map((b,i)=>row(b,i,bs.length))));
  const plus=btn('+','flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-paper-raised text-lg font-semibold text-ink-600',()=>{S.menu=!S.menu;paint();},signal,{'aria-expanded':String(S.menu),'aria-controls':menuId,'aria-label':t.attachmentMenuLabel,title:t.attachmentMenuLabel,'data-block-plus':''});
  const mi=(label,fn,k)=>btn(label,'rounded-sm px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-sunken hover:text-signal-600',fn,signal,{role:'menuitem','data-block-add':k});
  const menu=S.menu?el('div',{id:menuId,role:'menu','aria-label':t.attachmentMenuLabel,class:'flex flex-wrap items-center gap-1 rounded-md border border-ink-100 bg-paper-raised p-1 shadow-sm'},[['file',t.addFile],['image',t.addImage],['audio',t.addAudio]].map(([k,l])=>mi(l,()=>{S.menu=false;paint();pick(k);},k)),mi(t.addText,()=>{S.adding='text';S.menu=false;paint();},'text'),mi(t.addLink,()=>{S.adding='link';S.menu=false;paint();},'link')):null;
  const adder=S.adding==='text'?(()=>{const ta=el('textarea',{class:'input min-h-[72px]','aria-label':t.addText,'data-block-draft-text':''});ta.value=S.draftText;listen(ta,'input',()=>{S.draftText=ta.value;},signal);setTimeout(()=>ta.focus(),0);return el('div',{class:'flex flex-col gap-2'},ta,el('div',{class:'flex gap-2'},btn(t.addBlock,'btn-secondary',()=>{if(!S.draftText.trim())return;const v=S.draftText.trim();S.draftText='';S.adding=null;store.addText(v);},signal,{'data-block-draft-commit':''}),btn(dict.common.cancel,'btn-ghost',()=>{S.adding=null;paint();},signal)));})()
   :S.adding==='link'?(()=>{const i=el('input',{type:'url',class:'input','aria-label':t.addLink,placeholder:'https://…','data-block-draft-link':''});i.value=S.draftLink;const commit=()=>{if(!S.draftLink.trim())return;const v=S.draftLink.trim();S.draftLink='';S.adding=null;store.addLink(v);};listen(i,'input',()=>{S.draftLink=i.value;},signal);listen(i,'keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}},signal);setTimeout(()=>i.focus(),0);return el('div',{class:'flex flex-col gap-2'},i,el('div',{class:'flex gap-2'},btn(t.addBlock,'btn-secondary',commit,signal,{'data-block-draft-commit':''}),btn(dict.common.cancel,'btn-ghost',()=>{S.adding=null;paint();},signal)));})():null;
  setChildren(tools,el('div',{class:'relative flex items-center gap-2 pt-1'},plus,menu,el('span',{class:'text-xs text-ink-300'},t.dropHint.replace('{max}',maxBytesLabel('file')))),adder);
  node.classList.toggle('bg-signal-50',S.drop);
 }
 listen(node,'dragover',e=>{if(!e.dataTransfer?.types?.includes?.('Files'))return;e.preventDefault();if(!S.drop){S.drop=true;paint();}},signal);listen(node,'dragleave',()=>{S.drop=false;paint();},signal);
 listen(node,'drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();S.drop=false;for(const f of [...e.dataTransfer.files])store.uploadMedia(f,f.type.startsWith('image/')?'image':f.type.startsWith('audio/')?'audio':'file');paint();},signal);
 put(node,list,tools,file);paint();return {node,repaint:paint};
}
/** PrimaryFileField.tsx — one primary file or link; real progress; stored object is "complete, retained, no uploadId". */
export function primaryField(ctx,{value,onChange,materialId,onError,start=startUpload}){
 const {dict,signal}=ctx,t=dict.speaking,S={value,tab:value.mode==='link'?'link':'upload',gen:0,handle:null};
 const node=el('div',{class:'flex flex-col gap-2','data-primary-field':''});const file=el('input',{type:'file',accept:acceptAttribute('primary'),class:'hidden','data-primary-file':''});
 signal.addEventListener('abort',()=>{S.handle?.cancel();S.handle=null;},{once:true});
 const emit=(v,gen)=>{if(signal.aborted||(gen!==undefined&&gen!==S.gen))return;S.value=v;onChange(v);paint();};
 const cancelCurrent=()=>{S.gen++;S.handle?.cancel();S.handle=null;};
 function begin(f){
  S.handle?.cancel();const gen=++S.gen,base={mode:'upload',originalName:f.name,mimeType:f.type||'application/octet-stream',size:f.size,file:f},pre=preflight(f,'primary');
  if(!pre.ok){onError?.(describeUploadError(pre.error,dict.uploadErrors));return;}
  emit({...base,state:'queued',progress:0},gen);
  const h=start(f,{purpose:'material_primary',materialId,onState:s=>emit({...base,state:s,progress:0},gen),onProgress:p=>emit({...base,state:'uploading',progress:p},gen)});S.handle=h;
  void h.promise.then(o=>{if(signal.aborted||gen!==S.gen)return;S.handle=null;o.ok?emit({...base,state:'complete',progress:100,uploadId:o.uploadId,objectKey:o.objectKey},gen):emit({...base,state:o.error==='cancelled'?'cancelled':'failed',progress:0,error:o.error},gen);});
 }
 listen(file,'change',()=>{const f=file.files?.[0];if(f)begin(f);file.value='';},signal);
 function paint(){
  const v=S.value,up=v.mode==='upload'&&BUSY.includes(v.state);
  const tabs=el('div',{class:'mb-1 flex w-fit overflow-hidden rounded-sm border border-ink-100 text-xs font-medium'},['upload','link'].map(m=>btn(m==='upload'?t.uploadTab:t.linkTab,`px-3 py-1.5 ${S.tab===m?'bg-signal-600 text-white':'bg-paper-raised text-ink-500'}`,()=>{cancelCurrent();S.tab=m;emit(m==='upload'?{mode:'empty'}:{mode:'link',primaryUrl:''});},signal,{'aria-pressed':String(S.tab===m),'data-primary-tab':m})));
  let body;
  if(S.tab==='upload'){body=[];
   if(v.mode==='empty'){const z=el('div',{class:'flex flex-col items-start gap-1 rounded-sm border border-dashed border-ink-200 px-3 py-4','data-primary-drop':''},btn(t.chooseFile,'btn-secondary',()=>file.click(),signal,{'data-primary-choose':''}),el('p',{class:'text-xs text-ink-300'},t.dropHint.replace('{max}',maxBytesLabel('primary'))));listen(z,'dragover',e=>e.preventDefault(),signal);listen(z,'drop',e=>{e.preventDefault();const f=e.dataTransfer?.files?.[0];if(f)begin(f);},signal);body.push(z);}
   if(v.mode==='upload')body.push(el('div',{class:'flex flex-col gap-2 rounded-sm border border-ink-100 bg-paper-sunken p-3','data-primary-state':v.state},el('div',{class:'flex items-center gap-2 text-sm'},el('span',{class:'min-w-0 flex-1 truncate text-ink-900'},v.originalName),el('span',{class:'shrink-0 text-xs text-ink-300'},formatBytes(v.size))),
    up?el('div',{class:'flex items-center gap-2'},el('div',{class:'h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100',role:'progressbar','aria-valuenow':String(v.progress),'aria-valuemin':'0','aria-valuemax':'100','aria-label':t.uploadState[v.state]},el('div',{class:'h-full bg-signal-500',style:{width:`${v.progress}%`}})),el('span',{class:'w-28 shrink-0 text-xs text-ink-300'},v.state==='finalizing'?t.uploadState.finalizing:t.progressLabel.replace('{percent}',String(v.progress))),btn(t.cancelUpload,'shrink-0 text-xs text-ink-400 hover:text-band-bad',()=>{cancelCurrent();emit({mode:'empty'});},signal,{'data-primary-cancel':''})):null,
    v.state==='complete'?el('div',{class:'flex items-center gap-2'},el('span',{class:'text-xs text-band-good'},`✓ ${t.uploadState.complete}`),v.retained?el('span',{class:'text-xs text-ink-300','data-primary-retained':''},t.keepAttachment):null,btn(t.replaceFile,'btn-secondary ml-auto',()=>file.click(),signal,{'data-primary-replace':''}),btn(t.removeFile,'btn-secondary text-band-bad',()=>{cancelCurrent();emit({mode:'empty'});},signal,{'data-primary-remove':''})):null,
    v.state==='failed'||v.state==='cancelled'?el('div',{class:'flex flex-wrap items-center gap-2'},el('span',{class:'text-xs text-band-bad'},`${t.uploadState[v.state]}${v.error?` — ${describeUploadError(v.error,dict.uploadErrors)}`:''}`),v.file?btn(t.retryUpload,'btn-secondary',()=>begin(v.file),signal,{'data-primary-retry':''}):null):null));
  }else{const i=el('input',{id:'primary-link',type:'url',class:'input',placeholder:'https://…','data-primary-link':''});i.value=v.mode==='link'?v.primaryUrl:'';listen(i,'input',()=>{S.value={mode:'link',primaryUrl:i.value};onChange(S.value);},signal);body=[el('label',{for:'primary-link',class:'text-sm font-medium text-ink-700'},t.linkTab),i,el('p',{class:'text-xs text-ink-300'},t.primaryUrlHelp)];}
  setChildren(node,tabs,...body,file);
 }
 paint();return {node,get value(){return S.value;}};
}
/** BlockRenderer + MaterialPlayer — embeds only the allow-listed YouTube host; everything else is an honest "open" link. */
/** components/speaking/MaterialPlayer.tsx — labels are props (the listening desk passes its own English strings). */
export function materialPlayer(url,type,openLabel,emptyLabel){
 if(!url)return el('p',{class:'rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500','data-material-empty':''},emptyLabel);
 const s=resolveEmbedSource(url,type);if(s.kind==='iframe')return el('div',{class:'aspect-video w-full overflow-hidden rounded-md bg-ink-950'},el('iframe',{src:s.embedUrl,class:'h-full w-full',allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',allowfullscreen:'','data-embed':'youtube'}));
 if(s.kind==='video')return el('video',{controls:'',class:'w-full rounded-md bg-ink-950',src:s.src});if(s.kind==='audio')return el('audio',{controls:'',class:'w-full',src:s.src});
 return el('a',{href:s.url,target:'_blank',rel:'noreferrer noopener',class:'btn-secondary'},`${openLabel} ↗`);
}
export function blockView(dict,b){
 const t=dict.speaking,player=(url,type)=>materialPlayer(url,type,t.openMaterial,t.noFileYet);
 switch(b.type){case'text':return el('p',{class:'whitespace-pre-line text-sm text-ink-700'},b.textContent??'');case'image':return el('img',{src:b.objectUrl??'',alt:b.originalName??'',class:'max-h-96 w-full rounded-md object-contain'});case'audio':return player(b.objectUrl,'audio');case'link':return player(b.linkUrl,'link');
  case'file':return el('a',{href:b.objectUrl??'#',target:'_blank',rel:'noreferrer noopener',class:'flex items-center gap-2 rounded-sm border border-ink-100 bg-paper-sunken px-3 py-2 text-sm hover:border-signal-400'},el('span',{'aria-hidden':'true'},'📄'),el('span',{class:'flex-1 truncate text-ink-900'},b.originalName??'File'),el('span',{class:'text-xs text-ink-300'},b.size?(b.size<1048576?`${Math.round(b.size/1024)} KB`:`${(b.size/1048576).toFixed(1)} MB`):''));default:return null;}
}
const lab=(id,text)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},text);
function formShell(ctx,{materialId,mode,initial,view,onDone}){
 const {dict,signal}=ctx,t=dict.speaking,F={title:initial.title,category:initial.category,primary:initial.primary,pending:false,error:'',saved:false};
 const node=el('form',{class:mode==='create'?'card flex flex-col gap-3 p-4':'flex flex-col gap-3 rounded-sm border border-signal-200 bg-paper-raised p-3','data-material-form':mode});
 let store,composer,field,submit;
 const sync=()=>{const primaryBusy=F.primary.mode==='upload'&&BUSY.includes(F.primary.state);const ok=mode==='create'?!!F.title.trim()&&!F.pending&&!primaryBusy&&!store.anyUploading&&(F.primary.mode==='link'?F.primary.primaryUrl.startsWith('http'):F.primary.mode==='upload'&&F.primary.state==='complete'):!F.pending&&!!F.title.trim()&&!primaryBusy&&!store.anyUploading;submit.disabled=!ok;submit.textContent=F.pending?dict.common.saving:dict.common.save;errP.textContent=F.error?describeUploadError(F.error,dict.uploadErrors):'';errP.hidden=!F.error;savedP.hidden=!F.saved;};
 const errP=el('p',{class:'text-sm text-band-bad',role:'alert',hidden:true,'data-material-form-error':''}),savedP=el('p',{class:'text-sm text-band-good',hidden:true},t.savedAndRefreshed);
 store=createDraftStore({materialId,signal,start:ctx.startUpload,changed:()=>{composer?.repaint();if(submit)sync();},onError:m=>{F.error=m;if(submit)sync();}});
 if(mode==='edit')store.setInitial(draftsFromBlocks(initial.blocks));
 composer=blockComposer(ctx,store);field=primaryField(ctx,{value:F.primary,materialId,start:ctx.startUpload,onError:m=>{F.error=m;sync();},onChange:v=>{F.primary=v;sync();}});
 const title=el('input',{id:`mat-title-${materialId??'new'}`,class:'input',required:'','data-material-title':''});title.value=F.title;listen(title,'input',()=>{F.title=title.value;sync();},signal);
 const cat=mode==='create'?el('select',{id:'new-material-category',class:'input','data-material-category':''},CATEGORIES.map(c=>el('option',{value:c},t.category[c]))):null;if(cat){cat.value=F.category;listen(cat,'change',()=>{F.category=cat.value;},signal);}
 submit=el('button',{type:'submit',class:'btn-primary','data-material-submit':''},dict.common.save);const cancel=btn(dict.common.cancel,'btn-ghost',()=>onDone(false),signal,{'data-material-cancel':''});
 put(node,...(mode==='edit'?[el('div',{class:'flex items-center justify-between'},el('h3',{class:'text-sm font-semibold text-ink-900'},t.editMaterial),el('span',{class:'text-xs text-ink-300'},t.reorderKeyboardHint))]:[]),
  mode==='create'?el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2'},el('div',{},lab('new-material-category',t.section),cat),el('div',{},lab(`mat-title-new`,t.titleField),title,el('p',{class:'mt-1 text-xs text-ink-300'},t.titleRequired))):el('div',{},lab(`mat-title-${materialId}`,t.titleField),title),
  el('fieldset',{class:'flex flex-col gap-2'},el('legend',{class:'mb-1 text-sm font-medium text-ink-700'},t.primaryFile),field.node),el('fieldset',{class:'flex flex-col gap-2 border-t border-ink-100 pt-3'},el('legend',{class:'mb-1 text-sm font-medium text-ink-700'},t.description),composer.node),errP,savedP,el('div',{class:'flex flex-wrap gap-2'},submit,cancel));
 listen(node,'submit',async e=>{e.preventDefault();if(submit.disabled||F.pending||signal.aborted)return;F.pending=true;F.error='';F.saved=false;sync();
  try{const blocks=blocksPayload(store.blocks,{requireComplete:mode==='edit'});
   if(mode==='create'){await createMaterial({category:F.category,title:F.title,primary:primaryPayload(F.primary,{create:true}),blocks},signal);}
   else{const body={title:F.title.trim(),blocks},p=primaryPayload(F.primary,{create:false});if(p)body.primary=p;await patchMaterial(materialId,body,signal);}
   if(signal.aborted)return;F.pending=false;onDone(true);}
  catch(x){if(signal.aborted)return;F.pending=false;F.error=errorText(x,dict);sync();}});
 sync();return node;
}
function card(ctx,row,view){
 const {dict,signal}=ctx,t=dict.speaking,m=row.material,S=((ctx.state.speakingCard??={})[m.id]??={editTitle:false,editContent:false,title:m.title,expanded:false,pending:false,error:null});
 const patch=async body=>{S.pending=true;S.error=null;view.rerender();try{await patchMaterial(m.id,body,signal);if(signal.aborted)return;S.pending=false;await view.reload({quiet:true});}catch(e){if(signal.aborted)return;S.pending=false;S.error=errorText(e,dict);view.rerender();throw e;}};
 const del=async()=>{const n=row.blocks.length+(m.primaryObjectKey?1:0);if(!(ctx.confirm??(x=>window.confirm(x)))(t.confirmDelete.replace('{title}',m.title).replace('{count}',String(n))))return;S.pending=true;S.error=null;view.rerender();try{await deleteMaterial(m.id,signal);if(signal.aborted)return;S.pending=false;await view.reload({quiet:true});}catch(e){if(signal.aborted)return;S.pending=false;S.error=errorText(e,dict);view.rerender();}};
 const primary=()=>m.primaryType==='link'||!m.primaryObjectKey?{mode:'link',primaryUrl:m.primaryUrl??''}:{mode:'upload',state:'complete',progress:100,objectKey:m.primaryObjectKey,originalName:m.primaryOriginalName??m.title,mimeType:m.primaryMimeType??'application/octet-stream',size:m.primarySize??0,retained:true};
 const head=S.editTitle?(()=>{const i=el('input',{class:'input text-sm','aria-label':t.titleField,'data-card-title-input':''});i.value=S.title;listen(i,'input',()=>{S.title=i.value;},signal);return el('div',{class:'flex flex-1 items-center gap-2'},i,btn(t.save,'btn-primary',async()=>{try{await patch({title:S.title});S.editTitle=false;view.rerender();}catch{/* error shown */}},signal,{disabled:S.pending,'data-card-title-save':''}),btn(dict.common.cancel,'btn-ghost',()=>{S.editTitle=false;S.title=m.title;view.rerender();},signal));})():el('p',{class:'text-sm font-medium text-ink-900'},m.title);
 return el('div',{class:`card flex flex-col gap-2 ${m.isActive?'':'opacity-50'}`,'data-material':m.id,'data-material-active':String(m.isActive)},S.error?el('p',{role:'alert',class:'rounded-md border border-band-bad/40 bg-band-bad/10 p-2 text-sm text-band-bad','data-material-error':''},S.error):null,
  el('div',{class:'flex flex-wrap items-center justify-between gap-2'},head,el('span',{class:'shrink-0 text-xs text-ink-300','data-material-meta':''},`${t.category[m.category]??m.category} · ${t.postedBy}: ${row.authorName}`)),
  row.blocks.length&&!S.editContent?btn(`${S.expanded?'Hide':'Show'} ${row.blocks.length} attachment${row.blocks.length>1?'s':''}`,'btn-secondary w-fit',()=>{S.expanded=!S.expanded;view.rerender();},signal,{'data-card-expand':''}):null,
  S.expanded&&!S.editContent?el('div',{class:'flex flex-col gap-2 rounded-sm bg-paper-sunken p-2','data-card-blocks':''},row.blocks.map(b=>blockView(dict,b))):null,
  S.editContent?formShell(ctx,{materialId:m.id,mode:'edit',initial:{title:m.title,category:m.category,primary:primary(),blocks:row.blocks},view,onDone:async saved=>{S.editContent=false;if(saved)await view.reload({quiet:true});else view.rerender();}}):null,
  row.canManage&&!S.editTitle&&!S.editContent?el('div',{class:'flex flex-wrap gap-2'},btn(t.editBlocks,'btn-secondary',()=>{S.editContent=true;view.rerender();},signal,{disabled:S.pending,'data-card-edit-content':''}),btn(t.edit,'btn-ghost',()=>{S.editTitle=true;view.rerender();},signal,{disabled:S.pending,'data-card-edit-title':''}),btn(m.isActive?t.deactivate:t.activate,'btn-ghost',()=>{void patch({isActive:!m.isActive}).catch(()=>{});},signal,{disabled:S.pending,'data-card-toggle':''}),btn(dict.common.delete,'btn-ghost text-band-bad',()=>void del(),signal,{disabled:S.pending,'data-card-delete':''})):null);
}

/** StudyRichEditor.tsx — a small formatting toolbar over a contenteditable; paste and stored HTML are sanitized by the allowlist. */
export function studyEditor(ctx,{label,value,onChange}){
 const {dict,signal}=ctx,t=dict.speakingStudy;let saved=null;
 const ed=el('div',{contenteditable:'true',role:'textbox','aria-label':label,'aria-multiline':'true',class:'input min-h-40 overflow-auto whitespace-pre-wrap','data-study-editor':''});setChildren(ed,...cleanStudyNodes(value));
 const remember=()=>{const sel=window.getSelection?.();const r=sel&&sel.rangeCount?sel.getRangeAt(0):null;if(r&&ed.contains(r.commonAncestorContainer))saved=r.cloneRange();};
 const command=(name,arg)=>{ed.focus();if(saved){const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(saved);}if(typeof document.execCommand==='function')document.execCommand(name,false,arg);onChange(ed.innerHTML);remember();};
 listen(ed,'keyup',remember,signal);listen(ed,'pointerup',remember,signal);listen(ed,'input',()=>{remember();onChange(ed.innerHTML);},signal);
 listen(ed,'paste',e=>{remember();e.preventDefault();const html=e.clipboardData?.getData('text/html');if(html)command('insertHTML',cleanStudyHtml(html));else command('insertText',e.clipboardData?.getData('text/plain')??'');},signal);
 const bar=el('div',{role:'toolbar','aria-label':`${label}: ${t.formatting}`,class:'flex flex-wrap gap-2'},[[t.bold,'bold'],[t.italic,'italic'],[t.underline,'underline'],[t.highlight,'hiliteColor']].map(([text,name])=>{const b=el('button',{type:'button',class:'btn-secondary min-h-11','data-study-cmd':name},text);listen(b,'pointerdown',e=>e.preventDefault(),signal);listen(b,'click',()=>command(name,name==='hiliteColor'?'#fff1a8':undefined),signal);return b;}));
 const font=el('select',{'aria-label':`${label}: ${t.font}`,class:'input w-auto'},el('option',{value:'',disabled:'',selected:''},t.font),['Arial','Georgia','Times New Roman','Verdana','Courier New'].map(f=>el('option',{},f)));listen(font,'change',()=>command('fontName',font.value),signal);put(bar,font);
 return el('div',{class:'space-y-2'},bar,ed);
}
/** SpeakingPromptComposer.tsx — admin/owner topic composer (server: requireAdministrator). One module value drives which channels a topic is available in. */
export function promptComposer(ctx,view,W){
 const {dict,signal}=ctx,t=dict.speakingStudy,blank=()=>({promptText:'',cueCard:'',followUps:[],studySupport:blankSupport()});
 const S=(ctx.state.speakingTopic??={browsePart:'part1',search:'',module:'practice_alone',channels:[],questions:[],active:0,original:null,archiveConfirm:false,id:undefined,part:'part1',topic:'',question:'',cue:'',support:blankSupport(),open:[],pending:false,status:''});
 const node=el('section',{class:'card space-y-4 p-5','data-speaking-composer':''});
 const groups=()=>[...W.prompts.filter(p=>p.part!=='general').reduce((m,p)=>{const k=JSON.stringify([p.part,p.topic,usesSharedSpeakingBank(p.availableIn)?'shared':'ai']);m.set(k,[...(m.get(k)??[]),p]);return m;},new Map()).values()];
 const current=()=>({id:S.id,promptText:S.question,cueCard:S.cue,followUps:S.questions[S.active]?.followUps??[],studySupport:S.support});
 const all=()=>{const rows=S.questions.length?[...S.questions]:[current()];rows[S.active]=current();return rows;};
 const show=q=>{S.id=q.id;S.question=q.promptText;S.cue=q.cueCard;S.support=q.studySupport;S.open=[];S.status='';};
 const reset=()=>{S.original=null;S.questions=[];S.active=0;S.topic='';S.channels=[];S.archiveConfirm=false;show(blank());};
 const toDraft=q=>({id:q.id,promptText:q.promptText,cueCard:q.cueCard??'',followUps:q.followUps,studySupport:q.studySupport});
 function load(rows){const p=rows[0];if(p.part==='general')return;const bank=usesSharedSpeakingBank(p.availableIn)?'shared':'ai';S.original={part:p.part,topic:p.topic,bank,ids:rows.map(q=>q.id)};
  const visible=rows.some(q=>q.publicationState!=='archived')?rows.filter(q=>q.publicationState!=='archived'):rows;const drafts=visible.map(toDraft);S.questions=drafts;S.active=0;S.part=p.part;S.channels=p.availableIn;S.module=bank==='shared'?'practice_alone':'ai';S.topic=p.topic??'';S.archiveConfirm=false;show(drafts[0]);paint();}
 async function save(archive=false){
  if(S.pending||signal.aborted)return;S.pending=true;S.status='';paint();
  try{const body=archive?S.original:{original:S.original,questions:all().map(q=>({...q,promptText:S.part==='part2'&&!q.promptText.trim()?S.topic:q.promptText,part:S.part,topic:S.topic,availableIn:sharedSpeakingChannels([...S.channels,S.module])}))};
   const r=await saveTopic(body,archive,signal);if(signal.aborted)return;
   if(archive){reset();S.status=t.topicArchived;}else{const saved=r.prompts,drafts=saved.map(toDraft);S.questions=drafts;show(drafts[Math.min(S.active,drafts.length-1)]);S.original={part:saved[0].part,topic:saved[0].topic,bank:usesSharedSpeakingBank(saved[0].availableIn)?'shared':'ai',ids:[...new Set([...(S.original?.ids??[]),...saved.map(q=>q.id)])]};S.status=t.published;}
   S.pending=false;paint();void view.reload({quiet:true});}
  catch(e){if(signal.aborted)return;S.pending=false;S.status=e?.status===409?t.topicConflict:e?.status===400?t.invalid:t.saveFailed;paint();}
 }
 const sel=(id,opts,val,fn,dis)=>{const s=el('select',{class:'input',id,disabled:dis},opts.map(([v,l])=>el('option',{value:v},l)));s.value=val;listen(s,'change',()=>fn(s.value),signal);return s;};
 const bindText=(n,get,set)=>{n.value=get();listen(n,'input',()=>set(n.value),signal);return n;};
 function paint(){
  const mod=el('label',{class:'block'},t.module,sel('',[['practice_alone',t.practice],['live_partner',t.partner],['ai',t.ai],['lessons',t.lessons]],S.module,v=>{const shared=['practice_alone','live_partner'];if(!shared.includes(S.module)||!shared.includes(v))reset();S.module=v;paint();},S.pending));
  let body;
  if(S.module==='lessons'){body=formShell(ctx,{mode:'create',initial:{title:'',category:'part1',primary:{mode:'empty'},blocks:[]},view,onDone:async saved=>{if(saved)await view.reload({quiet:true});}});}
  else{
   const form=el('form',{class:'space-y-4','data-topic-form':''});
   const mkq=()=>{const rows=all();S.questions=rows;return rows;};
   const qbar=el('div',{class:'flex flex-wrap gap-2','aria-label':t.questions},Array.from({length:Math.max(1,S.questions.length)},(_,i)=>{const b=el('button',{type:'button',class:'btn-secondary',disabled:S.pending,'aria-pressed':String(i===S.active),'data-topic-q':String(i)},`${t.question} ${i+1}`);listen(b,'click',()=>{const rows=mkq();S.active=i;show(rows[i]);paint();},signal);return b;}));
   const q=el('textarea',{class:'input',maxlength:'200',disabled:S.pending,'data-topic-question':''});if(S.part!=='part2')q.required=true;bindText(q,()=>S.question,v=>{S.question=v;});
   const cue=S.part==='part2'?el('label',{class:'block'},t.cueInstructions,bindText(el('textarea',{class:'input min-h-28',disabled:S.pending,'data-topic-cue':''}),()=>S.cue,v=>{S.cue=v;})):null;
   const helpers=S.module==='practice_alone'?el('div',{class:'flex flex-wrap gap-2'},[['vocabularyHtml',t.addVocabulary],['modelAnswerHtml',t.addSample],['ideasHtml',t.addIdeas]].map(([k,l])=>{const b=el('button',{type:'button',class:'btn-secondary','aria-expanded':String(S.open.includes(k)),'data-topic-helper':k},l);listen(b,'click',()=>{S.open=S.open.includes(k)?S.open.filter(x=>x!==k):[...S.open,k];paint();},signal);return b;})):null;
   const editors=[['vocabularyHtml',t.vocabulary],['modelAnswerHtml',t.sampleAnswer],['ideasHtml',t.ideas]].filter(([k])=>S.module==='practice_alone'&&S.open.includes(k)).map(([k,label])=>{
    const fs=el('fieldset',{class:'space-y-3','data-topic-editor':k},el('legend',{class:'font-semibold'},label),studyEditor(ctx,{label,value:S.support[k],onChange:h=>{S.support={...S.support,[k]:h};}}));
    if(k==='vocabularyHtml'){put(fs,el('p',{class:'text-sm text-ink-500'},t.wordHelp),S.support.vocabulary.map((w,i)=>el('div',{class:'grid gap-2 rounded-xl border border-ink-100 p-3 sm:grid-cols-2','data-topic-word':String(i)},[['term',t.word],['definitionEn',t.meaningEn],['translationUz',t.meaningUz],['partOfSpeech',t.pos],['exampleSentence',t.example]].map(([f,l])=>{const inp=el('input',{class:'input',required:f==='term'||f==='definitionEn'?'':null,'data-topic-word-field':f});return el('label',{},l,bindText(inp,()=>w[f],v=>{w[f]=v;}));}),(()=>{const b=el('button',{type:'button',class:'btn-secondary'},t.remove);listen(b,'click',()=>{S.support={...S.support,vocabulary:S.support.vocabulary.filter((_,j)=>j!==i)};paint();},signal);return b;})())));
     const add=el('button',{type:'button',class:'btn-secondary',disabled:S.support.vocabulary.length>=100,'data-topic-new-word':''},t.newWord);listen(add,'click',()=>{S.support={...S.support,vocabulary:[...S.support.vocabulary,{term:'',definitionEn:'',translationUz:'',partOfSpeech:'',exampleSentence:''}]};paint();},signal);put(fs,add);}
    return fs;});
   const nextQ=S.part!=='part2'?(()=>{const b=el('button',{type:'button',class:'btn-secondary',disabled:S.pending||S.questions.length>=100,'data-topic-next':''},t.nextQuestion);listen(b,'click',()=>{const rows=mkq(),n=blank();S.questions=[...rows,n];S.active=rows.length;show(n);paint();},signal);return b;})():null;
   const rmQ=S.questions.length>1?(()=>{const b=el('button',{type:'button',class:'btn-secondary ml-2',disabled:S.pending,'data-topic-remove-question':''},t.removeQuestion);listen(b,'click',()=>{const rows=all().filter((_,i)=>i!==S.active);S.questions=rows;S.active=0;show(rows[0]);paint();},signal);return b;})():null;
   const submit=el('button',{type:'submit',class:'btn-primary',disabled:S.pending,'data-topic-submit':''},S.pending?dict.common.saving:S.original?t.publishChanges:t.publish);
   const newT=el('button',{type:'button',class:'btn-secondary ml-2',disabled:S.pending,'data-topic-new':''},t.newTopic);listen(newT,'click',()=>{reset();paint();},signal);
   const rmT=S.original?(()=>{const b=el('button',{type:'button',class:'btn-secondary ml-2',disabled:S.pending,'data-topic-archive':''},t.removeTopic);listen(b,'click',()=>{S.archiveConfirm=true;paint();},signal);return b;})():null;
   const arch=S.archiveConfirm?(()=>{const c=el('button',{type:'button',class:'btn-secondary',disabled:S.pending,'data-topic-archive-confirm':''},t.confirmArchive),x=el('button',{type:'button',class:'btn-secondary ml-2'},t.cancel);listen(c,'click',()=>void save(true),signal);listen(x,'click',()=>{S.archiveConfirm=false;paint();},signal);return el('div',{role:'alert',class:'space-y-2'},el('p',{},t.archiveHelp),c,x);})():null;
   const topic=el('input',{class:'input',required:'',maxlength:'200',disabled:S.pending,'data-topic-title':''});bindText(topic,()=>S.topic,v=>{S.topic=v;});
   const part=sel('',[1,2,3].map(n=>[`part${n}`,`${t.part} ${n}`]),S.part,v=>{reset();S.part=v;paint();},S.pending||!!S.original);
   put(form,el('label',{class:'block'},t.part,part),el('label',{class:'block'},t.topic,topic),qbar,el('label',{class:'block'},S.part==='part2'?t.cueQuestion:t.question,q),cue,helpers,editors,nextQ,rmQ,el('p',{class:'text-sm text-ink-500'},t.topicUploadHelp),submit,newT,rmT,arch,S.status?el('p',{role:'status','data-topic-status':''},S.status):null);
   listen(form,'submit',e=>{e.preventDefault();if(!form.checkValidity())return;void save(false);},signal);body=form;
  }
  const g=groups(),search=el('input',{type:'search',class:'input','data-topic-search':''});bindText(search,()=>S.search,v=>{S.search=v;paintGroups();});
  const list=el('ul',{class:'grid max-h-96 gap-2 overflow-auto sm:grid-cols-2','data-topic-groups':''}),count=el('p',{role:'status',class:'text-sm text-ink-500'});
  function paintGroups(){const terms=S.search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),vis=groups().filter(rows=>rows[0].part===S.browsePart&&rows.some(r=>{const tx=`${r.topic??''} ${r.promptText} ${r.cueCard??''}`.normalize('NFKC').toLocaleLowerCase();return terms.every(x=>tx.includes(x));}));
   setChildren(list,...vis.map(rows=>{const b=el('button',{type:'button',disabled:S.pending,class:'btn-secondary w-full text-left','data-topic-group':rows[0].id},`${rows[0].part} · ${rows[0].topic} · ${rows.filter(q=>q.publicationState!=='archived').length} ${t.questions}${rows.every(q=>q.publicationState==='archived')?` · ${t.archived}`:''}`);listen(b,'click',()=>load(rows),signal);return el('li',{},b);}));count.textContent=`${vis.length} ${t.topic}`;}
  W.paintGroups=paintGroups;
  const det=el('details',{},el('summary',{},`${t.editExisting} (${g.length})`),el('div',{class:'space-y-3 pt-3'},el('div',{class:'flex flex-wrap gap-2','aria-label':t.part},[1,2,3].map(n=>{const b=el('button',{type:'button',class:S.browsePart===`part${n}`?'btn-primary':'btn-secondary','aria-pressed':String(S.browsePart===`part${n}`),'data-topic-browse':`part${n}`},`PART ${n}`);listen(b,'click',()=>{S.browsePart=`part${n}`;paint();},signal);return b;})),el('label',{class:'block'},`${t.topic} / ${t.question}`,search),list,count));
  paintGroups();setChildren(node,mod,body,det);
 }
 paint();return node;
}
/** Source: teacher/speaking/page.tsx. Teachers get "New material"; admin/owner get the topic composer (long-lived widget; `ctx.speakingPromptComposer` may override). */
export const mount=mountStaff({name:'teacher-speaking',roles:STAFF,load:c=>manage(c.signal),
 render(ctx,d,view){const {dict,session,signal}=ctx,t=dict.speaking,role=session.user.role,S=(ctx.state.speakingNew??={open:false});
  const create=!S.open?btn(`+ ${t.newMaterial}`,'btn-primary',()=>{S.open=true;view.rerender();},signal,{'data-new-material':''}):null;
  const form=S.open?formShell(ctx,{mode:'create',initial:{title:'',category:'part1',primary:{mode:'empty'},blocks:[]},view,onDone:async saved=>{S.open=false;if(saved)await view.reload({quiet:true});else view.rerender();}}):null;
  const W=(ctx.state.speakingW??={prompts:[]});W.prompts=d.prompts;if(W.paintGroups&&ctx.state.speakingComposer)W.paintGroups();const composer=['admin','owner'].includes(role)?(ctx.state.speakingComposer??=(ctx.speakingPromptComposer?.(ctx,d,view)??promptComposer(ctx,view,W))):null;
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4','data-teacher-speaking':''},el('div',{class:'flex items-center justify-between'},el('h1',{class:'font-display text-2xl text-ink-900'},t.manageTitle),role==='teacher'?create:null),role==='teacher'?form:null,composer,
   el('div',{class:'flex flex-col gap-3'},d.rows.map(r=>card(ctx,r,view))));}});
