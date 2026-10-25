import {el} from '../../js/dom.js';
import {IconBack} from '../../js/generated/icons.js';
/** Persistent Main academic panes. Updating an answer preserves passage highlights, scroll and input selection. */
export function academicWorkspace(ctx,p,state,setPane,setPart){
 const {dict}=ctx,t=dict.readingPractice,root=el('div',{class:'flex flex-col gap-4','data-reading-workspace':'academic'}),tools=el('div',{class:'contents'});
 root.append(el('div',{class:'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-ink-100 bg-paper-raised px-4 py-2.5'},el('div',{class:'min-w-0 flex-1'},el('h1',{class:'truncate font-display text-lg text-ink-900'},p.passageTitle),el('p',{class:'text-xs text-ink-300'},p.passageMeta?`${p.passageMeta} · `:'',`${dict.reading.questions}: ${p.questions.length}`)),tools));
 const tabs=el('div',{class:'flex gap-2 lg:hidden',role:'tablist','aria-label':dict.reading.practiceTitle});
 const buttons={};for(const key of ['passage','questions']){const b=el('button',{type:'button',role:'tab','data-practice-tab':key},key==='passage'?t.passageTab:t.questionsTab);b.addEventListener('click',()=>setPane(key),{signal:ctx.signal});buttons[key]=b;tabs.append(b);}root.append(tabs);
 const parts=el('nav',{class:'flex flex-wrap gap-2','aria-label':dict.readingHub.tabAcademic,'data-academic-parts':'',hidden:p.parts.length<2},p.parts.map((part,index)=>{const b=el('button',{type:'button',class:'btn-secondary','aria-pressed':'false'},dict.generalReading.passageN.replace('{n}',index+1));b.addEventListener('click',()=>setPart(index),{signal:ctx.signal});return b;}));root.append(parts);
 const passage=el('section',{'data-practice-pane':'passage','aria-label':t.passageTab}),questions=el('section',{'data-practice-pane':'questions','aria-label':t.questionsTab});root.append(el('div',{class:'grid grid-cols-1 gap-6 lg:grid-cols-[58fr_42fr]'},passage,questions));
 let passageNode=null;
 function update(data){const focused=document.activeElement,saved=focused&&root.contains(focused)?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;
  const answered=p.questions.filter(q=>(state.answers[q.id]??'').trim()).length,progress=t.answered.replace('{answered}',answered).replace('{total}',p.questions.length);
  tools.replaceChildren(...data.tools,el('a',{href:'/app/reading',class:'btn-secondary','data-practice-exit':''},IconBack({class:'text-[18px]'}),t.exit));
  for(const key of ['passage','questions']){const selected=state.pane===key;buttons[key].setAttribute('aria-selected',String(selected));buttons[key].className=selected?'min-h-[44px] flex-1 rounded-sm border border-signal-600 bg-signal-600 px-3 text-sm font-medium text-white':'min-h-[44px] flex-1 rounded-sm border border-ink-100 bg-paper-raised px-3 text-sm text-ink-700';buttons[key].replaceChildren(key==='passage'?t.passageTab:t.questionsTab);if(key==='questions')buttons[key].append(el('span',{class:'ml-2 text-xs opacity-80'},progress));}
  passage.className=`card flex-col gap-3 p-5 lg:flex ${state.pane==='passage'?'flex':'hidden'}`;questions.className=`flex-col gap-4 lg:flex ${state.pane==='questions'?'flex':'hidden'}`;
  [...parts.children].forEach((b,i)=>{b.className=i===state.activePart?'btn-primary':'btn-secondary';b.setAttribute('aria-pressed',String(i===state.activePart));});
  if(passageNode!==data.passagePane){passage.querySelectorAll('[data-highlight-host]').forEach(n=>n.stop?.());passage.replaceChildren(data.passagePane);passageNode=data.passagePane;}
  const back=el('button',{type:'button',class:'flex min-h-[44px] items-center gap-1.5 text-sm text-ink-700'},t.passageTab);back.addEventListener('click',()=>setPane('passage'),{signal:ctx.signal});
  questions.replaceChildren(el('div',{class:'flex items-center justify-between gap-2 lg:hidden'},el('span',{class:'text-xs text-ink-500'},progress),back),data.questionsPane,data.action);
  if(saved?.id){const field=document.getElementById(saved.id);if(field&&root.contains(field)){field.focus({preventScroll:true});if(typeof saved.start==='number')try{field.setSelectionRange(saved.start,saved.end);}catch{}}}
 }
 return {root,update};
}
