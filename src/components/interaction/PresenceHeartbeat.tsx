"use client";
import { useEffect } from "react";
/** Visible, recently used tabs only. No URLs, keyboard contents or client durations are sent. */
export function PresenceHeartbeat({userId}:{userId:string}) {
  useEffect(()=>{
    let lastInput=Date.now(),pending=false,stopped=false;
    const beat=async()=>{
      if(stopped||pending||document.visibilityState!=="visible"||Date.now()-lastInput>300_000 && !Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).some(media=>!media.paused&&!media.ended))return;
      pending=true;
      try{await fetch("/api/presence",{method:"POST",credentials:"same-origin",cache:"no-store"});}catch{/* offline time is never credited */}finally{pending=false;}
    };
    const active=()=>{lastInput=Date.now();};
    const visible=()=>{if(document.visibilityState==="visible"){active();void beat();}};
    const events=["pointerdown","keydown","scroll"] as const;
    for(const name of events)window.addEventListener(name,active,{passive:true});
    document.addEventListener("visibilitychange",visible);
    void beat();const timer=setInterval(()=>void beat(),30_000);
    return()=>{stopped=true;clearInterval(timer);for(const name of events)window.removeEventListener(name,active);document.removeEventListener("visibilitychange",visible);};
  },[userId]);
  return null;
}
