"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Module = { id: string; name: string; route: string };
type CampusScene = {
  cameraController?: { saveState(): void };
  destroy(): void;
};
type SceneModule = {
  LearnersAreaCampusScene: new (el: HTMLElement, opts: {
    onNavigate: (module: Module) => void;
    motion: "on" | "off" | "auto";
    management: boolean;
    managementName: string;
  }) => CampusScene;
};

const modules = [
  ["dashboard","Dashboard","/app/dashboard"],
  ["reading","Reading","/app/reading/lessons"],
  ["listening","Listening","/app/listening/lessons"],
  ["writing","Writing","/app/writing"],
  ["speaking","Speaking","/app/speaking"],
  ["grammar","Grammar","/app/grammar/lessons"],
  ["vocabulary","Vocabulary","/app/vocabulary"],
  ["progress","My progress","/app/progress"],
  ["mocks","Mock tests","/app/mocks"],
  ["assignments","Assignments","/app/assignments"],
  ["live_classes","Live classes","/app/live-classes"],
  ["video_lessons","TED / PODCAST","/app/video-lessons"]
] as const;

/** Only the exterior map is new. All existing Learners Area modules,
 * search, theme, locale, notifications and ShellUtilities stay intact. */
export function CampusWorld({ showManagement = false, managementLabel = "Management" }: {
  showManagement?: boolean;
  managementLabel?: string;
}) {
  const mountRef=useRef<HTMLDivElement>(null);
  const sceneRef=useRef<CampusScene|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");

  useEffect(()=>{
    const element=mountRef.current;
    if(!element)return;
    let cancelled=false;
    const jsUrl="/campus/v2/src/campus-scene.js";
    (async()=>{
      try {
        // Native ESM loads self-hosted vendor copies without depending on esm.sh.
        const mod=(await import(/* webpackIgnore: true */ jsUrl)) as SceneModule;
        if(cancelled)return;
        const scene=new mod.LearnersAreaCampusScene(element,{
          motion: "on",
          management: showManagement,
          managementName: managementLabel,
          onNavigate(module){
            if(!module.route.startsWith("/app/"))return;
            sceneRef.current?.cameraController?.saveState();
            window.location.assign(module.route);
          }
        });
        if(cancelled){scene.destroy();return;}
        sceneRef.current=scene;
        setState("ready");
      } catch(error) {
        if(!cancelled){console.error("Learners Area campus error:",error);setState("error");}
      }
    })();
    return ()=>{
      cancelled=true;
      sceneRef.current?.destroy();
      sceneRef.current=null;
    };
  },[showManagement, managementLabel]);

  return (
    <section data-campus-world className="la-campus" aria-label="Learners Area 3D campus">
      <div data-campus-canvas ref={mountRef} className="la-campus-canvas" />
      <div className="la-campus-caption" role="status">
        {state==="loading"?"3D xarita yuklanmoqda…":
         state==="error"?"WebGL mavjud emas. Modullarni quyidagi havolalardan oching.":
         "Touchpad: chap/o‘ng — aylantirish, yuqori/past — zoom"}
      </div>
      {state==="error" && (
        <nav aria-label="Learning modules" className="la-campus-fallback">
          {modules.map(([id,name,route])=><Link key={id} href={route}>{name}</Link>)}
          {showManagement && <Link href="/app/management">{managementLabel}</Link>}
        </nav>
      )}
    </section>
  );
}
