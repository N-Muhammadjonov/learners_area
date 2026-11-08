/** Keep the authored page's real audio element and trusted user click together.
 * The parent supplies authorized Blobs, never storage credentials or URLs.
 * Native play/seek/currentTime/events are deliberately not overridden.
 */
function runtime(token,media,path){
 const assets=new Map(),urls=new Set(),failed=new Set();let dead=false,observer;
 const nativeSet=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
 const nativeLoad=HTMLMediaElement.prototype.load;
 function idOf(value){
  const raw=String(value||'');if(raw.startsWith('la-media:'))return media.some(m=>m.id===raw.slice(9))?raw.slice(9):null;
  try{if(/^[a-z]+:|^\//i.test(raw))return null;return media.find(m=>m.path===new URL(raw,'https://authored.invalid/'+path).pathname.slice(1))?.id??null;}catch{return null;}
 }
 const identity=node=>idOf(node.getAttribute('src'))||node.getAttribute('data-la-native-id');
 const send=(node,event)=>{if(dead)return;parent.postMessage({channel:'learners-area-authored-v1',token,op:'media',action:'native-state',event,
  snapshot:{mediaId:identity(node),currentTime:node.currentTime||0,duration:Number.isFinite(node.duration)?node.duration:0,paused:node.paused,ended:node.ended,readyState:node.readyState,playbackRate:node.playbackRate,volume:node.volume,error:node.error?.code??null}},'*');};
 function startState(){
  const button=document.getElementById('startTestBtn'),node=document.getElementById('sharedAudio');if(!button||!node)return;
  const ready=!!assets.get(identity(node))&&node.readyState>=2&&!node.error;
  button.disabled=!ready&&!failed.has(identity(node));
  if(!button.dataset.laStartLabel)button.dataset.laStartLabel=button.textContent;
  const label=ready?button.dataset.laStartLabel:failed.has(identity(node))?'Retry audio':'Loading audio…';
  if(button.textContent!==label)button.textContent=label;
 }
 function attach(){
  if(dead)return;
  for(const node of document.querySelectorAll('audio,video')){
   const id=identity(node),asset=assets.get(id);if(!id||!asset)continue;
   if(node.getAttribute('src')===asset.url)continue;
   node.setAttribute('data-la-native-id',id);const time=node.currentTime||0;
   nativeSet.set.call(node,asset.url);nativeLoad.call(node);
   if(time>0)node.addEventListener('loadedmetadata',()=>{try{node.currentTime=time;}catch{}},{once:true});
  }
  startState();
 }
 addEventListener('message',event=>{
  const d=event.data;if(dead||event.source!==parent||d?.token!==token)return;
  if(d.channel==='learners-area-native-control'){
   if(d.action==='pause')for(const n of document.querySelectorAll('audio,video'))n.pause();
   return;
  }
  if(d.channel==='learners-area-native-audio-error'&&media.some(m=>m.id===d.id)){failed.add(d.id);startState();return;}
  if(d.channel!=='learners-area-native-audio'||!media.some(m=>m.id===d.id)||!(d.blob instanceof Blob)||d.blob.size<1||d.blob.size>40*1024*1024||!d.blob.type.startsWith('audio/'))return;
  failed.delete(d.id);const previous=assets.get(d.id);if(previous)URL.revokeObjectURL(previous.url);
  const url=URL.createObjectURL(d.blob);urls.add(url);assets.set(d.id,{url});attach();
 });
 // The original source may replace a part's audio src dynamically. Map it to
 // the already-authorized Blob while retaining the browser's native methods.
 Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,get(){return nativeSet.get.call(this);},set(value){
  const id=idOf(value),asset=assets.get(id);if(id)this.setAttribute('data-la-native-id',id);
  nativeSet.set.call(this,asset?.url||value);if(asset)nativeLoad.call(this);
 }});
 for(const type of ['loadedmetadata','canplay','playing','play','pause','ended','timeupdate','seeked','ratechange','volumechange','error'])
  document.addEventListener(type,event=>{const n=event.target;if(n instanceof HTMLMediaElement&&identity(n)&&assets.has(identity(n))){if(type==='error')failed.add(identity(n));startState();send(n,type);}},true);
 document.addEventListener('click',event=>{
  if(event.target.closest?.('#startTestBtn')){const a=document.getElementById('sharedAudio');if(!a||!assets.has(identity(a))||a.readyState<2||a.error){event.preventDefault();event.stopImmediatePropagation();if(a&&failed.has(identity(a))){failed.delete(identity(a));parent.postMessage({channel:'learners-area-authored-v1',token,op:'media',action:'native-retry',mediaId:identity(a)},'*');}startState();}}
 },true);
 document.addEventListener('DOMContentLoaded',()=>{observer=new MutationObserver(attach);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});attach();});
 addEventListener('pagehide',()=>{dead=true;observer?.disconnect();for(const n of document.querySelectorAll('audio,video'))n.pause();for(const url of urls)URL.revokeObjectURL(url);urls.clear();assets.clear();},{once:true});
}
export function nativeAudioBridge(token,media,path='index.html'){return '('+runtime.toString()+')('+JSON.stringify(token)+','+JSON.stringify(media)+','+JSON.stringify(path)+');';}
