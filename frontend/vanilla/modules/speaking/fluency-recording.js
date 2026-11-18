import {el} from '../../js/dom.js';
import {createRecordingPreview} from '../shared/recording-preview.js';
import {createStreamRecorder} from './recorder.js';

/** Each uninterrupted microphone session produces its own playable container. */
export function createRoundRecording(dict,makeRecorder=createStreamRecorder){
 const t=dict.speakingStudy;
 const notice=el('p',{role:'status'}),players=el('div',{class:'space-y-2'});
 const node=el('div',{class:'space-y-2'},players,notice);
 let recorder=null,segments=[],previews=[];

 function clear(){
  recorder?.cancel();
  recorder=null;
  segments=[];
  for(const {preview,url} of previews){
   preview.destroy();
   URL.revokeObjectURL(url);
  }
  previews=[];
  notice.textContent='';
 }

 function start(stream){
  try{
   recorder=makeRecorder(stream);
   recorder.start();
  }catch{
   recorder?.cancel();
   recorder=null;
   segments.push(null);
  }
 }

 function stop(){
  if(!recorder)return;
  segments.push(recorder.stop().catch(()=>null));
  recorder=null;
 }

 async function review(){
  const current=segments;
  notice.textContent=t.preparingRecording;
  const clips=await Promise.all(current);
  if(current!==segments)return false;
  for(const clip of clips){
   if(!clip?.size)continue;
   const url=URL.createObjectURL(clip.blob);
   const label=clips.length===1?t.playback:`${t.playback} (${previews.length+1})`;
   const preview=createRecordingPreview({blob:clip.blob,url,dict,label});
   previews.push({preview,url});
   players.append(preview.node);
  }
  notice.textContent=!previews.length?t.noAudio:previews.length<clips.length?dict.fluencyGame.partialRecording:'';
  return previews.length>0;
 }
 return {node,clear,start,stop,review,get active(){return recorder!==null;}};
}
