import {h,request,guardArray} from './shared.js';
/** One learner-owned combobox, with cancellation by query and route lifetime. */
export function searchBox(ctx,openWords){
 const {dict,signal,url}=ctx,t=dict.vocabulary.search;
 const shell=h('div',{class:'relative w-full lg:max-w-md'}),input=h('input',{id:'vocab-search',class:'input',type:'search',maxLength:80,autoComplete:'off',role:'combobox','aria-autocomplete':'list','aria-expanded':'false','aria-controls':'vocab-search-results',placeholder:t.placeholder,'aria-label':t.title,value:url.searchParams.get('q')??''});
 const status=h('p',{class:'mt-1 text-xs text-ink-300','data-search-status':'','aria-live':'polite',hidden:true});
 const popup=h('div',{id:'vocab-search-results',role:'listbox','aria-label':t.title,'data-search-results':'',class:'absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-ink-100 bg-paper-raised p-1 shadow-raised',hidden:true});
 let serial=0,timer,active=-1,rows=[];
 const message=text=>{status.textContent=text;status.hidden=!text;};
 const close=()=>{popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const open=()=>{popup.hidden=false;input.setAttribute('aria-expanded','true');};
 function render(){
  popup.replaceChildren(...rows.map((word,index)=>h('button',{type:'button',role:'option',id:'vocab-suggest-'+index,'aria-selected':'false','data-search-hit':word.id,class:'flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left hover:bg-paper-sunken',onClick:()=>{close();openWords(word);}},h('span',{class:'text-sm font-medium text-ink-900'},word.term),h('span',{class:'line-clamp-2 text-xs text-ink-500'},word.definitionEn),word.translationUz?h('span',{class:'text-xs text-band-warn'},word.translationUz):null)));
  if(!rows.length)popup.append(h('p',{class:'px-3 py-2 text-sm text-ink-500'},t.empty));
  message(rows.length?`${rows.length} ${t.results}`:t.empty);open();
 }
 async function lookup(token,query){
  try{const data=await request('/api/vocabulary/search?q='+encodeURIComponent(query),{signal});if(signal.aborted||token!==serial)return;rows=guardArray(data,'results');render();}
  catch{if(signal.aborted||token!==serial)return;rows=[];message(dict.errors.unknown);close();}
 }
 function changed(){clearTimeout(timer);const token=++serial,query=input.value.trim().slice(0,80);close();if(!query){rows=[];message('');return;}message(dict.common.loading);timer=setTimeout(()=>void lookup(token,query),180);}
 input.addEventListener('input',changed,{signal});
 input.addEventListener('focus',()=>{if(input.value.trim()&&rows.length)open();},{signal});
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){close();return;}
  const options=[...popup.querySelectorAll('[role="option"]')];
  if(['ArrowDown','ArrowUp'].includes(event.key)&&options.length){event.preventDefault();open();active=active<0?(event.key==='ArrowDown'?0:options.length-1):(active+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',options[active].id);}
  if(event.key==='Enter'&&!popup.hidden&&active>=0){event.preventDefault();options[active]?.click();}
 },{signal});
 document.addEventListener('mousedown',event=>{if(!shell.contains(event.target))close();},{signal});
 signal.addEventListener('abort',()=>{clearTimeout(timer);serial++;close();},{once:true});
 shell.append(input,status,popup);if(input.value.trim())changed();return shell;
}
