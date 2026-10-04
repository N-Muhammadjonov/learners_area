"use client";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
export function MicrophoneTest({ dict }: { dict: Dictionary }) {
 const [status,setStatus]=useState(""),[checking,setChecking]=useState(false),[level,setLevel]=useState(0);
 const mounted=useRef(true),stream=useRef<MediaStream|null>(null),context=useRef<AudioContext|null>(null),frame=useRef<number|null>(null),flight=useRef(false);
 function stop(){if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;void context.current?.close();context.current=null;}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop();};},[]);
 const t=dict.livePartner;
 async function check(){
  if(flight.current)return;if(!navigator.mediaDevices?.getUserMedia){setStatus(t.mic.unsupported);return;}
  flight.current=true;setChecking(true);setStatus("");setLevel(0);
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
   if(!mounted.current){media.getTracks().forEach(track=>track.stop());return;}stream.current=media;
   const healthy=media.getAudioTracks().some(track=>track.readyState==="live");
   const ctx=new AudioContext();context.current=ctx;await ctx.resume();
   const analyser=ctx.createAnalyser();analyser.fftSize=256;ctx.createMediaStreamSource(media).connect(analyser);const data=new Uint8Array(analyser.frequencyBinCount);
   const measure=()=>{if(!mounted.current||!context.current)return;analyser.getByteFrequencyData(data);setLevel(Math.min(100,Math.round(data.reduce((n,v)=>n+v,0)/data.length/128*100)));frame.current=requestAnimationFrame(measure);};measure();
   await new Promise(resolve=>setTimeout(resolve,4000));if(mounted.current)setStatus(healthy?t.mic.ok:t.mic.missing);
  }catch(error){if(mounted.current)setStatus((error as Error).name==="NotAllowedError"?t.mic.denied:t.mic.error);}
  finally{stop();flight.current=false;if(mounted.current){setChecking(false);setLevel(0);}}
 }
 return <div className="flex flex-col gap-2"><button type="button" className="btn-secondary" disabled={checking} onClick={()=>void check()}>{checking?t.mic.checking:t.micTitle}</button>{checking&&<meter className="w-full" min={0} max={100} value={level} aria-label={t.micTitle}/>} {status&&<p role="status" className="max-w-xs text-sm text-ink-500">{status}</p>}</div>;
}
