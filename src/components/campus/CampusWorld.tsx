"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";

type CampusWindow = Window & { LearnersAreaCampusMount?: (el: HTMLElement) => () => void };
const modules = [
 ["writing","Writing","/app/writing"],
 ["listening","Listening","/app/listening/lessons"],
 ["reading","Reading","/app/reading/lessons"],
 ["video","TED / PODCAST","/app/video-lessons"],
 ["live","Live classes","/app/live-classes"],
 ["speaking","Speaking","/app/speaking"],
 ["grammar","Grammar","/app/grammar/lessons"],
 ["vocabulary","Vocabulary","/app/vocabulary"],
 ["progress","My progress","/app/progress"],
 ["mocks","Mock tests","/app/mocks"],
 ["assignments","Assignments","/app/assignments"],
 ["dashboard","Dashboard","/app/dashboard"],
] as const;

export function CampusWorld() {
  const ref = useRef<HTMLElement>(null);
  const [state,setState] = useState<"loading"|"ready"|"error">("loading");
  useEffect(()=>{
    const el=ref.current;
    if(!el)return;
    let canceled=false;
    let cleanup: undefined | (()=>void);
    let script: HTMLScriptElement | undefined;
    const mount=()=>{
      if(canceled)return;
      const fn=(window as CampusWindow).LearnersAreaCampusMount;
      if(!fn){setState("error");return;}
      try{cleanup=fn(el);setState(el.dataset.campusStatus==="ready"?"ready":"error");}
      catch{setState("error");}
    };
    if((window as CampusWindow).LearnersAreaCampusMount){mount();}
    else{
      script=document.createElement("script");script.type="module";script.src="/campus/campus.js";
      script.addEventListener("load",mount,{once:true});
      script.addEventListener("error",()=>{if(!canceled)setState("error");},{once:true});
      document.head.appendChild(script);
    }
    return ()=>{canceled=true;cleanup?.();if(script)script.remove();};
  },[]);
  return <section ref={ref} data-campus-world aria-label="Learners Area 3D campus" className="la-campus">
    <div className="la-campus-canvas" data-campus-canvas />
    <div className="la-campus-brand">
      <BrandLogo kind="mark" className="h-12 w-14" decorative eager />
      <div><strong>Learners Area</strong><small>Take your learning journey with us</small></div>
    </div>
    <div className="la-campus-caption" aria-live="polite">
      {state==="loading"?"3D xarita yuklanmoqda…":state==="error"?"3D xarita mavjud emas. Modullarni quyidan ochishingiz mumkin.":"Sichqoncha bilan aylantiring · G‘ildirak bilan yaqinlashtiring"}
    </div>
    <button className="la-campus-reset" type="button" data-campus-reset aria-label="Kamerani boshlang‘ich holatga qaytarish" title="Reset camera">↺</button>
    <nav aria-label="Learning buildings" data-campus-fallback className={state==="error"?"la-campus-fallback visible":"la-campus-fallback"}>
      {modules.map(([id,label,href])=><Link href={href} key={id}>{label}</Link>)}
    </nav>
    {modules.map(([id,label,href])=><Link
       key={id} href={href} data-campus-label={id}
       className={"la-campus-label la-campus-label-"+id}
       title={label}
       aria-label={label}
    >{label}</Link>)}
  </section>;
}
