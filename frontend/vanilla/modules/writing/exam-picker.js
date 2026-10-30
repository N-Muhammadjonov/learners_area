import {el,button,safeArray} from './shared.js';
import {examFilterGroups,classifyExamQuestion,applicableExamFilters} from './exam-classification.js';

export function questionPicker(ctx,host,{mode,questions,types,onStart,onBack,onPractice}){
 const uz=ctx.locale==='uz',signal=ctx.signal;
 const rows=safeArray(questions).filter(p=>p.taskType===mode);
 let category='all',selected=null;
 const filterGroups=examFilterGroups[mode]??[];
 const filters=Object.fromEntries(filterGroups.map(group=>[group.id,'all']));
 const tags=new Map(rows.map(p=>[p.id,classifyExamQuestion(p)]));
 const root=el('section',{class:'writing-question-picker','data-exam-picker':mode});
 const results=el('ul',{class:'exam-question-list','data-exam-questions':''});
 const count=el('output',{class:'writing-help','aria-live':'polite','data-exam-matching':''});
 const search=el('input',{type:'search',class:'input',placeholder:uz?'Savol qidirish…':'Search questions…','aria-label':uz?'Savol qidirish':'Search questions','data-exam-search':''});
 const choices=el('div',{class:'exam-type-buttons',role:'group','aria-label':'Question type'});
 const filterHost=el('div',{class:'flex flex-col gap-4','data-exam-filter-groups':''});
 const filterControls=[];
 const preview=el('section',{class:'card p-5 exam-question-preview',hidden:true,'data-exam-preview':''});
 const previewRow=el('li',{class:'exam-preview-row','data-exam-preview-row':''},preview);
 const warning=el('p',{class:'writing-error',role:'alert'});
 const start=button(uz?'Imtihonni boshlash':'Start exam',async()=>{
  if(!selected)return;start.disabled=true;warning.textContent='';
  try{await onStart(selected.id);}catch(error){warning.textContent=error.message;start.disabled=false;}
 },{signal,attrs:{'data-exam-selected-start':''}});
 function closePreview(restoreFocus=false){
  const id=selected?.id;selected=null;preview.hidden=true;warning.textContent='';
  previewRow.remove();
  for(const b of results.querySelectorAll('button[data-exam-question]'))b.setAttribute('aria-pressed','false');
  if(restoreFocus&&id){
   const old=[...results.querySelectorAll('button[data-exam-question]')].find(b=>b.dataset.examQuestion===id);
   old?.focus();
  }
 }
 function choose(p){
  if(selected?.id===p.id){closePreview(true);return;}
  closePreview();selected=p;
  for(const b of results.querySelectorAll('button[data-exam-question]'))b.setAttribute('aria-pressed',String(b.dataset.examQuestion===p.id));
  preview.replaceChildren(el('h3',{class:'font-semibold'},p.code??(mode==='task1'?'Task 1':'Task 2')),el('p',{class:'whitespace-pre-line leading-relaxed'},p.prompt));
  if(p.image?.objectKey){
   const image=el('img',{src:'/api/resources/'+p.image.objectKey,alt:p.image.name??p.title,loading:'lazy',decoding:'async'});
   preview.append(el('div',{class:'exam-preview-image'},image));
  }
  const cancel=button(uz?'Bekor qilish':'Cancel',()=>closePreview(true),{signal,cls:'btn-secondary',attrs:{'data-exam-preview-cancel':''}});
  const controls=el('div',{class:'exam-preview-controls'},start);
  if(typeof onPractice==='function')controls.append(button(uz?'Practice · Mashq qilish':'Practice',()=>onPractice(p),{signal,cls:'btn-secondary',attrs:{'data-exam-selected-practice':''}}));
  controls.append(cancel);preview.append(controls,warning);
  preview.hidden=false;start.disabled=false;
  const buttonNode=[...results.querySelectorAll('button[data-exam-question]')].find(b=>b.dataset.examQuestion===p.id);
  const item=buttonNode?.closest('li');
  if(item)results.insertBefore(previewRow,item);
 }
 function matches(p,except=null){
  if(category!=='all'&&p.category!==category)return false;
  const q=search.value.trim().toLocaleLowerCase();
  if(q&&![p.title,p.prompt,p.code,p.sourceDate].filter(Boolean).join(' ').toLocaleLowerCase().includes(q))return false;
  return filterGroups.every(group=>group.id===except||filters[group.id]==='all'||(tags.get(p.id)?.[group.id]??[]).includes(filters[group.id]));
 }
 function updateFilters(){
  const applicable=new Set(applicableExamFilters(mode,category).map(group=>group.id));
  for(const {group,panel,controls} of filterControls){
   panel.hidden=!applicable.has(group.id);
   if(panel.hidden)continue;
   for(const {id,label,b} of controls){
    const n=rows.filter(p=>matches(p,group.id)&&(id==='all'||(tags.get(p.id)?.[group.id]??[]).includes(id))).length;
    b.textContent=label+' · '+n;
    const active=filters[group.id]===id;
    b.className=active?'btn-primary':'btn-secondary';
    b.setAttribute('aria-pressed',String(active));
    b.disabled=n===0&&!active;
   }
  }
 }
 for(const group of filterGroups){
  const panel=el('section',{class:'flex flex-col gap-2','data-exam-filter-panel':group.id});
  const buttons=el('div',{class:'exam-type-buttons',role:'group','aria-label':group.label[ctx.locale]??group.label.en});
  const controls=[];
  const options=[['all',uz?'Barchasi':'Any'],...group.options.map(([id,en,uzLabel])=>[id,uz?uzLabel:en])];
  for(const [id,label] of options){
   const b=button('',()=>{filters[group.id]=id;closePreview();render();},{signal,cls:id==='all'?'btn-primary':'btn-secondary',attrs:{'data-exam-filter-group':group.id,'data-exam-filter-value':id,'aria-pressed':String(id==='all')}});
   controls.push({id,label,b});buttons.append(b);
  }
  panel.append(el('h3',{class:'font-semibold'},group.label[ctx.locale]??group.label.en),buttons);
  filterHost.append(panel);filterControls.push({group,panel,controls});
 }
 function render(){
  const matching=rows.filter(p=>matches(p));
  updateFilters();
  count.textContent=`${matching.length} / ${rows.length} ${uz?'savol':'questions'}`;
  results.replaceChildren(...matching.map(p=>{
   const type=types.find(t=>t.id===p.category)?.label?.[ctx.locale]??p.category;
   const meta=el('span',{class:'exam-question-meta'},el('span',{},type));
   if(p.isNew)meta.append(el('span',{class:'exam-new-badge'},'NEW'));
   const date=p.sourceDate&&!/unknown|noma.lum/i.test(p.sourceDate)?`${uz?'Manbadagi sana':'Reported'}: ${p.sourceDate}`:null;
   const b=button('',()=>choose(p),{signal,cls:'card exam-question-choice',attrs:{'data-exam-question':p.id,'aria-pressed':String(selected?.id===p.id)}});
   b.append(meta,el('span',{class:'exam-question-title'},p.code?`${p.code} · ${p.title}`:p.title));
   if(date)b.append(el('span',{class:'exam-question-date'},date));
   return el('li',{},b);
  }));
  if(!matching.length)results.append(el('li',{class:'card p-5',role:'status'},uz?'Bu turda savol topilmadi.':'No questions in this category.'));
 }
 for(const type of [{id:'all',label:{en:'Any type',uz:'Barcha turlar'}},...types]){
  const n=type.id==='all'?rows.length:rows.filter(p=>p.category===type.id).length;
  const b=button(`${type.label[ctx.locale]??type.label.en} · ${n}`,()=>{
   category=type.id;closePreview();
   const applicable=new Set(applicableExamFilters(mode,category).map(group=>group.id));
   for(const group of filterGroups)if(!applicable.has(group.id))filters[group.id]='all';
   for(const item of choices.querySelectorAll('button')){const active=item===b;item.setAttribute('aria-pressed',String(active));item.className=active?'btn-primary':'btn-secondary';}
   render();
  },{signal,cls:type.id==='all'?'btn-primary':'btn-secondary',attrs:{'data-exam-question-type':type.id,'aria-pressed':String(type.id==='all')}});
  choices.append(b);
 }
 search.addEventListener('input',()=>{closePreview();render();},{signal});
 root.append(el('header',{class:'flex flex-wrap items-center justify-between gap-3'},el('h2',{class:'font-display text-xl'},`${mode==='task1'?'Task 1':'Task 2'} · ${uz?'Savol tanlang':'Choose a question'}`),button(uz?'← Orqaga':'← Back',onBack,{signal,cls:'btn-secondary'})),el('h3',{class:'font-semibold'},uz?'Savol turi':'Question type'),choices,filterHost,search,count,results);
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
