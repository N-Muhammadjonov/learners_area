import {el} from '../../js/dom.js';

export function questionNumber(control){
 const nearest=control.closest('[data-q],[data-qnum]');
 for(const value of [control.dataset.q,control.dataset.qnum,control.dataset.question,control.id,control.name,nearest?.dataset.q,nearest?.dataset.qnum]){
  const match=/^q?(\d+)$/.exec(value??'');
  if(match)return Number(match[1]);
 }
 return null;
}

export function bindCdPaper(paper,questions,answers,change){
 const byNumber=new Map(questions.map(q=>[q.number,q])),covered=new Set(),groups=new Map();
 const banks=new Map();
 for(const option of paper.querySelectorAll('.ldm-option[data-code]')){
  const group=option.dataset.group;
  const bank=banks.get(group)??{options:[],slots:[],selected:null};
  bank.options.push(option);banks.set(group,bank);
  option.draggable=true;
  const arm=()=>{
   bank.selected=option.dataset.code;
   bank.options.forEach(item=>item.classList.toggle('selected',item===option));
  };
  option.addEventListener('click',arm);
  option.addEventListener('dragstart',event=>{
   arm();
   event.dataTransfer?.setData('text/plain',option.dataset.code);
  });
 }
 for(const slot of paper.querySelectorAll('.ldm-slot')){
  const q=byNumber.get(questionNumber(slot)),bank=banks.get(slot.dataset.group);
  if(!q||!bank)continue;
  const placeholder=slot.dataset.placeholder??slot.textContent;
  const entry={slot,q,value:answers[q.id]??'',placeholder};
  bank.slots.push(entry);covered.add(q.id);
  slot.setAttribute('data-listening-source-question',q.number);
  const place=value=>{
   if(typeof value!=='string')return;
   if(value&&!bank.options.some(option=>option.dataset.code===value))return;
   if(value)for(const other of bank.slots){
    if(other!==entry&&other.value===value){other.value='';change(other.q.id,'');}
   }
   entry.value=value;change(q.id,value);
   bank.selected=null;
   bank.options.forEach(option=>option.classList.remove('selected'));
   paintBank(bank);
  };
  slot.addEventListener('click',()=>{if(bank.selected)place(bank.selected);});
  slot.addEventListener('dragover',event=>event.preventDefault());
  slot.addEventListener('drop',event=>{event.preventDefault();place(event.dataTransfer?.getData('text/plain'));});
  slot.addEventListener('keydown',event=>{
   if((event.key==='Enter'||event.key===' ')&&bank.selected){event.preventDefault();place(bank.selected);}
   if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();place('');}
  });
 }
 for(const bank of banks.values())paintBank(bank);
 for(const control of paper.querySelectorAll('input,select')){
  const numbers=control.type==='checkbox'&&control.dataset.pairQs
   ? control.dataset.pairQs.split(/\D+/).filter(Boolean).map(Number)
   : [questionNumber(control)];
  const rows=numbers.map(n=>byNumber.get(n));
  if(rows.some(q=>!q)||!['text','select-one','radio','checkbox'].includes(control.type))continue;
  const q=rows[0];
  control.autocomplete='off';
  control.setAttribute('aria-label','Answer '+rows.map(row=>row.number).join(', '));
  control.setAttribute('data-listening-source-question',q.number);
  rows.forEach(row=>covered.add(row.id));
  if(control.type==='checkbox'){
   const key=rows.map(row=>row.id).join(',');
   const group=groups.get(key)??[];
   group.push(control);groups.set(key,group);
   control.checked=rows.some(row=>(answers[row.id]??'').split(',').includes(control.value));
   const limit=Number(control.dataset.max)|| (q.input==='multi' ? 2 : rows.length);
   control.addEventListener('change',()=>{
    const values=group.filter(item=>item.checked).map(item=>item.value).sort();
    if(values.length>limit){control.checked=false;return;}
    if(rows.length===1&&q.input==='multi'){change(q.id,values.join(','));return;}
    rows.forEach((row,index)=>change(row.id,values[index]??''));
   });
  }else if(control.type==='radio'){
   control.checked=(answers[q.id]??'')===control.value;
   control.addEventListener('change',()=>{if(control.checked)change(q.id,control.value);});
  }else{
   control.value=answers[q.id]??'';
   if(control.type==='text')control.maxLength=500;
   control.addEventListener(control.type==='text'?'input':'change',()=>{
    if(control.value&&control.dataset.group?.includes(',')){
     const siblings=control.dataset.group.split(',').map(n=>paper.querySelector('#q'+Number(n)));
     if(siblings.some(sibling=>sibling&&sibling!==control&&sibling.value===control.value))control.value='';
    }
    change(q.id,control.value);
   });
  }
 }
 for(const q of questions.filter(question=>!covered.has(question.id))){
  const control=q.options.length
   ? el('select',{class:'answer-input'},el('option',{value:''},'Select'),
       q.options.map((label,i)=>el('option',{value:/^[A-Z](?:\s|[).])/.test(label)?label[0]:String.fromCharCode(65+i)},label)))
   : el('input',{class:'answer-input',type:'text',maxlength:500});
  control.value=answers[q.id]??'';
  control.dataset.listeningSourceQuestion=q.number;
  control.addEventListener(control.tagName==='SELECT'?'change':'input',()=>change(q.id,control.value));
  paper.append(el('p',{},el('label',{},q.number+'. '+q.text+' ',control)));
 }
 return covered;
}

function paintBank({options,slots}){
 for(const option of options)option.classList.toggle('used',slots.some(entry=>entry.value===option.dataset.code));
 for(const {slot,value,placeholder} of slots){
  slot.textContent=options.find(option=>option.dataset.code===value)?.dataset.label??(value||placeholder);
  slot.classList.toggle('filled',!!value);
 }
}
