"use client";
import {useState} from "react";
import type {Dictionary} from "@/lib/i18n/en";
/** Explicit numeric fields keep the same D/M/Y order in every OS/browser locale. */
export function StudyDateInput({value,onChange,dict}:{value:string;onChange:(value:string)=>void;dict:Dictionary}){
 const initial=value.split('-');const [parts,setParts]=useState({day:initial[2]??'',month:initial[1]??'',year:initial[0]??''});
 const any=Object.values(parts).some(Boolean);
 return <fieldset><legend className="mb-1.5 text-sm font-medium">{dict.onboarding.examDate}</legend><div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">{(['day','month','year'] as const).map(key=><label key={key} className="text-xs">{dict.profile[key]}<input className="input mt-1 w-full" type="number" inputMode="numeric" aria-label={dict.profile[key]} min={key==='year'?1900:1} max={key==='year'?2100:key==='month'?12:31} required={any} placeholder={key==='year'?'YYYY':key==='month'?'MM':'DD'} value={parts[key]} onChange={e=>{const next={...parts,[key]:e.target.value};setParts(next);onChange(next.day&&next.month&&next.year?`${next.year.padStart(4,'0')}-${next.month.padStart(2,'0')}-${next.day.padStart(2,'0')}`:'');}}/></label>)}</div></fieldset>;
}
