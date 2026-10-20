import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {recoverReadingOffset} from "../../src/lib/services/lexical/recover-reading-offset";

const [corpusPath,patchPath,reportPath]=process.argv.slice(2);
if(!corpusPath||!patchPath||!reportPath)throw Error("Usage: audit-context-links.ts CORPUS.json NEW-PATCH.json NEW-REPORT.json");
type Occurrence={id:string;source_type:string;passage_id:string|null;lexeme_id:string|null;start_char:number;end_char:number;surface_form:string;sentence_text:string|null;resolution_status:string};
const corpus=JSON.parse(readFileSync(corpusPath,"utf8")) as {texts:{source:string;id:string;body:string}[];occurrences:Occurrence[]};
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const sources=new Map(corpus.texts.filter(t=>t.source==="reading").map(t=>[t.id,t.body]));
const proposed=new Map<string,{occurrence:Occurrence;start:number;end:number;proof:string}>(),review:{id:string;reason:string}[]=[];
let absolute=0;
for(const o of corpus.occurrences.filter(o=>o.source_type==="reading")){
  const body=sources.get(o.passage_id??"");
  if(body===undefined){review.push({id:o.id,reason:"missing_source"});continue;}
  const recovered=recoverReadingOffset(body,{startChar:o.start_char,endChar:o.end_char,surfaceForm:o.surface_form,sentenceText:o.sentence_text});
  if(recovered?.proof==="already_absolute"){absolute++;continue;}
  if(!recovered||o.resolution_status!=="resolved"||!o.lexeme_id){review.push({id:o.id,reason:"context_not_uniquely_proven"});continue;}
  proposed.set(o.id,{occurrence:o,start:recovered.startChar,end:recovered.endChar,proof:recovered.proof});
}
// Preserve every occurrence identity. Ambiguous target collisions are a review
// queue, never a deletion or a new sense chosen by spelling.
let changed=true;
while(changed){changed=false;const targets=new Map<string,string[]>();for(const o of corpus.occurrences.filter(o=>o.source_type==="reading")){const p=proposed.get(o.id),key=`${o.passage_id}:${p?.start??o.start_char}:${p?.end??o.end_char}`;targets.set(key,[...(targets.get(key)??[]),o.id]);}for(const ids of targets.values())if(ids.length>1)for(const id of ids)if(proposed.delete(id)){review.push({id,reason:"target_collision"});changed=true;}}
const passages=[...sources].flatMap(([id,body])=>{const corrections=[...proposed.values()].filter(p=>p.occurrence.passage_id===id).map(({occurrence:o,start,end})=>({id:o.id,lexemeId:o.lexeme_id!,surface:o.surface_form,sentenceSha:hash(o.sentence_text??""),before:{start:o.start_char,end:o.end_char},after:{start,end}}));return corrections.length?[{id,bodySha:hash(body),corrections}]:[];});
writeFileSync(patchPath,JSON.stringify({version:1,passages},null,2)+"\n",{flag:"wx"});
const bySource=Object.fromEntries(["reading","listening","retention"].map(source=>[source,{occurrences:corpus.occurrences.filter(o=>o.source_type===source).length,resolved:corpus.occurrences.filter(o=>o.source_type===source&&o.resolution_status==="resolved").length,unresolved:corpus.occurrences.filter(o=>o.source_type===source&&o.resolution_status!=="resolved").length}]));
const report={version:1,corpusSha:hash(readFileSync(corpusPath,"utf8")),sourceCounts:Object.fromEntries(["reading","listening","retention"].map(source=>[source,corpus.texts.filter(t=>t.source===source&&t.body.trim()).length])),bySource,reading:{alreadyAbsolute:absolute,recoverable:proposed.size,passages:passages.length,needsReview:review.length},review,semanticHumanReviewClaimed:false,allWordsContextuallyLinked:false,productionApplied:false};
writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({bySource,reading:report.reading}));
