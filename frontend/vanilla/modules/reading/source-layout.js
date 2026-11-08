import {el} from '../../js/dom.js';
const allowed=new Set('div p span strong b em i u sup sub br table thead tbody tfoot tr td th ul ol li h2 h3 h4 img label input select option fieldset legend'.split(' '));
/** Source HTML supplies layout only. No script, event, URL grant or answer key executes here. */
export function sourceDocument(html,{skipTitle=false}={}){
 const root=el('div',{'data-reading-source':''});const doc=new DOMParser().parseFromString(html,'text/html');
 for(const node of [...doc.body.querySelectorAll('*')]){
  if(!allowed.has(node.localName)){if(['script','style','iframe','object','embed','form','link'].includes(node.localName))node.remove();else node.replaceWith(...node.childNodes);continue;}
  for(const attr of [...node.attributes])if(!['class','type','value','placeholder','colspan','rowspan','alt','src','data-source-numbers'].includes(attr.name))node.removeAttribute(attr.name);
  if(node.localName==='img'&&!/^data:image\/(png|jpe?g|webp);base64,/i.test(node.getAttribute('src')||''))node.removeAttribute('src');
 }
 if(skipTitle)doc.body.querySelector('.pass-title')?.remove();root.append(...doc.body.childNodes);return root;
}
export function sourceQuestions({group,questions,answers,onChange}){
 const root=sourceDocument(group.sourceHtml),byNumber=new Map(questions.map(q=>[q.sourceQuestionNo??q.questionNo,q]));
 for(const control of root.querySelectorAll('input,select')){
  const nums=(control.dataset.sourceNumbers||'').split(',').map(Number),rows=nums.map(n=>byNumber.get(n));if(!rows.length||rows.some(q=>!q)){control.disabled=true;continue;}
  const q=rows[0];control.id='answer-'+q.id+(control.type==='radio'||control.type==='checkbox'?'-'+control.value:'');control.name='answer-'+q.id;control.autocomplete='off';control.setAttribute('aria-label','Answer '+rows.map(q=>q.questionNo).join(', '));
  const value=answers[q.id]??'',normalize=s=>String(s).replaceAll('_',' ').trim().toUpperCase();
  if(control.type==='checkbox')control.checked=rows.some(q=>normalize(answers[q.id])===normalize(control.value));
  else if(control.type==='radio')control.checked=normalize(value)===normalize(control.value);else control.value=value;
  control.closest('.qitem,.fill-field,.notes-li,tr,.hrow')?.setAttribute('data-question',q.id);
  control.addEventListener(control.localName==='input'&&control.type==='text'?'input':'change',()=>{
   if(control.type==='checkbox'){
    const same=[...root.querySelectorAll('input[type=checkbox]')].filter(n=>n.dataset.sourceNumbers===control.dataset.sourceNumbers),selected=same.filter(n=>n.checked).map(n=>n.value);
    if(selected.length>rows.length){control.checked=false;return;}rows.forEach((q,i)=>onChange(q.id,selected[i]??''));
   }else onChange(q.id,control.value.slice(0,200));
  });
 }
 for(const label of root.querySelectorAll('.qno,.fqn,.hqn,.qnum')){const q=byNumber.get(Number(label.textContent.trim()));if(q)label.textContent=String(q.questionNo);}
 return root;
}
