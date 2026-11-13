import {el,listen} from '../../js/dom.js';
import {tokenise,splitByHighlights,offsetWithin} from '../../js/generated/lexical-text-helpers.js';
import {phraseTarget} from '../../js/generated/reading-lib/phrase-target.js';
import {wordPopover} from './word-popover.js';
import {contextualWordPopover} from './contextual-popover.js';
/** Native source-selectable text. No lexical requests without the server-projected permission.
 *
 * Reading surfaces opt in to two original ClickableText behaviours (src/components/vocabulary/ClickableText.tsx):
 *  - `phraseAware`: the longest authored, exact occurrence that covers the word decides the lookup target
 *    (src/lib/services/lexical/phrase-target.ts). Ambiguous or absent matches stay unresolved.
 *  - `doubleClickLookup`: a lookup opens on double-click, a 3-second press, or keyboard; a single click only selects.
 * Listening passes neither option, so its behaviour is unchanged. */
/** Reading and Retention places follow the current original contextual rules (see ./contextual-popover.js). */
const CONTEXTUAL_SOURCES=new Set(['reading','retention','listening']);
const BASIC_WORDS=new Set(['i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','a','an','the','am','is','are','was','were','be','been','being','do','does','did','to','of','in','on','at','and','or','but','if','as','by','for','with']);
export function clickableText(context,{text,sourceType='listening',sourceId,inline=false,className='',occurrences=[],catalogueLookup=false,lexicalAssistance=true,phraseAware=false,doubleClickLookup=false,highlights=[],onHighlightRange,onRemoveHighlight}){
 const {dict}=context,own=new (document.defaultView?.AbortController??AbortController)(),signal=own.signal,tag=inline?'span':'div';
 const abort=()=>own.abort();context.signal.addEventListener('abort',abort,{once:true});signal.addEventListener('abort',()=>context.signal.removeEventListener('abort',abort),{once:true});if(context.signal.aborted)own.abort();
 const host=el(tag,{class:className});if(!lexicalAssistance&&!onHighlightRange&&!highlights.length){host.className=`whitespace-pre-line ${className}`;host.setAttribute('data-plain-text','');host.textContent=text;return {node:host,stop:()=>own.abort()};}
 const tokens=tokenise(text),words=tokens.flatMap((t,i)=>t.isWord?[i]:[]),hintId='lookup-'+crypto.randomUUID(),cursorId='cursor-'+crypto.randomUUID();
 let active=null,cursor=null,popup,gesture=null,pending=null,hold=null,selection,control;
 // Word spans by token index: a lookup or cursor move touches two nodes, never the whole passage.
 const wordNodes=new Map();let lit=new Set();
 const hint=el('span',{id:hintId,class:'sr-only'},doubleClickLookup?dict.vocabulary.textLookupDoubleHint:dict.vocabulary.textLookupHint),status=el('span',{id:cursorId,role:'status',class:'sr-only'}),region=el(tag,{class:'relative whitespace-pre-line outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-600',...(lexicalAssistance?{'data-clickable-text':'true','aria-describedby':hintId}:{'data-highlight-text':'true'}),...(onHighlightRange?{'data-highlight-surface':'true'}:{}),role:'group',...(words.length||onHighlightRange?{tabindex:0}:{}),'aria-label':lexicalAssistance?dict.vocabulary.textLookup:dict.listening.general.highlight});
 if(lexicalAssistance)host.append(hint);host.append(region,status);
 const fragment=document.createDocumentFragment();
 for(const [i,t]of tokens.entries()){const pieces=splitByHighlights(t,highlights),body=pieces?pieces.map(p=>el(p.highlightId?'mark':'span',p.highlightId?{'data-highlight-id':p.highlightId,class:'rounded-sm bg-signal-100 text-ink-900'}:{},p.value)):t.value;if(lexicalAssistance&&t.isWord&&!BASIC_WORDS.has(t.clean.toLowerCase())){const node=el('span',{'data-word':t.clean,'data-token':i,'data-lexical-saved':'false',class:'lexical-dotted-word'},body);wordNodes.set(i,node);fragment.append(node);}else fragment.append(...(Array.isArray(body)?body:[document.createTextNode(body)]));}
 region.append(fragment);
 function paint(){const next=new Set([active,cursor].filter(v=>v!=null));for(const i of lit)if(!next.has(i)){const n=wordNodes.get(i);if(n)n.classList.remove('rounded-sm','bg-signal-50','text-ink-900');}for(const i of next){const n=wordNodes.get(i);if(n)n.className='rounded-sm bg-signal-50 text-ink-900';}lit=next;status.textContent=cursor==null?'':tokens[cursor].value;}
 function close(focus=false){popup?.stop();popup=null;active=null;paint();if(focus&&!signal.aborted)region.focus({preventScroll:true});}
 /** The lookup target of one word token: the phrase (when phrase-aware) or the single contextual hit. */
 function target(i){
  const selected=tokens[i];
  if(phraseAware){const phrase=phraseTarget(text,selected,occurrences);return {word:phrase.word,occurrence:phrase.occurrence};}
  const hits=occurrences.filter(r=>r.startChar<=selected.start&&r.endChar>=selected.end),occurrence=hits.length===1?hits[0]:undefined;
  return {word:occurrence?.surfaceForm??selected.clean,occurrence};
 }
 function open(i){if(!lexicalAssistance||signal.aborted||!wordNodes.has(i))return;if(active===i){close();return;}close();const anchor=wordNodes.get(i);if(!anchor)return;active=i;paint();const {word,occurrence}=target(i);const popover=CONTEXTUAL_SOURCES.has(sourceType)?contextualWordPopover:wordPopover;popup=popover({...context,signal},{anchor,dict,word,sourceType,sourceId,occurrenceId:occurrence?.id,startChar:occurrence?.startChar??tokens[i].start,endChar:occurrence?.endChar??tokens[i].end,catalogueLookup,onSavedStatus:saved=>{anchor.dataset.lexicalSaved=saved?'true':'false';},onClose:()=>close(true)});}
 function cancelHold(){clearTimeout(hold);hold=null;}
 listen(region,'pointerdown',e=>{clearTimeout(pending);cancelHold();close();gesture={x:e.clientX,y:e.clientY,started:Date.now(),cancelled:e.button!==0};
  const pressed=e.target instanceof Element?e.target.closest('[data-token]'):null;
  if(lexicalAssistance&&doubleClickLookup&&e.button===0&&pressed&&wordNodes.has(Number(pressed.dataset.token))&&region.contains(pressed)){const index=Number(pressed.dataset.token);hold=setTimeout(()=>{hold=null;if(gesture?.cancelled||signal.aborted)return;hideControl();window.getSelection()?.removeAllRanges();open(index);},3000);}
 },signal);
 listen(region,'pointermove',e=>{if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8){gesture.cancelled=true;cancelHold();}},signal);
 listen(region,'pointerup',cancelHold,signal);listen(region,'pointerleave',cancelHold,signal);
 listen(region,'pointercancel',()=>{cancelHold();if(gesture)gesture.cancelled=true;},signal);
 // A press held for a lookup belongs to the lookup gesture: the native menu is suppressed, not the gesture cancelled.
 listen(region,'contextmenu',e=>{if(doubleClickLookup){if(hold&&!gesture?.cancelled)e.preventDefault();return;}if(gesture)gesture.cancelled=true;},signal);
 listen(region,'click',e=>{if(!lexicalAssistance)return;if(doubleClickLookup&&e.detail!==0)return;const start=gesture;gesture=null;if(e.detail>1||start&&(start.cancelled||Date.now()-start.started>=500)||window.getSelection()&&!window.getSelection().isCollapsed)return;const n=e.target.closest?.('[data-token]');if(!n||!region.contains(n))return;if(e.detail===0)open(Number(n.dataset.token));else pending=setTimeout(()=>{if(!signal.aborted&&window.getSelection()?.isCollapsed)open(Number(n.dataset.token));},240);},signal);
 listen(region,'dblclick',e=>{cancelHold();if(!lexicalAssistance||!doubleClickLookup||e.button!==0||gesture?.cancelled)return;const n=e.target.closest?.('[data-token]');if(n&&region.contains(n)){clearTimeout(pending);hideControl();open(Number(n.dataset.token));}},signal);
 function hideControl(){control?.remove();control=null;selection=null;}
 function capture(){if(!onHighlightRange)return;const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount){hideControl();return;}const range=s.getRangeAt(0);if(!region.contains(range.startContainer)||!region.contains(range.endContainer)){hideControl();return;}const boundary=(node,offset)=>{const exact=offsetWithin(region,node,offset);if(exact!==null)return exact;try{const r=document.createRange();r.selectNodeContents(region);r.setEnd(node,offset);return r.toString().length;}catch{return null;}};const a=boundary(range.startContainer,range.startOffset),b=boundary(range.endContainer,range.endOffset);if(a==null||b==null||Math.abs(a-b)<1||Math.max(a,b)>text.length)return;hideControl();selection={start:Math.min(a,b),end:Math.max(a,b)};let left=8,top=8;try{const rect=range.getBoundingClientRect();left=rect.left+rect.width/2;top=rect.top;}catch{}
  const existing=highlights.find(h=>selection.start<h.end&&selection.end>h.start),button=el('button',{type:'button',class:'btn-secondary min-h-9'},existing&&onRemoveHighlight?dict.listening.general.clearHighlight:dict.listening.general.highlight);control=el('span',{'data-highlight-control':'',role:'group','aria-label':lexicalAssistance?dict.vocabulary.textLookup:dict.listening.general.highlight,class:'fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-ink-100 bg-paper px-2 py-1 shadow-lg',style:{left:left+'px',top:Math.max(8,top-44)+'px'}},button);host.append(control);listen(button,'pointerdown',e=>e.preventDefault(),signal);listen(button,'click',()=>{const range={...selection};hideControl();s.removeAllRanges();if(existing&&onRemoveHighlight)onRemoveHighlight(existing.id);else onHighlightRange(range);},signal);}
 listen(region,'mouseup',capture,signal);listen(region,'keyup',capture,signal);
 listen(region,'keydown',e=>{if(e.key==='Escape'){if(selection)hideControl();else close(true);return;}if(!lexicalAssistance||e.target!==region||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const previous=cursor===null?-1:words.indexOf(cursor),next=e.key==='Home'?0:e.key==='End'?words.length-1:e.key==='ArrowRight'?Math.min(words.length-1,previous+1):Math.max(0,previous-1);if(words[next]!=null){cursor=words[next];paint();wordNodes.get(cursor)?.scrollIntoView?.({block:'nearest',inline:'nearest'});}}else if(e.key==='Enter'&&words.length){e.preventDefault();open(cursor??words[0]);}},signal);
 listen(document,'keydown',e=>{if(e.key==='Escape'&&active!==null)close(true);},signal);listen(document,'pointerdown',e=>{if(e.target instanceof Element&&!region.contains(e.target)&&!e.target.closest('[data-word-popover]'))close();},signal);
 signal.addEventListener('abort',()=>{clearTimeout(pending);cancelHold();popup?.stop();hideControl();},{once:true});
 return {node:host,stop(){own.abort();}};
}
