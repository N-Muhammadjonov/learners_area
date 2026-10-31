export function bridge(token, stored, notesLabel, storageKey = 'la_listening_test_1_v2', course, progressive = false) {
    return `(()=>{const token=${JSON.stringify(token)}, initial=${JSON.stringify(stored)}, notesLabel=${JSON.stringify(notesLabel)}, storageKey=${JSON.stringify(storageKey)};
 let ready=${!progressive};const send=(op,rest)=>{if(!ready&&['storage','course'].includes(op))return;parent.postMessage({channel:'learners-area-authored-v1',token,op,...rest},'*');};
 window.laInitialCourseStatus=${JSON.stringify(course ?? null)};window.laCourseWork=(activity,answers)=>send('course',{activity,answers});
 addEventListener('message',e=>{if(e.source===parent&&e.data?.channel==='learners-area-course-progress'&&e.data.token===token)dispatchEvent(new CustomEvent('la-course-status',{detail:e.data.status}));});
 let hydrateStorage;const makeStorage=(seed,persist)=>{const data={...seed};let timer,maxTimer,lastStatus;if(persist)hydrateStorage=values=>{clearTimeout(timer);clearTimeout(maxTimer);for(const key in data)delete data[key];for(const [key,value]of Object.entries(values))if(typeof value==='string')data[key]=value;};const flush=()=>{clearTimeout(timer);clearTimeout(maxTimer);timer=maxTimer=undefined;if(persist)send('storage',{values:{...data}});};const changed=()=>{if(!persist)return;let status;try{status=JSON.parse(data[storageKey]||'{}').attemptStatus;}catch{}if(status!==lastStatus){lastStatus=status;flush();return;}clearTimeout(timer);timer=setTimeout(flush,400);if(!maxTimer)maxTimer=setTimeout(flush,2000);};if(persist)addEventListener('pagehide',flush);return {getItem:k=>Object.hasOwn(data,String(k))?data[String(k)]:null,setItem:(k,v)=>{if(String(v).length>100000)return;data[String(k)]=String(v);changed();},removeItem:k=>{delete data[String(k)];changed();},clear:()=>{for(const k in data)delete data[k];changed();},key:i=>Object.keys(data)[i]??null,get length(){return Object.keys(data).length}}};
 const storage=makeStorage(initial,true);Object.defineProperty(window,'localStorage',{value:storage});Object.defineProperty(window,'sessionStorage',{value:makeStorage({},false)});
 addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!=='learners-area-hydrate'||e.data.token!==token||ready)return;const values=e.data.values;if(!values||typeof values!=='object')return;hydrateStorage(values);window.laHydrateOriginal?.();ready=true;document.getElementById('hub')?.removeAttribute('aria-busy');if(e.data.course)dispatchEvent(new CustomEvent('la-course-status',{detail:e.data.course}));send('hydrated',{});});
 for(const type of ['click','input','change','keydown'])document.addEventListener(type,e=>{if(!ready&&e.target instanceof Element&&e.target.closest('button,input,textarea,select,a')){e.preventDefault();e.stopImmediatePropagation();}},true);
 const images=new Map(),imageUrls=[];const paintImages=()=>{document.querySelectorAll('img[src]').forEach(el=>{const url=images.get(el.getAttribute('src'));if(url)el.setAttribute('src',url);});};
 addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!=='learners-area-image'||e.data.token!==token||e.data.id!=='la-image:0'||!(e.data.blob instanceof Blob)||e.data.blob.size>20*1024*1024)return;const url=URL.createObjectURL(e.data.blob);imageUrls.push(url);images.set(e.data.id,url);paintImages();});
 addEventListener('pagehide',()=>imageUrls.forEach(url=>URL.revokeObjectURL(url)));
 addEventListener('message',e=>{if(e.source===parent&&e.data?.channel==='learners-area-checkpoint'&&e.data.token===token)dispatchEvent(new CustomEvent('la-checkpoint',{detail:e.data.values}));});
 const notes=()=>{const volume=document.querySelector('#examVol,#volume')||Array.from(document.querySelectorAll('input[type="range"]')).find(input=>input.getAttribute('aria-label')?.toLowerCase()==='volume');if(!volume||document.getElementById('la-note-toggle')||document.getElementById('notesBtn'))return;const target=volume.previousElementSibling?.textContent.trim()==='Volume'?volume.previousElementSibling:volume;const button=document.createElement('button');button.id='la-note-toggle';button.type='button';button.textContent=notesLabel;button.style.cssText='background:#4f46e5;color:white;border:0;border-radius:8px;padding:8px 12px';target.before(button);const panel=document.createElement('aside');panel.style.cssText='display:none;position:fixed;right:20px;top:90px;width:min(320px,90vw);padding:16px;background:#171a30;color:white;z-index:9999;border-radius:12px';const label=document.createElement('label');label.textContent=notesLabel;const input=document.createElement('textarea');input.setAttribute('aria-label',notesLabel);input.maxLength=12000;input.value=localStorage.getItem('la-notes')||'';input.style.cssText='display:block;width:100%;min-height:220px;background:#0f1120;color:white';input.oninput=()=>localStorage.setItem('la-notes',input.value);label.append(input);panel.append(label);document.body.append(panel);button.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';button.setAttribute('aria-expanded',String(panel.style.display==='block'));};};
 document.addEventListener('DOMContentLoaded',()=>{notes();new MutationObserver(()=>{notes();paintImages();}).observe(document.body,{childList:true,subtree:true});const hub=document.getElementById('hub');if(hub){if(!ready)hub.setAttribute('aria-busy','true');let previous;const view=()=>{const visible=hub.style.display!=='none'&&!hub.hidden;if(visible!==previous){previous=visible;send('view',{hub:visible});}};view();new MutationObserver(view).observe(hub,{attributes:true,attributeFilter:['style','hidden','class']});if(${progressive})requestAnimationFrame(()=>requestAnimationFrame(()=>send('hub-ready',{})));}});
 document.addEventListener('click',e=>{const el=e.target instanceof Element?e.target:null;if(!el)return;
 const link=el.closest('a[href]');if(link){const href=link.getAttribute('href');if(href&&!href.startsWith('#')){e.preventDefault();e.stopImmediatePropagation();send('navigate',{path:href});return;}}
 },true);
 document.addEventListener('dblclick',e=>{
  if(!ready||e.button!==0||!(e.target instanceof Element))return;
  const transcript=e.target.closest('#activity-script.active #scriptHost .script-transcript');
  if(!transcript||e.target.closest('input,textarea,button,select,a,[contenteditable],.script-gap-wrap,.script-gap-answer'))return;
  const hit=document.elementFromPoint?.(e.clientX,e.clientY);
  if(!hit||!transcript.contains(hit)||hit.closest('input,textarea,button,select,a,[contenteditable],.script-gap-wrap,.script-gap-answer'))return;
  const caret=document.caretRangeFromPoint?.(e.clientX,e.clientY);
  if(!caret||caret.startContainer.nodeType!==3||!transcript.contains(caret.startContainer))return;
  const text=caret.startContainer.textContent||'',at=caret.startOffset;
  let l=at,r=at;while(l>0&&/[a-zA-Z'’-]/.test(text[l-1]))l--;while(r<text.length&&/[a-zA-Z'’-]/.test(text[r]))r++;
  const word=text.slice(l,r);
  if(!/^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(word)||word.length>120)return;
  const actual=document.createRange();actual.setStart(caret.startContainer,l);actual.setEnd(caret.startContainer,r);
  const overWord=[...actual.getClientRects()].some(rect=>e.clientX>=rect.left+0.5&&e.clientX<=rect.right-0.5&&e.clientY>=rect.top&&e.clientY<=rect.bottom);
  if(!overWord)return;
  send('word',{word,mode:'script',x:e.clientX,y:e.clientY,context:transcript.textContent.slice(0,3000)});
 },true);})();
}
export function resolvePath(current, path) {
    try {
        const url = new URL(path, 'https://listening-package.invalid/' + current);
        return url.origin === 'https://listening-package.invalid' ? decodeURIComponent(url.pathname.slice(1)) : null;
    }
    catch {
        return null;
    }
}
