"use client";
import {useEffect,useRef,useState} from "react";
import type {Dictionary} from "@/lib/i18n/en";
import type {VocabularySessionItem} from "@/lib/services/lexical/listening-occurrences";
import {AUTHORED_SANDBOX,isolateAuthoredDocument,validRuntimeMessage} from "@/lib/listening/authored-sandbox";
import {WordPopover} from "@/components/vocabulary/ClickableText";
import {privateResources} from "@/lib/client/private-resource";
type Runtime={entryPath:string;files:Record<string,string>};
type Content={nativePersistence?:boolean;storageKey?:string;additionalAudio?:{path:string;url:string}[];runtime:Runtime;audioUrl:string;audioPath:string;imageUrl:string|null;imagePath:string|null;vocabulary:VocabularySessionItem[]};
let cachedAudioTest='';
function bridge(token:string,stored:Record<string,string>,notesLabel:string,storageKey='la_listening_test_1_v2') {
 return `(()=>{const token=${JSON.stringify(token)}, initial=${JSON.stringify(stored)}, notesLabel=${JSON.stringify(notesLabel)}, storageKey=${JSON.stringify(storageKey)};
 const send=(op,rest)=>parent.postMessage({channel:'learners-area-authored-v1',token,op,...rest},'*');
 const makeStorage=(seed,persist)=>{const data={...seed};let timer,maxTimer,lastStatus;const flush=()=>{clearTimeout(timer);clearTimeout(maxTimer);timer=maxTimer=undefined;if(persist)send('storage',{values:{...data}});};const changed=()=>{if(!persist)return;let status;try{status=JSON.parse(data[storageKey]||'{}').attemptStatus;}catch{}if(status!==lastStatus){lastStatus=status;flush();return;}clearTimeout(timer);timer=setTimeout(flush,400);if(!maxTimer)maxTimer=setTimeout(flush,2000);};if(persist)addEventListener('pagehide',flush);return {getItem:k=>Object.hasOwn(data,String(k))?data[String(k)]:null,setItem:(k,v)=>{if(String(v).length>100000)return;data[String(k)]=String(v);changed();},removeItem:k=>{delete data[String(k)];changed();},clear:()=>{for(const k in data)delete data[k];changed();},key:i=>Object.keys(data)[i]??null,get length(){return Object.keys(data).length}}};
 Object.defineProperty(window,'localStorage',{value:makeStorage(initial,true)});Object.defineProperty(window,'sessionStorage',{value:makeStorage({},false)});
 addEventListener('message',e=>{if(e.source===parent&&e.data?.channel==='learners-area-checkpoint'&&e.data.token===token)dispatchEvent(new CustomEvent('la-checkpoint',{detail:e.data.values}));});
 const notes=()=>{const volume=document.querySelector('#examVol,#volume')||Array.from(document.querySelectorAll('input[type="range"]')).find(input=>input.getAttribute('aria-label')?.toLowerCase()==='volume');if(!volume||document.getElementById('la-note-toggle')||document.getElementById('notesBtn'))return;const target=volume.previousElementSibling?.textContent.trim()==='Volume'?volume.previousElementSibling:volume;const button=document.createElement('button');button.id='la-note-toggle';button.type='button';button.textContent=notesLabel;button.style.cssText='background:#4f46e5;color:white;border:0;border-radius:8px;padding:8px 12px';target.before(button);const panel=document.createElement('aside');panel.style.cssText='display:none;position:fixed;right:20px;top:90px;width:min(320px,90vw);padding:16px;background:#171a30;color:white;z-index:9999;border-radius:12px';const label=document.createElement('label');label.textContent=notesLabel;const input=document.createElement('textarea');input.setAttribute('aria-label',notesLabel);input.maxLength=12000;input.value=localStorage.getItem('la-notes')||'';input.style.cssText='display:block;width:100%;min-height:220px;background:#0f1120;color:white';input.oninput=()=>localStorage.setItem('la-notes',input.value);label.append(input);panel.append(label);document.body.append(panel);button.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';button.setAttribute('aria-expanded',String(panel.style.display==='block'));};};
 document.addEventListener('DOMContentLoaded',()=>{notes();new MutationObserver(notes).observe(document.body,{childList:true,subtree:true});const hub=document.getElementById('hub');if(hub){let previous;const view=()=>{const visible=hub.style.display!=='none'&&!hub.hidden;if(visible!==previous){previous=visible;send('view',{hub:visible});}};view();new MutationObserver(view).observe(hub,{attributes:true,attributeFilter:['style','hidden','class']});}});
 document.addEventListener('click',e=>{const el=e.target instanceof Element?e.target:null;if(!el)return;
 const link=el.closest('a[href]');if(link){const href=link.getAttribute('href');if(href&&!href.startsWith('#')){e.preventDefault();e.stopImmediatePropagation();send('navigate',{path:href});return;}}
 const area=el.closest('#vocab,#script,#view-vocab,#view-script,#activity-vocab,#activity-script,[data-la-vocabulary],[data-la-script]');if(!area)return;
 const button=el.closest('button');const indexed=button?.hasAttribute('data-addv')?button.closest('.vocab-card')?.querySelector('.vword')?.firstChild?.textContent?.trim():null;const term=button?.dataset.vocabSave||button?.dataset.saveLex||indexed||(/saveWord\\(['\"](.+?)['\"]\\)/.exec(button?.getAttribute('onclick')||'')||[])[1];
 if(term){e.preventDefault();e.stopImmediatePropagation();send('word',{word:term,mode:'vocab',x:e.clientX,y:e.clientY,context:area.textContent.slice(0,3000)});return;}
 if(el.closest('button,input,textarea,select')||!getSelection()?.isCollapsed)return;
 const range=document.caretRangeFromPoint?.(e.clientX,e.clientY);if(!range||range.startContainer.nodeType!==3)return;
 const text=range.startContainer.textContent||'',at=range.startOffset;let l=at,r=at;while(l>0&&/[a-zA-Z'-]/.test(text[l-1]))l--;while(r<text.length&&/[a-zA-Z'-]/.test(text[r]))r++;
 const word=text.slice(l,r);if(word)send('word',{word,mode:area.id.includes('vocab')?'vocab':'script',x:e.clientX,y:e.clientY,context:el.closest('p,.transcript,.script-row,.script-line')?.textContent.slice(0,3000)||text.slice(0,3000)});
 },true);})();`;
}
function resolvePath(current:string,path:string) {
 try {const url=new URL(path,'https://listening-package.invalid/'+current);return url.origin==='https://listening-package.invalid'?decodeURIComponent(url.pathname.slice(1)):null;}catch{return null;}
}
export function AuthoredListeningFrame({id,userId,dict,preview}:{id:string;userId:string;dict:Dictionary;preview?:{runtime:Runtime;audioFile:File;audioPath:string;imageFile:File|null;imagePath:string|null}}) {
 const [content,setContent]=useState<Content|null>(null),[path,setPath]=useState(''),[assets,setAssets]=useState<Record<string,string>>({}),[error,setError]=useState(''),[stored,setStored]=useState<Record<string,string>>({}),[selected,setSelected]=useState<{word:string;x:number;y:number;known:VocabularySessionItem|null}|null>(null),[folders,setFolders]=useState<{id:string;name:string}[]>([]),[folderId,setFolderId]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
 const writes=useRef(Promise.resolve()),pending=useRef<Record<string,string>|null>(null);
 const [activityActive,setActivityActive]=useState(false);
 const frame=useRef<HTMLIFrameElement>(null),anchor=useRef<HTMLSpanElement>(null),token=useRef(''),mediaBlobs=useRef<Record<string,Blob>>({}),stateKey=`la-authored-listening:${userId}:${id}`;
 if(!token.current)token.current=crypto.randomUUID();
 useEffect(()=>{const abort=new AbortController(),urls:string[]=[];let live=true;
  mediaBlobs.current={};
  const objectUrl=(blob:Blob)=>{if(!live)throw new DOMException('Aborted','AbortError');const url=URL.createObjectURL(blob);urls.push(url);mediaBlobs.current[url]=blob;return url;};
  async function load(){try {
   const data:Content=preview?{runtime:preview.runtime,audioUrl:'',audioPath:preview.audioPath,imageUrl:null,imagePath:preview.imagePath,vocabulary:[]}:await fetch(`/api/listening/full/${id}/authored`,{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json();});
   const media:Record<string,string>={};
   const readBlob=async(url:string)=>{if(!url.startsWith('/api/resources/'))throw Error();const read=async()=>{const r=await fetch(url,{signal:abort.signal});if(!r.ok)throw Error();return r.blob();};
    // Only this versioned test's immutable audio uses the user-scoped memory
    // cache. The authorized metadata and learner checkpoint are still fetched
    // fresh on every mount; source/answer keys and learner state are not cached.
    // Scope changes/logout already clear this cache. The sandbox/Blob handoff
    // and exam controls remain exactly the same as the uncached path.
    if(data.nativePersistence&&(url===data.audioUrl||data.additionalAudio?.some(extra=>extra.url===url))&&privateResources.scope===userId){const scope=userId+':'+id;if(cachedAudioTest!==scope){privateResources.invalidate('listening-authored-audio:');cachedAudioTest=scope;}return privateResources.read(`listening-authored-audio:${id}:${url.split('?')[0]}`,read,{maxAgeMs:5*60_000});}
    return read();};
   await Promise.all([
    (async()=>{media[data.audioPath]=objectUrl(preview?preview.audioFile:await readBlob(data.audioUrl));})(),
    ...(data.additionalAudio??[]).map(async extra=>{media[extra.path]=objectUrl(await readBlob(extra.url));}),
    (async()=>{if(data.imagePath&&(preview?.imageFile||data.imageUrl))media[data.imagePath]=objectUrl(preview?.imageFile??await readBlob(data.imageUrl!));})(),
   ]);
   for(const [name,value]of Object.entries(data.runtime.files))if(/\.(js|css)$/i.test(name))media[name]=objectUrl(new Blob([value],{type:/\.js$/i.test(name)?'text/javascript':'text/css'}));
   if(!live)return;
   if(data.nativePersistence){const response=await fetch(`/api/listening/full/${id}/authored-state`,{signal:abort.signal,cache:'no-store'});if(!response.ok)throw Error();const checkpoint=await response.json();let values=checkpoint.values;try{const outbox=localStorage.getItem(stateKey+':pending');if(outbox){const saved=await fetch(`/api/listening/full/${id}/authored-state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:outbox,signal:abort.signal});if(!saved.ok)throw Error();values=(await saved.json()).values;localStorage.removeItem(stateKey+':pending');}}catch{throw Error();}setStored(values);}else{try{const raw=JSON.parse(localStorage.getItem(stateKey)||'{}');if(raw&&typeof raw==='object'&&JSON.stringify(raw).length<=100000)setStored(raw);}catch{}}
   setAssets(media);setContent(data);setPath(data.runtime.entryPath);
  }catch{if(live)setError(dict.common.error);}}
  void load();return()=>{live=false;abort.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
 },[id,userId,stateKey,dict.common.error,preview]);
 useEffect(()=>{function receive(event:MessageEvent){if(!validRuntimeMessage(event,frame.current?.contentWindow,token.current))return;const d=event.data;
   if(d.op==='view'&&typeof d.hub==='boolean'){setActivityActive(!d.hub);return;}
   if(d.op==='storage'&&d.values&&typeof d.values==='object'&&JSON.stringify(d.values).length<=100000){try{localStorage.setItem(stateKey,JSON.stringify(d.values));}catch{}if(content?.nativePersistence){const values=d.values;pending.current=values;try{localStorage.setItem(stateKey+':pending',JSON.stringify(values));}catch{}writes.current=writes.current.then(async()=>{for(let retry=0;retry<3;retry++){try{const response=await fetch(`/api/listening/full/${id}/authored-state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(values),signal:AbortSignal.timeout(15000),keepalive:JSON.stringify(values).length<60000});if(!response.ok)throw Error();const checkpoint=await response.json();frame.current?.contentWindow?.postMessage({channel:'learners-area-checkpoint',token:token.current,values:checkpoint.values},'*');if(pending.current===values){pending.current=null;try{localStorage.removeItem(stateKey+':pending');}catch{}}setError('');return;}catch{if(retry<2)await new Promise(resolve=>setTimeout(resolve,1000*(retry+1)));}}setError(dict.common.error);});}return;}
   if(d.op==='navigate'&&typeof d.path==='string'){const next=resolvePath(path,d.path);if(next&&content?.runtime.files[next]&&/\.html?$/i.test(next)){setSelected(null);setPath(next);}return;}
   if(d.op==='word'&&!preview&&typeof d.word==='string'&&d.word.trim().length>0&&d.word.length<=120&&Number.isFinite(d.x)&&Number.isFinite(d.y)){
    const matches=content?.vocabulary.filter(row=>row.term.toLowerCase()===d.word.trim().toLowerCase()&&(d.mode==='vocab'||(row.example&&typeof d.context==='string'&&d.context.includes(row.example))))??[];
    setSelected({word:d.word.trim(),x:Math.max(0,Math.min(d.x,frame.current?.clientWidth??0)),y:Math.max(0,Math.min(d.y,frame.current?.clientHeight??0)),known:matches.length===1?matches[0]!:null});setSaved(false);setFolderId('');
    void fetch('/api/vocabulary/folders',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>setFolders(data.folders??[])).catch(()=>setError(dict.common.error));
   }}window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[content,path,preview,stateKey,dict.common.error,id]);
 let document='';if(content&&path){let html=content.runtime.files[path]??'';for(const [name,url]of Object.entries(assets)){html=html.replaceAll(`[embedded:${name}]`,url);html=html.replace(new RegExp(`(["'])${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\1`,'g'),`"${url}"`);}
  html=html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi,(match,attr,quote,value)=>{const asset=assets[resolvePath(path,value)??''];return asset?`${attr}=${quote}${asset}${quote}`:match;});document=isolateAuthoredDocument(html,bridge(token.current,stored,dict.fullListeningHub.examScreen.noteTaking,content.storageKey));}
 const v=selected?.known;
 return <section className="relative w-full" data-authored-listening data-activity-active={activityActive?'true':undefined}>{error&&<p role="alert">{error}</p>}{!document&&!error&&<p>{dict.common.loading}</p>}{document&&<iframe ref={frame} key={path} title={dict.nav.listening} sandbox={AUTHORED_SANDBOX} referrerPolicy="no-referrer" src={`/api/listening/full/${preview?"preview":id}/sandbox${content?.nativePersistence?window.location.hash:""}`} onLoad={()=>frame.current?.contentWindow?.postMessage({channel:"learners-area-sandbox-init",html:document,assets:mediaBlobs.current},"*")} className="h-[calc(100dvh-10rem)] min-h-[600px] w-full rounded-2xl border-0" allow="fullscreen"/>}
 {selected&&<span ref={anchor} className="absolute h-px w-px" style={{left:selected.x,top:selected.y}}/>}
 {selected&&v?.senseId?<div role="dialog" aria-label={selected.word} style={{left:Math.max(8,Math.min((frame.current?.getBoundingClientRect().left??0)+selected.x,window.innerWidth-392)),top:Math.max(8,Math.min((frame.current?.getBoundingClientRect().top??0)+selected.y-250,window.innerHeight-330))}} className="fixed z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-ink-100 bg-paper-raised p-5 shadow-raised"><strong>{v.term}</strong><p>{v.definitionEn}</p><p>{v.translationUz}</p><select className="input my-3" aria-label={dict.vocabulary.folders.title} value={folderId} onChange={e=>setFolderId(e.target.value)}><option value="">{dict.nav.listening}</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button type="button" className="btn-primary" disabled={saving||saved} onClick={async()=>{setSaving(true);try{const r=await fetch('/api/vocabulary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceType:'listening',sourceId:id,sessionSenseId:v.senseId,folderId:folderId||null,items:[{term:v.term}]})});if(!r.ok)throw Error();setSaved(true);}catch{setError(dict.common.error);}finally{setSaving(false);}}}>{saved?dict.videoLesson.saved:'+ Vocabulary'}</button><button type="button" className="btn-ghost" onClick={()=>setSelected(null)}>{dict.vocabulary.add.close}</button></div>:selected&&anchor.current?<WordPopover anchor={anchor.current} dict={dict} word={selected.word} sourceType="listening" sourceId={id} catalogueLookup onClose={()=>setSelected(null)}/>:null}
 </section>;
}
