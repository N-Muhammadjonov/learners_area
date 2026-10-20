"use client";
import {useEffect,useRef} from "react";
import {createPortal} from "react-dom";
import type {Dictionary} from "@/lib/i18n/en";
import {ClickableText} from "@/components/vocabulary/ClickableText";
export function VideoTranscriptDialog({id,text,dict,onClose}:{id:string;text:string;dict:Dictionary;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 return createPortal(<dialog ref={ref} className="video-transcript-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-labelledby="video-transcript-heading"><header className="flex items-center justify-between gap-4"><h2 id="video-transcript-heading" className="text-xl font-semibold">{dict.videoLesson.tabs.transcript}</h2><button type="button" className="btn-secondary" onClick={onClose}>{dict.globalDictionary.close}</button></header><ClickableText dict={dict} text={text} sourceType="video" sourceId={id} className="mt-5 text-base leading-8" catalogueLookup phraseAware/></dialog>,document.body);
}
