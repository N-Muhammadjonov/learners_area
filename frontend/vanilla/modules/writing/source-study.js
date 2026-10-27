import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {anySignal} from '../../js/signals.js';
import {stealingCopy} from './stealing-copy.js';
/** Exact UTF-16 offsets over the original essay. No HTML, shared notes or global chunks. */
export function sourceStudy(ctx,{sessionId,sourceId,body}){
 const t=stealingCopy(ctx),own=new window.AbortController(),signal=anySignal([ctx.signal,own.signal]);
 const uid=ctx.session?.user?.id,key=uid?`la-writing-study:${uid}:${sourceId}`:null;
 const host=el('section',{'data-stealing-model-study':'',class:'card p-5'}),status=el('span',{role:'status',class:'text-sm','data-study-status':''}),text=el('div',{'data-stealing-model-body':'',class:'stealing-essay-text',tabindex:0});
 const area=el('textarea',{class:'input',maxlength:20000,'aria-label':t.notes,'data-study-notes':''}),notes=el('aside',{class:'stealing-notes',hidden:true},el('label',{},t.notes,area),el('p',{class:'text-sm text-ink-500'},t.notesHint));
 let ready=false,open=false,dirty=false,busy=false,version=0,revision=0,digest='',highlights=[],selected=null,timer=null,server=null;
 const button=(label,action,attrs={})=>{const b=el('button',{type:'button',class:'btn-secondary',...attrs},label);listen(b,'click',action,signal);return b;};
 const toggle=button(t.notes,()=>{open=!open;host.dataset.notesOpen=String(open);notes.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)area.focus();},{'aria-expanded':'false','data-study-notes-toggle':''});
 const retry=button(t.retry,()=>void (ready?save():load()),{hidden:true,'data-study-retry':''});
 const conflicts=el('div',{class:'flex flex-wrap gap-2',hidden:true},el('p',{},t.conflict),button(t.useServer,()=>{if(server){accept(server);erasePending();dirty=false;conflicts.hidden=true;status.textContent=t.saved;}}),button(t.keepMine,()=>{if(server){revision=server.revision;conflicts.hidden=true;dirty=true;persist();void save();}}));
 const colors=['yellow','blue','orange'].map(color=>{const b=button(t[color],()=>{if(!ready||!selected)return;const {start,end}=selected;highlights=highlights.filter(h=>h.end<=start||h.start>=end);highlights.push({id:crypto.randomUUID(),start,end,color});highlights.sort((a,b)=>a.start-b.start);selected=null;drawText();changed();},{disabled:true,'data-study-color':color});listen(b,'pointerdown',e=>e.preventDefault(),signal);return b;});
 const toolbar=el('div',{class:'stealing-study-toolbar'},toggle,...colors,status,retry);
 host.append(toolbar,el('p',{class:'text-sm text-ink-500'},t.highlightHint),el('div',{class:'stealing-study-layout'},text,notes),conflicts);text.textContent=body;area.disabled=true;
 function erasePending(){if(key)try{localStorage.removeItem(key);}catch{}}
 function snapshot(){return {notes:area.value,highlights:highlights.map(h=>({...h})),sourceHash:digest,revision};}
 function persist(){if(key)try{localStorage.setItem(key,JSON.stringify(snapshot()));}catch{}}
 function drawText(){text.replaceChildren();let cursor=0;for(const h of highlights){text.append(document.createTextNode(body.slice(cursor,h.start)));const mark=el('mark',{'data-highlight-id':h.id,'data-color':h.color,title:t.highlightHint},body.slice(h.start,h.end));listen(mark,'click',()=>{if(!ready)return;highlights=highlights.filter(x=>x.id!==h.id);selected=null;drawText();changed();},signal);text.append(mark);cursor=h.end;}text.append(document.createTextNode(body.slice(cursor)));colors.forEach(b=>b.disabled=true);}
 function accept(data){revision=data.revision;digest=data.sourceHash;highlights=data.highlights;area.value=data.notes;drawText();}
 function changed(){version++;dirty=true;persist();status.textContent=t.pending;clearTimeout(timer);timer=setTimeout(()=>void save(),600);}
 async function save(){if(!ready||!dirty||busy||signal.aborted)return;busy=true;retry.hidden=true;status.textContent=t.saving;const sent=version,b=snapshot();try{const data=await api.request(`/api/writing/stealing/sessions/${sessionId}/study`,{method:'PUT',body:b,signal});if(signal.aborted)return;if(data.ok!==true||!Number.isSafeInteger(data.revision))throw Error('invalid_study');revision=data.revision;if(version===sent){dirty=false;erasePending();status.textContent=t.saved;}else{persist();status.textContent=t.pending;}}catch(e){if(signal.aborted)return;status.textContent=t.failed;retry.hidden=false;if(e.status===409){try{server=await api.request(`/api/writing/stealing/sessions/${sessionId}/study`,{signal});conflicts.hidden=false;}catch{}}}finally{busy=false;if(dirty&&version!==sent&&!signal.aborted)void save();}}
 function capture(){const s=window.getSelection();if(!ready||!s?.rangeCount||s.isCollapsed){selected=null;colors.forEach(b=>b.disabled=true);return;}const range=s.getRangeAt(0);if(!text.contains(range.startContainer)||!text.contains(range.endContainer))return;const prefix=document.createRange();prefix.selectNodeContents(text);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length,end=start+range.toString().length;if(end>start&&end<=body.length){selected={start,end};colors.forEach(b=>b.disabled=false);}}
 listen(text,'mouseup',capture,signal);listen(text,'keyup',capture,signal);listen(area,'input',changed,signal);
 async function load(){try{const data=await api.request(`/api/writing/stealing/sessions/${sessionId}/study`,{signal});if(signal.aborted)return;if(typeof data.notes!=='string'||!Array.isArray(data.highlights)||!Number.isSafeInteger(data.revision)||typeof data.sourceHash!=='string')throw Error('invalid_study');accept(data);ready=true;area.disabled=false;status.textContent=t.saved;
  let local;try{local=key?JSON.parse(localStorage.getItem(key)||'null'):null;}catch{}
  if(local?.sourceHash===digest&&typeof local.notes==='string'&&Array.isArray(local.highlights)){if(local.notes===data.notes&&JSON.stringify(local.highlights)===JSON.stringify(data.highlights))erasePending();else{area.value=local.notes;highlights=local.highlights.filter(h=>Number.isSafeInteger(h.start)&&Number.isSafeInteger(h.end)&&h.start>=0&&h.end<=body.length&&h.end>h.start&&['yellow','blue','orange'].includes(h.color));drawText();dirty=true;version++;if(local.revision===revision)void save();else{server=data;conflicts.hidden=false;status.textContent=t.conflict;}}}
 }catch{if(!signal.aborted){status.textContent=t.failed;retry.hidden=false;}}}
 const stop=()=>{clearTimeout(timer);if(dirty)persist();own.abort();ctx.signal.removeEventListener('abort',stop);};ctx.signal.addEventListener('abort',stop,{once:true});void load();return {node:host,stop};
}
