import {el,button,safeArray} from './shared.js';

export function questionPicker(ctx,host,{mode,questions,types,onStart,onBack}){
 const uz=ctx.locale==='uz',signal=ctx.signal;
 const rows=safeArray(questions).filter(p=>p.taskType===mode);
 let category='all',selected=null;
 const root=el('section',{class:'writing-question-picker','data-exam-picker':mode});
 const results=el('ul',{class:'exam-question-list','data-exam-questions':''});
 const count=el('output',{class:'writing-help','aria-live':'polite','data-exam-matching':''});
 const search=el('input',{type:'search',class:'input',placeholder:uz?'Savol qidirish…':'Search questions…','aria-label':uz?'Savol qidirish':'Search questions','data-exam-search':''});
 const choices=el('div',{class:'exam-type-buttons',role:'group','aria-label':'Question type'});
 const preview=el('section',{class:'card p-5 exam-question-preview',hidden:true,'data-exam-preview':''});
 const warning=el('p',{class:'writing-error',role:'alert'});
 const start=button(uz?'Imtihonni boshlash':'Start exam',async()=>{
  if(!selected)return;start.disabled=true;warning.textContent='';
  try{await onStart(selected.id);}catch(error){warning.textContent=error.message;start.disabled=false;}
 },{signal,attrs:{'data-exam-selected-start':''}});
 function choose(p){
  selected=p;
  for(const b of results.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.examQuestion===p.id));
  preview.replaceChildren(el('h3',{class:'font-semibold'},p.code??(mode==='task1'?'Task 1':'Task 2')),el('p',{class:'whitespace-pre-line leading-relaxed'},p.prompt));
  if(p.image?.objectKey){
   const image=el('img',{src:'/api/resources/'+p.image.objectKey,alt:p.image.name??p.title,loading:'lazy',decoding:'async'});
   preview.append(el('div',{class:'exam-preview-image'},image));
  }
  preview.append(start,warning);preview.hidden=false;start.disabled=false;
 }
 function render(){
  const q=search.value.trim().toLocaleLowerCase(),matching=rows.filter(p=>(category==='all'||p.category===category)&&(!q||[p.title,p.prompt,p.code,p.sourceDate].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)));
  count.textContent=`${matching.length} / ${rows.length} ${uz?'savol':'questions'}`;
  results.replaceChildren(...matching.map(p=>{
   const type=types.find(t=>t.id===p.category)?.label?.[ctx.locale]??p.category;
   const meta=el('span',{class:'exam-question-meta'},el('span',{},type));
   if(p.isNew)meta.append(el('span',{class:'exam-new-badge'},'NEW'));
   const date=p.sourceDate?`${uz?'Manbadagi sana':'Reported'}: ${p.sourceDate}`:p.dateDetail??(uz?'Imtihon sanasi noma’lum':'Exam date unknown');
   const b=button('',()=>choose(p),{signal,cls:'card exam-question-choice',attrs:{'data-exam-question':p.id,'aria-pressed':String(selected?.id===p.id)}});
   b.append(meta,el('span',{class:'exam-question-title'},p.code?`${p.code} · ${p.title}`:p.title),el('span',{class:'exam-question-date'},date));
   if(p.addedDate)b.append(el('span',{class:'exam-question-date'},`${uz?'Qo‘shilgan':'Added'}: ${p.addedDate}`));
   return el('li',{},b);
  }));
  if(!matching.length)results.append(el('li',{class:'card p-5',role:'status'},uz?'Bu turda savol topilmadi.':'No questions in this category.'));
 }
 for(const type of [{id:'all',label:{en:'Any type',uz:'Barcha turlar'}},...types]){
  const n=type.id==='all'?rows.length:rows.filter(p=>p.category===type.id).length;
  const b=button(`${type.label[ctx.locale]??type.label.en} · ${n}`,()=>{
   category=type.id;selected=null;preview.hidden=true;
   for(const item of choices.querySelectorAll('button')){const active=item===b;item.setAttribute('aria-pressed',String(active));item.className=active?'btn-primary':'btn-secondary';}
   render();
  },{signal,cls:type.id==='all'?'btn-primary':'btn-secondary',attrs:{'data-exam-question-type':type.id,'aria-pressed':String(type.id==='all')}});
  choices.append(b);
 }
 search.addEventListener('input',render,{signal});
 root.append(el('header',{class:'flex flex-wrap items-center justify-between gap-3'},el('h2',{class:'font-display text-xl'},`${mode==='task1'?'Task 1':'Task 2'} · ${uz?'Savol tanlang':'Choose a question'}`),button(uz?'← Orqaga':'← Back',onBack,{signal,cls:'btn-secondary'})),el('h3',{class:'font-semibold'},uz?'Savol turi':'Question type'),choices,search,count,preview,results);
 host.replaceChildren(root);render();
}

/** Full-size graphics stay in the current exam, with keyboard-safe modal focus. */
export function attachExamImageZoom(ctx,host){
 for(const image of host.querySelectorAll('img')){
  const frame=image.closest('.writing-image-frame');
  if(!frame)continue;
  const zoom=button(ctx.locale==='uz'?'Rasmni kattalashtirish':'Enlarge image',()=>{
   const previous=document.activeElement;
   const dialog=el('dialog',{class:'exam-image-dialog','aria-label':image.alt||'Question diagram'});
   const full=el('img',{src:image.src,alt:image.alt});let scale=100;
   const update=()=>{full.style.width=scale+'%';full.style.maxWidth='none';};
   const close=button(ctx.locale==='uz'?'Yopish':'Close',()=>dialog.close(),{signal:ctx.signal,cls:'btn-secondary'});
   const tools=el('div',{class:'exam-image-toolbar'},button('−',()=>{scale=Math.max(50,scale-25);update();},{signal:ctx.signal,cls:'btn-secondary',attrs:{'aria-label':'Zoom out'}}),button('+',()=>{scale=Math.min(300,scale+25);update();},{signal:ctx.signal,cls:'btn-secondary',attrs:{'aria-label':'Zoom in'}}),close);
   dialog.append(tools,el('div',{class:'exam-image-stage'},full));document.body.append(dialog);
   dialog.addEventListener('close',()=>{dialog.remove();previous?.focus();},{once:true});
   ctx.signal.addEventListener('abort',()=>dialog.remove(),{once:true});dialog.showModal();close.focus();
  },{signal:ctx.signal,cls:'btn-secondary',attrs:{'data-exam-image-zoom':''}});
  frame.after(zoom);
 }
}
