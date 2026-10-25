/** Shared by Speaking and TED/Podcast. Finish microphone capture before local
 * playback, warm the complete Blob and retain a single player for that clip. */
let captures=0,capturePrevious,playbackPrevious;
const previews=new Set(),session=()=>globalThis.navigator?.audioSession;
function type(value){try{if(session()&&value)session().type=value;}catch{/* Optional browser API. */}}
export function captureAudioSession(){
 if(captures++===0){capturePrevious=previews.size?playbackPrevious:session()?.type;if(session()?.type==='playback')type('auto');}
 let released=false;
 return ()=>{if(released)return;released=true;if(--captures===0){
  type(previews.size&&capturePrevious!=='play-and-record'?'playback':capturePrevious);capturePrevious=undefined;
 }};
}
export function prepareRecordingPlayback(audio){
 audio.preload='auto';audio.muted=false;audio.defaultMuted=false;audio.volume=1;
 audio.playsInline=true;
 if(!previews.has(audio)){if(!previews.size)playbackPrevious=captures?capturePrevious:session()?.type;previews.add(audio);}
 if(!captures&&session()?.type!=='play-and-record')type('playback');
 audio.load();
 return audio;
}
export function releaseRecordingPlayback(audio){
 if(!audio)return;audio.pause();audio.removeAttribute('src');audio.srcObject=null;audio.load();
 previews.delete(audio);
 if(!previews.size&&!captures){if(session()?.type==='playback')type(playbackPrevious);playbackPrevious=undefined;}
}
