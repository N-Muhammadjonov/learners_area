import {el} from '../../js/dom.js';
import {sourceTextRange} from './source-text.js';
import {isUnstatedAnswer} from '../../js/generated/reading-lib/unstated.js';
import {readingQuestionDescriptor} from '../../js/generated/reading-lib/question-model.js';
import {ternaryLabel} from '../../js/generated/reading-lib/reading-choices.js';

const number=q=>q.questionNo??q.order;
function format(q,answer){
 if(answer==null||answer==='')return '—';
 const descriptor=readingQuestionDescriptor(q),value=String(answer);
 if(descriptor?.answerModel.kind!=='ternary')return value;
 return ternaryLabel(descriptor.id,value.trim().toLowerCase().replace(/\s+/g,'_')).toUpperCase();
}
const unstated=row=>isUnstatedAnswer(String(row.correctAnswer??''));
/** Match only server-authored evidence in canonical coordinates. Ambiguous quotes are not painted. */
export function evidenceRanges(body,questions,results){
 const byId=new Map(questions.map(q=>[q.id,q]));
 return results.flatMap(row=>{
  const q=byId.get(row.questionId),range=q&&row.evidenceQuote&&!unstated(row)&&row.evidenceType!=='missing_source'?sourceTextRange(body,row.evidenceQuote):null;
  return range?[{id:q.id,no:number(q),start:range.start,end:range.end}]:[];
 });
}
const excluded='[data-reading-evidence-mark],.sr-only,[role="status"],button,input,select,textarea,[aria-hidden="true"]';
function textNodes(root){
 const walker=root.ownerDocument.createTreeWalker(root,4),nodes=[];let node;
 while((node=walker.nextNode()))if(node.parentElement&&!node.parentElement.closest(excluded))nodes.push(node);
 return nodes;
}
/** Decorate existing text, retaining lexical word elements and their events. */
export function paintEvidence(root,body,ranges){
 for(const mark of root.querySelectorAll('[data-reading-evidence-mark]'))mark.replaceWith(...mark.childNodes);
 if(!ranges.length)return;
 const selector='[data-clickable-text],[data-highlight-text],p,li,td,th';
 const candidates=[...root.querySelectorAll(selector)].filter(n=>!n.closest('.sr-only')&&!n.querySelector(selector));
 const blocks=candidates.length?candidates:[root],labelled=new Set();
 let cursor=0;
 for(const block of blocks){
  const nodes=textNodes(block),text=nodes.map(n=>n.data).join(''),aligned=sourceTextRange(body,text,cursor);
  if(!aligned)continue;
  cursor=Math.max(cursor,aligned.end);
  let offset=0;
  for(const node of nodes){
   const value=node.data,segments=[];let lastKey=null;
   for(let i=0;i<value.length;i++){
    const pos=aligned.map[offset+i],hit=pos==null?[]:ranges.filter(r=>pos>=r.start&&pos<r.end);
    const key=hit.map(r=>r.id).join('|');
    if(key===lastKey)segments.at(-1).text+=value[i];
    else{segments.push({hit,text:value[i]});lastKey=key;}
   }
   offset+=value.length;
   if(!segments.some(s=>s.hit.length))continue;
   const fragment=root.ownerDocument.createDocumentFragment();
   for(const segment of segments){
    if(!segment.hit.length){fragment.append(segment.text);continue;}
    const labels=segment.hit.filter(r=>!labelled.has(r.id));
    labels.forEach(r=>labelled.add(r.id));
    fragment.append(el('mark',{'data-reading-evidence-mark':'','data-evidence-questions':segment.hit.map(r=>r.id).join(' '),'data-evidence-label':labels.map(r=>'Q'+r.no).join(' '),class:'reading-evidence-mark'},segment.text));
   }
   node.replaceWith(fragment);
  }
 }
}
/** Preserve evidence across lexical redraws, but do not observe our own mutations. */
export function bindEvidence(root,body,signal){
 let ranges=[];
 const Observer=root.ownerDocument.defaultView.MutationObserver;
 const observer=new Observer(()=>redraw());
 function redraw(){
  observer.disconnect();paintEvidence(root,body,ranges);
  if(!signal?.aborted&&ranges.length)observer.observe(root,{childList:true,subtree:true,characterData:true});
 }
 signal?.addEventListener('abort',()=>observer.disconnect(),{once:true});
 return next=>{ranges=next;redraw();};
}
function feedback(dict,q,row,answer,expanded){
 const correct=row.isCorrect===true,id=q.id;
 const details=el('details',{class:'reading-inline-explanation','data-reading-explanation':id},el('summary',{},dict.reading.explanation),
  el('p',{},row.explanation||dict.readingV4.explanationMissing),
  unstated(row)?el('p',{},dict.readingV4.unstatedEvidence):!row.evidenceQuote?el('p',{},dict.readingV4.evidenceMissing):null);
 details.open=expanded.has(id);
 details.addEventListener('toggle',()=>{if(details.open)expanded.add(id);else expanded.delete(id);});
 const expected=format(q,row.correctAnswer);
 const alternatives=[...new Set((row.acceptedAnswers??[]).map(value=>format(q,value)))]
  .filter(value=>value.trim().toLowerCase()!==expected.trim().toLowerCase());
 return el('div',{'data-reading-inline-review':id,'data-review-question':id,'data-general-question':id,'data-general-result':correct?'correct':'incorrect',class:'reading-inline-review'},
  el('p',{class:'reading-review-student'},el('span',{class:'reading-review-number'},'Q'+number(q)+' '),el('span',{'aria-label':correct?dict.reading.correct:dict.reading.incorrect},correct?'✓':'✗'),' ',dict.reading.yourAnswer+': ',el('strong',{},format(q,answer))),
  !correct?el('p',{class:'reading-review-correct'},dict.reading.correctAnswer+': ',el('strong',{},expected)):null,
  !correct&&alternatives.length?el('p',{class:'reading-review-alternatives'},dict.readingPractice.acceptedAnswers+': '+alternatives.join(' / ')):null,
  details);
}
/** Attach feedback by question ID; preserve the original controls, tables and question groups. */
export function inlineReview(root,{dict,questions,rows,answers,expanded=new Set(),readonly=false}){
 const byId=new Map(rows.map(row=>[row.questionId,row]));
 const targets=[...root.querySelectorAll('[data-question]')],controls=[...root.querySelectorAll('input,select,button[role="radio"]')];
 for(const q of questions){
  const row=byId.get(q.id);if(!row)continue;
  const verdict=row.isCorrect===true?'correct':'incorrect',own=targets.filter(n=>n.dataset.question===q.id);
  const fields=controls.filter(n=>n.dataset.readingQuestionIds?n.dataset.readingQuestionIds.split(' ').includes(q.id):n.dataset.answerInput===q.id||n.id==='answer-'+q.id||n.name==='answer-'+q.id||n.id.startsWith('answer-'+q.id+'-')||n.closest('[data-question]')?.dataset.question===q.id);
  for(const field of fields){
   const multiple=(field.dataset.readingQuestionIds||'').split(' ').filter(Boolean).length>1;
   const chosen=field.type==='checkbox'||field.type==='radio'?field.checked:field.getAttribute('role')==='radio'?field.getAttribute('aria-checked')==='true':true;
   if(chosen&&(!multiple||String(field.value).trim().toUpperCase()===String(answers[q.id]??'').trim().toUpperCase()))field.dataset.readingVerdict=verdict;
   if(readonly)field.disabled=true;
  }
  const anchor=fields[0]?.closest('td,th')??own[0]??fields[0]?.closest('[data-answer-slot],p,label,li,.qitem')??null;
  const result=feedback(dict,q,row,answers[q.id],expanded);
  if(anchor){
   anchor.dataset.readingVerdict=verdict;
   const cell=anchor.closest('td,th');
   if(cell)cell.append(result);
   else if(anchor.matches('tr'))(anchor.lastElementChild??anchor).append(result);
   else if(anchor.matches('span,label'))(anchor.closest('p,.notes-li,.qitem,li')??anchor.parentElement).after(result);
   else if(anchor.matches('p'))anchor.after(result);
   else anchor.append(result);
  }else root.append(result);
 }
 if(readonly)for(const control of controls)control.disabled=true;
 return root;
}
