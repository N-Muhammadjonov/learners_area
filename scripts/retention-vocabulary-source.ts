import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sentenceAt } from "../src/lib/services/lexical/listening-occurrences";
import type { AuthoredVocabulary } from "../src/lib/services/lexical/reading-occurrences";

export const bodyHash=(body:string)=>createHash("sha256").update(body).digest("hex");
export function readRetentionVocabulary() {
  const sources=["A2","B1","B2","C1","C2"].flatMap(level=>readFileSync(`content/retention-v4/${level}.jsonl`,"utf8").trim().split("\n").map(line=>JSON.parse(line) as {sourceId:string;level:string;bodyText:string}));
  const entries=new Map<string,AuthoredVocabulary[]>();
  for (const line of readFileSync("content/retention-vocabulary/entries.tsv","utf8").split("\n")) {
    if(!line.trim()||line.startsWith("#"))continue;
    const fields=line.split("|");if(fields.length!==5)throw Error("Invalid Retention vocabulary fields");
    const [id,word,pos,def,uz]=fields as [string,string,string,string,string];
    const source=sources.find(row=>row.sourceId===id),at=source?.bodyText.indexOf(word)??-1;
    if(!source||at<0||!word.trim()||!pos.trim()||!def.trim()||!uz.trim()||word.length>120)throw Error(`Invalid vocabulary surface: ${id} ${word}`);
    const list=entries.get(id)??[];
    if(list.some(row=>row.word===word))throw Error(`Repeated Retention vocabulary: ${id} ${word}`);
    list.push({word,pos,def,uz,ex:sentenceAt(source.bodyText,at,at+word.length),surfaces:[word]});entries.set(id,list);
  }
  if(sources.length!==75||entries.size!==75||sources.some(source=>entries.get(source.sourceId)?.length!==5))throw Error("Retention vocabulary coverage must be five units in each of 75 original texts");
  return sources.map(source=>({...source,bodySha256:bodyHash(source.bodyText),vocabulary:entries.get(source.sourceId)!}));
}
