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
  </div>;
}

/** Optional text-block adapter for the existing lesson renderer, not a new lesson engine. */
export function ReadingLessonText({scope, text, dict}:{scope:string;text:string;dict:Parameters<typeof ClickableText>[0]['dict']}) {
  const highlights = useReadingHighlights(scope);
  return <ReadingHighlightedText {...highlights('body',text)} dict={dict} text={text}
    sourceType="reading" sourceId={scope} lexicalAssistance={false} className="whitespace-pre-line text-sm leading-relaxed text-ink-700" />;
}
