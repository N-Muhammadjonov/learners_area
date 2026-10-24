import {el,listen,errorText,put,setChildren} from './kit.js';
import {rawJson,isObj} from '../../js/adapters/staff-final30/core.js';
import {preflight,startUpload,describeUploadError,uploadErrorMessage,acceptAttribute,maxBytesLabel,formatBytes} from '../../js/adapters/staff-final30/uploads.js';
/**
 * The universal material composer (source components/resources/ResourceComposer.tsx).
 * One ordered list of blocks (text, link, image, audio, file) attached to any owner type. It never invents an upload,
 * never sends an object key the server did not issue (stored files are re-sent as retained keys, claimed server-side),
 * and never claims success: the list is marked saved only after the server answers with the stored blocks.
 * Initial blocks come from the EXISTING `GET /api/materials/:type/:id`; if that read fails, saving is DISABLED so an
 * unseen list can never be overwritten with an empty one.
 */
const KINDS=['text','link','image','audio','file'],MEDIA=['image','audio','file'];
let seq=0;const newId=()=>`b_${(++seq).toString(36)}${Math.random().toString(36).slice(2,6)}`;
const draftFromBlock=b=>b.type==='text'?{localId:newId(),type:'text',textContent:b.textContent??''}:b.type==='link'?{localId:newId(),type:'link',linkUrl:b.linkUrl??''}:{localId:newId(),type:b.type,state:'complete',progress:100,objectKey:b.objectKey??undefined,originalName:b.originalName??'file',mimeType:b.mimeType??'application/octet-stream',size:b.size??undefined};
function parseBlocks(data){
 if(!isObj(data)||!Array.isArray(data.blocks)||data.blocks.length>200)throw new Error('invalid_response');
 return data.blocks.map(b=>{if(!isObj(b)||!KINDS.includes(b.type))throw new Error('invalid_response');return {type:b.type,position:Number.isFinite(b.position)?b.position:0,textContent:typeof b.textContent==='string'?b.textContent:null,linkUrl:typeof b.linkUrl==='string'?b.linkUrl:null,objectKey:typeof b.objectKey==='string'?b.objectKey:null,originalName:typeof b.originalName==='string'?b.originalName:null,mimeType:typeof b.mimeType==='string'?b.mimeType:null,size:Number.isFinite(b.size)?b.size:null};}).sort((a,b)=>a.position-b.position);
}
export function resourceComposer(ctx,{ownerType,ownerId,title},deps={}){
 const {dict,signal}=ctx,t=dict.resources,start=deps.startUpload??ctx.startUpload??startUpload;
 const S={blocks:[],loaded:false,loadFailed:false,state:'idle',menu:false,pick:'file',dropped:false};
 const handles=new Map(),gens=new Map();
 const host=el('section',{class:'panel flex flex-col gap-3','data-resource-composer':ownerType});
 const path=`/api/materials/${encodeURIComponent(ownerType)}/${ownerId}`;
 signal.addEventListener('abort',()=>{for(const h of handles.values())h.cancel();handles.clear();},{once:true});
 const alive=()=>!signal.aborted;
 async function load(){S.loadFailed=false;S.loaded=false;paint();
  try{const r=await rawJson('GET',path,undefined,signal);if(!alive())return;if(!r.ok)throw new Error('load');S.blocks=parseBlocks(r.data).map(draftFromBlock);S.loaded=true;}catch{if(!alive())return;S.loadFailed=true;}
  paint();}
 function upload(file,kind,replaceId){
  const localId=replaceId??newId();handles.get(localId)?.cancel();const gen={};gens.set(localId,gen);
  const draft={localId,type:kind,state:'queued',progress:0,originalName:file.name,mimeType:file.type||'application/octet-stream',size:file.size,file};
  S.blocks=replaceId?S.blocks.map(b=>b.localId===replaceId?draft:b):[...S.blocks,draft];S.state='idle';
  const patch=p=>{if(!alive()||gens.get(localId)!==gen)return;S.blocks=S.blocks.map(b=>b.localId===localId&&'state' in b?{...b,...p}:b);paint();};
  const check=preflight(file,kind);paint();
  if(!check.ok){patch({state:'failed',error:describeUploadError(check.error,dict.uploadErrors)});return Promise.resolve();}
  const h=start(file,{purpose:'material_block',blockKind:kind,onState:s=>patch({state:s}),onProgress:p=>patch({progress:p})});handles.set(localId,h);
  return h.promise.then(res=>{if(!alive()||gens.get(localId)!==gen)return;handles.delete(localId);
   if(res.ok)patch({state:'complete',progress:100,uploadId:res.uploadId,objectKey:res.objectKey});else patch({state:'failed',error:uploadErrorMessage(res.failure,dict.uploadErrors)});});
 }
 async function save(){
  if(!S.loaded||S.state==='saving'||!alive())return;S.state='saving';S.message=null;paint();
  try{
   const payload=S.blocks.filter(b=>!('state' in b)||b.state==='complete').map(b=>b.type==='text'?{type:'text',textContent:b.textContent}:b.type==='link'?{type:'link',linkUrl:b.linkUrl}:{type:b.type,uploadId:b.uploadId??null,objectKey:b.uploadId?null:(b.objectKey??null)});
   const r=await rawJson('PUT',path,{blocks:payload},signal);if(!alive())return;if(!r.ok)throw new Error(String(r.status));
   S.blocks=parseBlocks(r.data).map(draftFromBlock);S.state='saved';
  }catch{if(!alive())return;S.state='error';S.message=t.saveFailed;}
  paint();
 }
 const move=(id,d)=>{const i=S.blocks.findIndex(b=>b.localId===id),j=i+d;if(i<0||j<0||j>=S.blocks.length)return;const n=[...S.blocks];const [x]=n.splice(i,1);n.splice(j,0,x);S.blocks=n;S.state='idle';paint();};
 const remove=id=>{gens.delete(id);handles.get(id)?.cancel();handles.delete(id);S.blocks=S.blocks.filter(b=>b.localId!==id);S.state='idle';paint();};
 const pickFile=kind=>{S.pick=kind;const input=host.querySelector('[data-composer-file]');input.setAttribute('accept',acceptAttribute(kind));input.click();};
 function blockNode(b,i){
  const label={text:t.blockText,link:t.blockLink,image:t.blockImage,audio:t.blockAudio,file:t.blockFile}[b.type];
  const ib=(cls,aria,attrs,fn,text)=>{const n=el('button',{type:'button',class:'flex h-11 w-11 items-center justify-center rounded-sm text-ink-500 hover:bg-paper-raised disabled:opacity-40','aria-label':aria,...attrs},text);listen(n,'click',fn,signal);return n;};
  const li=el('li',{class:'rounded-sm border border-ink-100 bg-paper-sunken/60 p-3','data-composer-block':b.type},
   el('div',{class:'mb-2 flex items-center justify-between gap-2'},el('span',{class:'text-xs font-semibold uppercase tracking-wide text-ink-500'},label),el('span',{class:'flex items-center gap-1'},ib('',t.moveUp,{disabled:i===0,'data-composer-move':'up'},()=>move(b.localId,-1),'↑'),ib('',t.moveDown,{disabled:i===S.blocks.length-1,'data-composer-move':'down'},()=>move(b.localId,1),'↓'),ib('',t.remove,{'data-composer-remove':''},()=>remove(b.localId),'×'))));
  if(b.type==='text'){const ta=el('textarea',{class:'input',placeholder:t.textPlaceholder,maxlength:'4000','data-composer-text':'','data-focus-key':'ct-'+b.localId});ta.value=b.textContent;listen(ta,'input',()=>{b.textContent=ta.value;S.state='idle';},signal);put(li,ta);}
  if(b.type==='link'){const inp=el('input',{class:'input',placeholder:'https://…',inputmode:'url','data-composer-link':'','data-focus-key':'cl-'+b.localId});inp.value=b.linkUrl;listen(inp,'input',()=>{b.linkUrl=inp.value;S.state='idle';},signal);put(li,inp);}
  if('state' in b){
   const retry=el('button',{type:'button',class:'btn-secondary','data-composer-retry':''},t.retry);listen(retry,'click',()=>{if(b.file)void upload(b.file,b.type,b.localId);},signal);
   const rm=el('button',{type:'button',class:'btn-secondary'},t.remove);listen(rm,'click',()=>remove(b.localId),signal);
   put(li,el('div',{class:'flex flex-col gap-1.5','data-upload-state':b.state},el('p',{class:'text-sm text-ink-700'},`${b.originalName}${b.size?` · ${formatBytes(b.size)}`:''}`),
    b.state==='failed'?el('p',{class:'flex flex-wrap items-center gap-2 text-sm text-band-bad',role:'alert'},`${t.uploadFailed} ${b.error??''}`,b.file?retry:null,rm):b.state==='complete'?el('p',{class:'text-xs text-ink-300'},t.uploaded):el('p',{class:'text-xs text-ink-500'},`${b.state==='finalizing'?t.finalizing:t.uploading} ${b.progress}%`),
    b.state!=='complete'&&b.state!=='failed'?el('span',{class:'h-1.5 overflow-hidden rounded-full bg-paper-raised'},el('span',{class:'block h-full bg-signal-600',style:{width:`${b.progress}%`}})):null));
  }
  return li;
 }
 function paint(){
  const failed=S.blocks.filter(b=>'state' in b&&b.state==='failed').length;
  const add=el('button',{type:'button',class:'btn-secondary inline-flex items-center gap-1.5','aria-expanded':String(S.menu),'aria-haspopup':'menu','data-composer-add':'',disabled:!S.loaded},`+ ${t.add}`);listen(add,'click',()=>{S.menu=!S.menu;paint();},signal);
  const menu=S.menu?el('ul',{class:'absolute right-0 z-[var(--z-dropdown)] mt-2 w-48 overflow-hidden rounded-sm border border-ink-100 bg-paper-raised py-1 shadow-card',role:'menu'},[['text',t.addText],['link',t.addLink],['image',t.addImage],['audio',t.addAudio],['file',t.addFile]].map(([k,l])=>{const b=el('button',{type:'button',role:'menuitem','data-composer-add-option':k,class:'flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ink-700 hover:bg-paper-sunken'},l);
   listen(b,'click',()=>{S.menu=false;if(k==='text'){S.blocks=[...S.blocks,{localId:newId(),type:'text',textContent:''}];S.state='idle';paint();}else if(k==='link'){S.blocks=[...S.blocks,{localId:newId(),type:'link',linkUrl:''}];S.state='idle';paint();}else{paint();pickFile(k);}},signal);return el('li',{},b);})):null;
  const input=el('input',{type:'file',class:'sr-only',accept:acceptAttribute(S.pick),'data-composer-file':''});listen(input,'change',()=>{const f=input.files?.[0];if(f)void upload(f,S.pick);input.value='';},signal);
  const saveBtn=el('button',{type:'button',class:'btn-primary','data-composer-save':'',disabled:!S.loaded||S.state==='saving'},S.state==='saving'?dict.common.saving:dict.common.save);listen(saveBtn,'click',()=>void save(),signal);
  const drop=el('div',{class:`rounded-sm border border-dashed px-3 py-2 text-xs ${S.dropped?'border-signal-600 text-signal-600':'border-ink-100 text-ink-300'}`,'data-composer-dropzone':''},t.dropHint);
  listen(drop,'dragover',e=>{e.preventDefault();if(!S.dropped){S.dropped=true;drop.classList.add('border-signal-600');}},signal);listen(drop,'dragleave',()=>{S.dropped=false;paint();},signal);
  listen(drop,'drop',e=>{e.preventDefault();S.dropped=false;const f=e.dataTransfer?.files?.[0];if(!f){paint();return;}const kind=f.type.startsWith('image/')?'image':f.type.startsWith('audio/')?'audio':'file';void upload(f,kind);},signal);
  const body=S.loadFailed?el('div',{role:'alert','data-composer-load-failed':'',class:'flex items-center gap-2 text-sm text-band-bad'},t.saveFailed.length?dict.common.error:'',(()=>{const r=el('button',{type:'button',class:'btn-secondary'},dict.common.retry);listen(r,'click',()=>void load(),signal);return r;})())
   :!S.loaded?el('div',{role:'status','aria-busy':'true','data-async-loading':'composer',class:'h-16 animate-pulse rounded-xl bg-ink-50'})
   :S.blocks.length===0?el('p',{class:'rounded-sm border border-dashed border-ink-100 px-3 py-4 text-sm text-ink-500','data-composer-empty':''},t.empty):el('ul',{class:'flex flex-col gap-2','data-composer-blocks':''},S.blocks.map(blockNode));
  const focus=document.activeElement?.getAttribute?.('data-focus-key');
  setChildren(host,el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('div',{},el('h2',{class:'card-title'},title??t.title),el('p',{class:'meta-text'},t.hint)),el('div',{class:'relative'},add,menu)),input,body,
   el('div',{class:'flex flex-wrap items-center gap-3'},saveBtn,S.state==='saved'?el('span',{class:'text-sm text-band-good','data-composer-state':'saved'},dict.common.saved):null,S.state==='error'?el('span',{class:'text-sm text-band-bad',role:'alert','data-composer-state':'error'},S.message??t.saveFailed):null,failed>0&&S.state!=='error'?el('span',{class:'text-sm text-band-bad'},t.failedUploads):null,el('span',{class:'meta-text'},t.sizeLimit.replace('{size}',maxBytesLabel('file')))),drop);
  if(focus)host.querySelector(`[data-focus-key="${focus}"]`)?.focus();
 }
 void load();return host;
}
