"use client";
import { useState } from "react";
import { ClickableText, type TextHighlight } from "@/components/vocabulary/ClickableText";

/** Reading has no existing persisted annotation contract. Ranges live only in this
 * mounted owner/attempt, survive passage tabs, and disappear on reload or leaving.
 * The renderer and offset calculation are the existing shared ClickableText layer. */
export function useReadingHighlights(scope: string) {
  const [state, setState] = useState<{scope:string; texts:Record<string,TextHighlight[]>}>({scope,texts:{}});
  return (textKey:string, text:string) => {
    const key=JSON.stringify([textKey,text]);
    const highlights=state.scope===scope ? state.texts[key] ?? [] : [];
    return {
      highlights,
      onHighlightRange: ({start,end}:{start:number;end:number}) => {
        if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||!text.slice(start,end).trim()) return;
        setState(previous=>{
          const texts=previous.scope===scope ? previous.texts : {};
          const rows=texts[key]??[];
          if(rows.length>=200 || rows.some(row=>row.start===start && row.end===end)) return previous;
          return {scope,texts:{...texts,[key]:[...rows,{id:crypto.randomUUID(),start,end}]}};
        });
      },
      onRemoveHighlight:(id:string)=>setState(previous=> previous.scope===scope ? {...previous,texts:{...previous.texts,[key]:(previous.texts[key]??[]).filter(row=>row.id!==id)}} : previous),
    };
  };
}
export function ReadingHighlightedText(props:Parameters<typeof ClickableText>[0]) {
  return <div className="min-w-0 flex-1">
    <ClickableText {...props}/>
    {!!props.highlights?.length && <ul className="mt-2 flex flex-wrap gap-2" aria-label={props.dict.listening.general.clearHighlight}>
      {props.highlights.map((row,index)=><li key={row.id}><button type="button" className="link-inline text-xs" data-reading-remove-highlight={row.id}
        onClick={()=>props.onRemoveHighlight?.(row.id)}>{props.dict.listening.general.clearHighlight} {index+1}</button></li>)}
    </ul>}
  </div>;
}
