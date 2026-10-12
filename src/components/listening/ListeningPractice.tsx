"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import type { Dictionary } from "@/lib/i18n/en";
import type { PracticeKind } from "@/lib/listening/activities";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { ListeningMap } from "./ListeningMap";
import type { MapDiagram } from "@/lib/listening/map-diagram";
type Question = { number:number; text:string; instruction:string; options:string[]; at:number; end?:number };
export function ListeningPractice({ id,title,kind,questions,audioUrl,initial,dict,mapDiagram }: { id:string;title:string;kind:PracticeKind;questions:Question[];audioUrl:string|null;initial:Record<string,string>;dict:Dictionary;mapDiagram?:MapDiagram }) {
 const t=dict.fullListeningHub.research, a=dict.fullListeningHub.activity;
 const [index,setIndex]=useState(0),[answers,setAnswers]=useState(initial),[prediction,setPrediction]=useState(""),[result,setResult]=useState<{number:number;correct:boolean;key:string;evidence:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const player=useRef<HTMLAudioElement>(null),clipEnd=useRef<number|null>(null),request=useScopedResponse(12000),flight=useRef(false);
 useEffect(()=>()=>{ player.current?.pause(); },[]);
 const q=questions[index];
 async function check(complete=false) {
  if(flight.current||!q) return; flight.current=true;setBusy(true);setError("");
  try { const response=await request(`/api/listening/full/${id}/practice`,{method:"POST",body:JSON.stringify({kind,answers:complete?Object.fromEntries(questions.map(row=>[row.number,answers[row.number]??""])):Object.fromEntries(questions.filter(row=>answers[row.number]?.trim()).map(row=>[row.number,answers[row.number]!])),complete})}); if(!response) return; if(!response.ok)throw Error(); const data=await response.json();setResult(old=>[...old.filter(row=>!data.results.some((r:{number:number})=>r.number===row.number)),...data.results]); }
  catch {setError(dict.common.error);}finally {flight.current=false;setBusy(false);}
 }
 const feedback=result.find(row=>row.number===q?.number);
 return <div className="listening-workspace mx-auto max-w-5xl space-y-5"><Link className="btn-secondary inline-flex" href={`/app/listening/tests/${id}`}>{dict.fullListeningHub.examStart.back}</Link><h1 className="font-display text-3xl">{title} · {t[kind]}</h1>
 {audioUrl&&<audio controls ref={player} src={audioUrl} preload="metadata" className="w-full" onTimeUpdate={()=>{if(clipEnd.current!==null&&player.current&&player.current.currentTime>=clipEnd.current){player.current.pause();clipEnd.current=null;}}}/>}
 {kind==="map"&&mapDiagram&&<div className="card p-5" data-listening-map-practice><ListeningMap diagram={mapDiagram}/></div>}
 {!q?<p className="card p-5">{t.weakEmpty}</p>:<section className="card space-y-4 p-5"><p className="text-sm">{index+1} / {questions.length} · Q{q.number}</p><h2 className="text-xl"><ClickableText dict={dict} text={q.text} sourceType="listening" sourceId={id} lexicalAssistance catalogueLookup /></h2><p>{q.instruction}</p>
 {kind==="completion"&&<label className="block">{t.prediction}<input className="input mt-2" value={prediction} onChange={e=>setPrediction(e.target.value)} maxLength={300}/></label>}
 <button className="btn-secondary" type="button" onClick={()=>{if(player.current){player.current.currentTime=q.at;clipEnd.current=q.end??q.at+25;void player.current.play().catch(()=>setError(a.momentUnavailable));}}}>{a.playEvidence}</button>
 <label className="block">{kind==="map"?t.yourLocation:a.yourMatches}{q.options.length?<select className="input mt-2" value={answers[q.number]??""} onChange={e=>setAnswers(old=>({...old,[q.number]:e.target.value}))}><option value="">{a.choose}</option>{q.options.map((option,i)=><option key={i} value={/^([A-Z])[).\s]/.exec(option)?.[1]??option}>{option}</option>)}</select>:<input className="input mt-2" maxLength={500} value={answers[q.number]??""} onChange={e=>setAnswers(old=>({...old,[q.number]:e.target.value}))}/>}</label>
 <button className="btn-primary" type="button" disabled={busy||!answers[q.number]?.trim()} onClick={()=>void check()}>{a.checkAll}</button>
 {feedback&&<div role="status" className="rounded-xl border border-ink-100 p-4"><strong>{feedback.correct?a.correct:a.incorrect} · {feedback.key}</strong><p className="whitespace-pre-line">{feedback.evidence}</p></div>}
 <div className="flex flex-wrap justify-between gap-2"><button className="btn-secondary" type="button" disabled={!index||busy} onClick={()=>{setIndex(i=>i-1);setPrediction("");}}>{t.previous}</button><button className="btn-secondary" type="button" disabled={index===questions.length-1||busy} onClick={()=>{setIndex(i=>i+1);setPrediction("");}}>{t.next}</button></div>
 <button className="btn-primary" type="button" disabled={busy||questions.some(row=>!answers[row.number]?.trim())} onClick={()=>void check(true)}>{t.finish}</button></section>}
 {error&&<p role="alert">{error}</p>}</div>;
}
