import {el} from '../../js/dom.js';

function questionNumber(control){
 const nearest=control.closest('[data-q],[data-qnum]');
 for(const value of [control.dataset.q,control.dataset.qnum,control.id,control.name,nearest?.dataset.q,nearest?.dataset.qnum]){
  const match=/^q?(\d+)$/.exec(value??'');
  if(match)return Number(match[1]);
 }
 return null;
}

export function listeningCdPaper(markup,questions,answers,change){
 const paper=el('section',{class:'questions-section exam-content','data-listening-source-paper':''});
 const template=document.createElement('template');
 template.innerHTML=markup;
 paper.append(template.content);
 const byNumber=new Map(questions.map(q=>[q.number,q])),covered=new Set(),groups=new Map();
 for(const slot of paper.querySelectorAll('.ldm-slot')){
  const q=byNumber.get(questionNumber(slot)??questionNumber(slot.parentElement));
  if(!q?.options.length)continue;
  const select=el('select',{class:'answer-input','data-q':q.number},el('option',{value:''},slot.dataset.placeholder??'Select'));
  q.options.forEach((text,index)=>{
   const value=/^[A-Z](?:\s|[).])/.test(text)?text[0]:String.fromCharCode(65+index);
   select.append(el('option',{value},text));
  });
  slot.replaceChildren(select);
  const matchGroup=slot.closest('[data-ldm-group]')??paper;
  for(const option of matchGroup.querySelectorAll('[data-code]'))option.draggable=true;
  slot.addEventListener('dragover',event=>event.preventDefault());
  slot.addEventListener('drop',event=>{
   event.preventDefault();
   const value=event.dataTransfer?.getData('text/plain');
   if([...select.options].some(option=>option.value===value)){select.value=value;select.dispatchEvent(new Event('change'));}
  });
 }
 paper.addEventListener('dragstart',event=>{
  const option=event.target.closest?.('[data-code]');
  if(option?.draggable)event.dataTransfer?.setData('text/plain',option.dataset.code);
 });
 for(const control of paper.querySelectorAll('input,select')){
  const numbers=control.type==='checkbox'&&control.dataset.pairQs
   ? control.dataset.pairQs.split(/\D+/).filter(Boolean).map(Number)
   : [questionNumber(control)];
  const rows=numbers.map(n=>byNumber.get(n));
  if(rows.some(q=>!q)||!['text','select-one','radio','checkbox'].includes(control.type)){
   control.remove();continue;
  }
  const q=rows[0],label='Answer '+rows.map(row=>row.number).join(', ');
  control.autocomplete='off';
  control.setAttribute('aria-label',label);
  control.setAttribute('data-listening-source-question',q.number);
  rows.forEach(row=>covered.add(row.id));
  if(control.type==='checkbox'){
   const key=rows.map(row=>row.id).join(',');
   const group=groups.get(key)??{rows,controls:[]};
   group.controls.push(control);groups.set(key,group);
   control.checked=rows.some(row=>(answers[row.id]??'').split(',').includes(control.value));
   control.addEventListener('change',()=>{
    const values=group.controls.filter(item=>item.checked).map(item=>item.value);
    if(rows.length===1&&q.input==='multi'){change(q.id,values.join(','));return;}
    if(values.length>rows.length){control.checked=false;return;}
    rows.forEach((row,index)=>change(row.id,values[index]??''));
   });
  }else if(control.type==='radio'){
   control.name='listening-cd-'+q.id;
   control.checked=(answers[q.id]??'')===control.value;
   control.addEventListener('change',()=>{if(control.checked)change(q.id,control.value);});
  }else{
   control.value=answers[q.id]??'';
   if(control.type==='text')control.maxLength=500;
   control.addEventListener(control.type==='text'?'input':'change',()=>change(q.id,control.value));
  }
 }
 return {paper,covered};
}
