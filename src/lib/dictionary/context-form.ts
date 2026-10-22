import {entryTerms,normalizeSearch,type Entry} from "./model";
import {formsOf} from "../services/lexical/forms";
import {dictionarySpellingVariants} from "./spelling-variants";
export type ContextFormPart={start:number;end:number};
/** Exact authored discontinuous forms, e.g. picked [it] up. Parts are relative
 * to the source span and validated against a real inflected dictionary form.
 * This only checks spelling/structure; it never selects a contextual sense. */
export function matchesDictionaryContextForm(entry:Entry,surface:string,parts?:ContextFormPart[]){
 let form=surface;
 if(parts){
  if(!entry.display_lemma.includes(" ")||parts.length<2||parts.length>8||parts[0]!.start!==0||parts.at(-1)!.end!==surface.length)return false;
  for(let i=0;i<parts.length;i++){
   const p=parts[i]!;
   if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||p.end>surface.length)return false;
   if(i){const previous=parts[i-1]!;if(previous.end>=p.start)return false;const gap=surface.slice(previous.end,p.start);if(gap.length>80||!/^[\p{L}\p{M}'\u2018\u2019\u02bc\u02bb -]+$/u.test(gap))return false;}
   if(!/^[\p{L}\p{M}'\u2018\u2019\u02bc\u02bb -]+$/u.test(surface.slice(p.start,p.end)))return false;
  }
  form=parts.map(p=>surface.slice(p.start,p.end)).join(" ");
 }
 const forms=new Set([...entryTerms(entry).filter(t=>t.direction==="EN").map(t=>t.term),...formsOf(entry.display_lemma,entry.part_of_speech).map(f=>f.formNorm)]);
 return dictionarySpellingVariants(form).some(candidate=>forms.has(normalizeSearch(candidate)));
}
