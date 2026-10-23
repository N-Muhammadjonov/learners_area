import {clickableText} from '../vocabulary/clickable-text.js';
/** Original ReadingLessonText + useReadingHighlights. Ranges live in the route state, which the router clears on
 * every navigation, so highlights disappear on reload or leaving, exactly as the source does. */
export function readingLessonText(context,{text,scope}){
 const host=document.createElement('div');host.className='min-w-0 flex-1';
 const store=(context.state.readingHighlights??=new Map());
 const key=JSON.stringify(['body',text]);
 let current=null;
 const rows=()=>store.get(scope)?.get(key)??[];
 function onHighlightRange({start,end}){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||!text.slice(start,end).trim())return;
  const map=store.get(scope)??new Map();store.set(scope,map);const list=map.get(key)??[];
  if(list.length>=200||list.some(row=>row.start===start&&row.end===end))return;
  map.set(key,[...list,{id:crypto.randomUUID(),start,end}]);draw();
 }
 function onRemoveHighlight(id){const map=store.get(scope);if(!map)return;map.set(key,(map.get(key)??[]).filter(row=>row.id!==id));draw();}
 function draw(){
  current?.stop();
  current=clickableText(context,{text,sourceType:'reading',sourceId:scope,lexicalAssistance:false,className:'whitespace-pre-line text-sm leading-relaxed text-ink-700',highlights:rows(),onHighlightRange,onRemoveHighlight});
  host.replaceChildren(current.node);
 }
 draw();
 return host;
}
