import {listen} from '../../js/dom.js';
import {returnPolicy} from '../campus/return-policy.js';

const STUDY_MODULES=new Set(['live-classes','assignments','mocks','video-lessons','listening','reading','writing','grammar','vocabulary','courses','coach']);
export const isGrammarExercise=url=>/^\/app\/grammar\/(?:lessons\/[^/]+|[^/]+)\/?$/.test(url.pathname)&&!['/app/grammar/lessons','/app/grammar/lessons/author'].includes(url.pathname);
export const supportsStudyFocus=url=>isGrammarExercise(url)||(STUDY_MODULES.has(url.pathname.split('/')[2])&&returnPolicy(url).mode!=='back');

/** Presentation only: toggling never refreshes a route or touches an attempt.
 * F is intentionally undocumented in the interface. Text entry owns its keys. */
export function studyFocus({signal},changed=()=>{}){
 const html=document.documentElement;let useful=false,on=false,location=null;
 function apply(next){
  on=useful&&Boolean(next);html.dataset.studyFocus=on?'on':'off';
  if(html.dataset.retentionFocus!=='on')html.dataset.focus=on?'on':'off';
  changed();
 }
 const typing=node=>node?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],dialog[open],[role="dialog"]');
 listen(document,'keydown',event=>{
  if(!useful||event.defaultPrevented||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||typing(event.target)||typing(document.activeElement))return;
  if(event.key.toLowerCase()==='f'){event.preventDefault();apply(!on);}
 },signal);
 signal.addEventListener('abort',()=>{useful=false;apply(false);},{once:true});
 return {get on(){return on;},get useful(){return useful;},toggle(){apply(!on);},update(url){
  const next=url.pathname+url.search;if(location===next)return;
  const samePath=location?.split('?')[0]===url.pathname;
  location=next;useful=supportsStudyFocus(url);apply(samePath?on:isGrammarExercise(url));
 }};
}
