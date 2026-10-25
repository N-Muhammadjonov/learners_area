import {el} from '../../js/dom.js';
import {readingHighlighted} from './lesson-text.js';
import {occurrenceSpans} from '../../js/generated/reading-lib/occurrence-spans.js';
/** Original RetentionCheck.tsx: read, cover, recall, self-check. Deliberately NOT scored; the passage is hidden
 * with the `hidden` attribute while the learner recalls it. Writes nothing of its own. */
export function retentionCheck(context,{passageTitle,passageBody,passageLevel,sourceId,occurrences=[],lexicalAssistance=false}){
 const {dict}=context,t=dict.reading;
 let revealed=false;const kept={};
 const level=(passageLevel??'B2').toUpperCase();
 const target=level>='C1'?5:level==='B2'?4:3;
 const checks=[{key:'main',label:t.retentionCheckMain},{key:'details',label:`${t.retentionCheckDetails} (${target-1})`},...(level>='B2'?[{key:'evidence',label:t.retentionCheckEvidence}]:[]),...(level>='C1'?[{key:'conclusion',label:t.retentionCheckConclusion}]:[])];
 const card=el('div',{class:'card flex flex-col gap-2 p-5'});
 const toggle=el('button',{type:'button',class:'btn-ghost text-xs','data-retention-toggle':true,'aria-expanded':'false'},t.retentionShow);
 const kept_=el('p',{class:'text-xs text-ink-300'});
 const passageBox=el('div',{class:'rounded-sm bg-paper-sunken p-3','data-retention-passage':true,hidden:true},
  el('p',{class:'mb-1 text-xs font-medium text-ink-500'},passageTitle),
  readingHighlighted(context,{scope:sourceId,textKey:'review',text:passageBody,lexicalAssistance,occurrences:occurrenceSpans(passageBody,passageBody,occurrences),sourceId,className:'text-sm leading-relaxed text-ink-700'}),
  el('p',{class:'mt-2 text-xs text-ink-300'},t.retentionSelfCheck));
 toggle.addEventListener('click',()=>{revealed=!revealed;passageBox.hidden=!revealed;toggle.setAttribute('aria-expanded',String(revealed));toggle.textContent=revealed?t.retentionHide:t.retentionShow;},{signal:context.signal});
 const updateKept=()=>{kept_.textContent=t.retentionKept.replace('{kept}',String(checks.filter(c=>kept[c.key]).length)).replace('{count}',String(checks.length));};
 const list=el('ul',{class:'flex flex-wrap gap-3','data-retention-checklist':true},checks.map(item=>{
  const box=el('input',{type:'checkbox',class:'h-4 w-4','data-retention-check':item.key});
  box.addEventListener('change',()=>{kept[item.key]=box.checked;updateKept();});
  return el('li',{},el('label',{class:'flex items-center gap-2 text-xs text-ink-700'},box,item.label));}));
 updateKept();
 card.append(el('div',{class:'flex flex-wrap items-center justify-between gap-2'},el('h2',{class:'text-sm font-medium text-ink-900'},t.retentionTitle),toggle),
  el('p',{class:'text-xs text-ink-500'},t.retentionHint),
  el('p',{class:'text-xs text-ink-300','data-retention-target':String(target),'data-retention-level':level},t.retentionGoal.replace('{count}',String(target)).replace('{level}',level)),
  el('textarea',{class:'input min-h-[110px]','data-retention-input':true,placeholder:t.retentionPlaceholder}),
  list,kept_,passageBox);
 return card;
}
