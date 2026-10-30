/** Inert IDs only. The trusted parent retains media URLs and authorization. */
export function authoredMediaBridge(token, media) {
    return `(()=>{const token=${JSON.stringify(token)},media=${JSON.stringify(media)},pending=new Map();let request=0,active=media[0]?.id||'',state={currentTime:0,duration:media[0]?.duration||0,paused:true,ended:false,readyState:0,playbackRate:1,volume:1,error:null};
 const send=(action,value,requestId)=>parent.postMessage({channel:'learners-area-authored-v1',token,op:'media',action,mediaId:active,value,requestId},'*');
 const element=()=>document.getElementById('sharedAudio');const ours=el=>el.id==='sharedAudio';
 for(const key of ['currentTime','duration','paused','ended','readyState','playbackRate','volume','error']){const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,key);Object.defineProperty(HTMLMediaElement.prototype,key,{configurable:true,get(){return ours(this)?state[key]:descriptor?.get?.call(this)},set:descriptor?.set?function(value){if(!ours(this)){descriptor.set.call(this,value);return;}if(!Number.isFinite(Number(value)))return;state[key]=Number(value);send(({currentTime:'seek',playbackRate:'rate',volume:'volume'})[key],Number(value));}:undefined});}
 const nativePlay=HTMLMediaElement.prototype.play,nativePause=HTMLMediaElement.prototype.pause,nativeLoad=HTMLMediaElement.prototype.load;
 HTMLMediaElement.prototype.play=function(){if(!ours(this))return nativePlay.call(this);return new Promise((resolve,reject)=>{const id=++request;pending.set(id,{resolve,reject});send('play',undefined,id);});};
 HTMLMediaElement.prototype.pause=function(){if(!ours(this))return nativePause.call(this);state.paused=true;send('pause');};
 HTMLMediaElement.prototype.load=function(){if(!ours(this))return nativeLoad.call(this);state.ended=false;state.readyState=0;send('load');};
 const nativeSet=Element.prototype.setAttribute;
 Element.prototype.setAttribute=function(key,value){if(ours(this)&&String(key).toLowerCase()==='src'){const id=String(value).replace(/^la-media:/,'');if(media.some(m=>m.id===id)){active=id;state={...state,currentTime:0,duration:media.find(m=>m.id===id).duration||0,paused:true,ended:false,readyState:0};send('load');}}return nativeSet.call(this,key,value);};
 addEventListener('message',e=>{if(e.source!==parent||e.data?.token!==token||e.data.channel!=='learners-area-media-state')return;const data=e.data;if(data.snapshot?.mediaId===active){state={...state,...data.snapshot};if(data.event&&data.event!=='state')element()?.dispatchEvent(new Event(data.event));}const operation=pending.get(data.requestId);if(operation){pending.delete(data.requestId);if(data.ok)operation.resolve();else operation.reject(new DOMException('Audio could not start',data.error||'NotSupportedError'));}});
 addEventListener('pagehide',()=>{for(const operation of pending.values())operation.reject(new DOMException('Page closed','AbortError'));pending.clear();});
 })();`;
}
