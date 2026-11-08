import {listeningAudio} from '../audio-preload.js';

/** Parent authorization/download ownership; actual playback stays in the frame. */
export class NativeFrameMedia {
 constructor(items,emit,options={}){
  this.items=items;this.emit=emit;this.options=options;this.abort=new AbortController();this.held=new Set();this.loading=new Map();this.disposed=false;this.intendedPlaying=false;
  this.state={mediaId:items[0]?.id||'',currentTime:0,duration:0,paused:true,ended:false,readyState:0,playbackRate:1,volume:1,error:null};
 }
 snapshot(){return {...this.state};}
 load(item){if(this.loading.has(item.id))return this.loading.get(item.id);const work=this._load(item).finally(()=>this.loading.delete(item.id));this.loading.set(item.id,work);return work;}
 async _load(item){
  const signal=this.abort.signal,fetcher=this.options.fetch??globalThis.fetch.bind(globalThis);
  try{
   // Check the current user/test/sequence again before releasing retained bytes.
   if(!this.held.has(item.url)){const url=await listeningAudio.acquire(item.url,signal,this.options.testId);if(!url||signal.aborted||this.disposed)throw Error('Audio unavailable');this.held.add(item.url);}
   const response=await fetcher(item.url+(item.url.includes('?')?'&':'?')+'capability=1',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
   if(!response.ok)throw Error('Audio access unavailable');
   const grant=await response.json();if(!Number.isFinite(grant.expiresAt)||grant.expiresAt<=Date.now())throw Error('Expired audio access');
   if(signal.aborted||this.disposed)return;
   const blob=listeningAudio.blob(item.url);if(!blob)throw Error('Missing audio');
   this.options.send?.('learners-area-native-audio',{id:item.id,blob});
  }catch(error){if(this.held.delete(item.url))listeningAudio.release(item.url);if(!signal.aborted&&!this.disposed){this.options.onError?.(error);this.options.send?.('learners-area-native-audio-error',{id:item.id});}}
 }
 prepare(){for(const item of this.items)void this.load(item);}
 command(command){
  if(this.disposed)return;
  if(command.action==='native-retry'){const item=this.items.find(i=>i.id===command.mediaId);if(item)void this.load(item);return;}
  if(command.action==='native-state'&&this.items.some(i=>i.id===command.snapshot?.mediaId)){
   this.state={...this.state,...command.snapshot};this.intendedPlaying=!this.state.paused;
   this.emit({event:command.event,snapshot:this.snapshot()});return;
  }
  if(command.action==='pause'){this.intendedPlaying=false;this.state.paused=true;this.options.send?.('learners-area-native-control',{action:'pause'});}
 }
 dispose(){if(this.disposed)return;this.command({action:'pause'});this.disposed=true;this.abort.abort();for(const resource of this.held)listeningAudio.release(resource);this.held.clear();}
}
