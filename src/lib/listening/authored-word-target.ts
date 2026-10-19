import type { OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { phraseTarget } from "@/lib/services/lexical/phrase-target";
import { formsOf } from "@/lib/services/lexical/forms";
import type { VocabularySessionItem } from "@/lib/services/lexical/listening-occurrences";

/** Exact authored phrase spans outrank a member word. The parent still requires
 * the authored example to be present before accepting its canonical sense. */
export function authoredWordTarget(word: string, context: unknown, start: unknown, end: unknown, vocabulary: VocabularySessionItem[]): {word: string; occurrence?: OccurrenceSpan; knownIndex?: number} {
  if(typeof context!=="string"||typeof start!=="number"||typeof end!=="number"||context.slice(start,end)!==word) return {word};
  const rows=vocabulary.flatMap((entry,index)=>{
    const forms=new Set([entry.term,...formsOf(entry.term,entry.partOfSpeech).map(row=>row.form)]);
    return [...forms].flatMap(form=>{
      const pattern=new RegExp(`(?<![A-Za-z])${form.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![A-Za-z])`,"gi");
      return [...context.matchAll(pattern)].map(match=>({id:String(index),surfaceForm:match[0],startChar:match.index!,endChar:match.index!+match[0].length}));
    });
  });
  const target=phraseTarget(context,{start,end,clean:word},rows);
  const index=target.occurrence ? Number(target.occurrence.id) : undefined;
  const entry=index===undefined?undefined:vocabulary[index];
  let knownIndex: number|undefined;
  if(entry?.example && target.occurrence){
    for(let at=context.indexOf(entry.example);at>=0;at=context.indexOf(entry.example,at+entry.example.length)){
      if(target.occurrence.startChar>=at && target.occurrence.endChar<=at+entry.example.length){knownIndex=index;break;}
    }
  }
  return {...target,knownIndex};
}
