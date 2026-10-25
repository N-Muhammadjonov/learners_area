import {el,listen} from '../../js/dom.js';
/** Actual browser getUserMedia/AudioContext behavior; no permission before click. */
export function microphoneTest({dict,signal}){
 const t=dict.livePartner,host=el('div',{class:'flex flex-col gap-2'}),button=el('button',{type:'button',class:'btn-secondary'},t.micTitle),status=el('p',{role:'status',class:'max-w-xs text-sm text-ink-500'});host.append(button);let stream,context,frame,timer,resolveDelay,busy=false;
 function stop(){cancelAnimationFrame(frame);clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;if(context){void context.close();context=null;}resolveDelay?.();resolveDelay=null;}
 listen(button,'click',async()=>{if(busy)return;if(!navigator.mediaDevices?.getUserMedia){status.textContent=t.mic.unsupported;host.append(status);return;}busy=true;button.disabled=true;button.textContent=t.mic.checking;status.remove();const meter=el('meter',{class:'w-full',min:0,max:100,value:0,'aria-label':t.micTitle});host.append(meter);
 try{const media=await navigator.mediaDevices.getUserMedia({audio:true,video:false});if(signal.aborted){media.getTracks().forEach(t=>t.stop());return;}stream=media;const healthy=media.getAudioTracks().some(t=>t.readyState==='live');context=new AudioContext();await context.resume();if(signal.aborted)return;const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(media).connect(analyser);const data=new Uint8Array(analyser.frequencyBinCount);
 const measure=()=>{if(signal.aborted||!context)return;analyser.getByteFrequencyData(data);meter.value=Math.min(100,Math.round(data.reduce((n,v)=>n+v,0)/data.length/128*100));frame=requestAnimationFrame(measure);};measure();await new Promise(resolve=>{resolveDelay=resolve;timer=setTimeout(resolve,4000);});if(!signal.aborted)status.textContent=healthy?t.mic.ok:t.mic.missing;
 }catch(error){if(!signal.aborted)status.textContent=error.name==='NotAllowedError'?t.mic.denied:t.mic.error;}finally{stop();busy=false;meter.remove();button.disabled=false;button.textContent=t.micTitle;if(!signal.aborted)host.append(status);}
 },signal);signal.addEventListener('abort',stop,{once:true});return host;
}
