import {clickableText} from '../vocabulary/clickable-text.js';

/** Reading highlights are scoped to a passage and text fragment.
 * Colors are persisted with their ranges in route state. Previously stored
 * colorless ranges continue to render with the original blue highlight.
 */
const HIGHLIGHT_COLORS = new Set(['blue','yellow','grey']);
export function readingHighlighted(context,{scope,textKey,text,className='whitespace-pre-line text-sm leading-relaxed text-ink-700',lexicalAssistance=false,occurrences=[],sourceId=scope,verifiedOnly=false,inline=false,offsetBase=0,sourceOffsetExact=false}){
 const host=document.createElement(inline?'span':'div');
 host.className=inline?'':'min-w-0 flex-1';
 host.dataset.highlightHost='';
 const store=(context.state.readingHighlights??=new Map());
 const key=JSON.stringify([textKey,text]);
 let current=null;
 const rows=()=>store.get(scope)?.get(key)??[];
 function onHighlightRange({start,end,color='blue'}){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||!text.slice(start,end).trim()||!HIGHLIGHT_COLORS.has(color))return;
  const map=store.get(scope)??new Map();
  store.set(scope,map);
  const list=map.get(key)??[];
  if(list.length>=200)return;
  const current=list.find(row=>row.start===start&&row.end===end);
  if(current)map.set(key,list.map(row=>row===current?{...row,color}:row));
  else map.set(key,[...list,{id:crypto.randomUUID(),start,end,color}]);
  draw();
 }
 function onRemoveHighlight(id){
  const map=store.get(scope);
  if(!map)return;
  map.set(key,(map.get(key)??[]).filter(row=>row.id!==id));
  draw();
 }
 function draw(){
  current?.stop();
  current=clickableText(context,{text,sourceType:'reading',sourceId,lexicalAssistance,phraseAware:true,
   doubleClickLookup:true,occurrences,verifiedOnly,inline,offsetBase,sourceOffsetExact,
   className,highlights:rows(),onHighlightRange,onRemoveHighlight});
  host.replaceChildren(current.node);
 }
 draw();
 host.stop=()=>current?.stop();
 return host;
}
export function readingLessonText(context,{text,scope}){
 return readingHighlighted(context,{scope,textKey:'body',text});
}
