import {answerProgress} from '../shared/progress.js';
import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {readingGeneralLibraryDTO} from '../../js/adapters/reading-v44.js';
import {IconReading,IconChevronRight} from '../../js/generated/icons.js';
import {questionTypeLabel,topicLabel} from '../../js/generated/reading-lib/reading-labels.js';
import {closeDropdownAfterSelection,closeReadingDropdownsOnEscape,closeReadingDropdownsOutside} from '../../js/generated/reading-lib/dropdowns.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {startPassageButton} from './start.js';
/** Original src/app/app/(shell)/reading/general/page.tsx + ReadingLearningLibrary + ReadingFilters + ReadingPassageCard.
 * Filters are URL-backed: links replace the history entry, search commits after 300 ms or at once on submit/clear. */
export function mountGeneral(context){
 const {root,url,signal,dict,locale,navigate}=context,host=el('div',{'data-native-view':'reading-general'});root.append(host);let busy=false;
 // Original page: legacy page / setsPage links are normalised to the first page of the same filters.
 if(url.searchParams.has('page')||url.searchParams.has('setsPage')){
  const keep=new URLSearchParams();for(const key of ['q','topic','type','status'])if(url.searchParams.get(key))keep.set(key,url.searchParams.get(key));
  void navigate(`/app/reading/general${keep.size?`?${keep}`:''}`,{replace:true});return;
 }
 const lang=locale==='uz'?'uz':'en';
 async function load(){
  if(busy||signal.aborted)return;busy=true;
  host.replaceChildren(el('div',{'aria-busy':'true','data-async-loading':'reading-library',class:'flex flex-col gap-4'},el('div',{class:'h-5 w-40 animate-pulse rounded bg-ink-50'}),[0,1,2].map(()=>el('div',{class:'h-36 animate-pulse rounded-xl bg-ink-50'}))));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const data=readingGeneralLibraryDTO(raw);
   host.replaceChildren(el('div',{class:'flex w-full min-w-0 flex-col gap-5','data-general-reading-index':true},
    el('p',{class:'body-text'},dict.generalReading.subtitle),
    el('section',{class:'flex flex-col gap-5','data-reading-library':true},
     el('h2',{class:'sr-only'},dict.readingHub.library),
     data.facetsUnavailable?RegionFailureNotice({region:'reading-library-facets',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}):null,
     filters(context,data),
     data.libraryUnavailable?RegionFailureNotice({region:'reading-library',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}):cards(context,data,lang))));
  }catch(e){
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'reading-general',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
const hrefWith=(pathname,current,tab,next)=>{const search=new URLSearchParams(tab?{tab}:{});const merged={...current,...next};if(merged.status)search.set('status',merged.status);if(merged.topic)search.set('topic',merged.topic);if(merged.type)search.set('type',merged.type);if(merged.query)search.set('q',merged.query);const qs=search.toString();return qs?`${pathname}?${qs}`:pathname;};
/** A replace-navigation link, as the original Link with `replace`. */
function replaceLink(context,href,props,children){const a=el('a',{href,...props},children);a.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();void context.navigate(href,{replace:true,scroll:false});},{signal:context.signal});return a;}
function filters(context,data){
 const {dict,url,signal}=context,current={status:data.filter.status??'',topic:data.filter.topic??'',type:data.filter.type??'',query:data.filter.query??''};
 const pathname=url.pathname;const topics=data.facets.topics.map(t=>({...t,label:topicLabel(t.code,context.locale==='uz'?'uz':'en')??t.code}));
 const types=data.facets.types.map(t=>({...t,label:questionTypeLabel(t.code,context.locale==='uz'?'uz':'en')??t.code}));
 const panel=el('div',{class:'panel relative z-20 flex flex-col gap-4','data-reading-filters':true});
 let query=current.query,draft=current.query,timer=null;
 const search=(value,immediate=false)=>{draft=value;query=value;clearTimeout(timer);const commit=()=>void context.navigate(hrefWith(pathname,current,null,{query:value.trim()}),{replace:true,scroll:false});if(immediate||!value.trim())commit();else timer=setTimeout(commit,300);};
 const input=el('input',{class:'input h-[var(--control-h)]',type:'search',name:'q',value:query,'data-reading-search':true,placeholder:dict.readingHub.searchPlaceholder});
 input.addEventListener('input',()=>search(input.value),{signal});
 const form=el('form',{class:'flex w-full flex-col gap-1.5',role:'search'},
  el('label',{class:'flex flex-col gap-1.5'},el('span',{class:'field-label'},dict.readingHub.library),input),
  el('div',{class:'flex items-center gap-2'},replaceLink(context,hrefWith(pathname,current,null,{query:query.trim()}),{class:'btn-secondary h-[var(--control-h-sm)]','data-reading-search-submit':true},dict.shell.search),
   query.trim()!==''?(()=>{const b=el('button',{type:'button',class:'btn-ghost h-[var(--control-h-sm)]','data-reading-search-clear':true},dict.shell.clear);b.addEventListener('click',()=>search('',true),{signal});return b;})():null));
 form.addEventListener('submit',e=>{e.preventDefault();search(input.value,true);});
 panel.append(form);
 const statusOptions=[{value:'',label:dict.readingHub.filterAll},{value:'passage1',label:dict.readingHub.filterPassage.replace('{n}','1')},{value:'passage2',label:dict.readingHub.filterPassage.replace('{n}','2')},{value:'passage3',label:dict.readingHub.filterPassage.replace('{n}','3')},{value:'not_started',label:dict.readingHub.filterNotStarted},{value:'in_progress',label:dict.readingHub.filterInProgress},{value:'completed',label:dict.readingHub.filterCompleted}];
 const hasFilters=Boolean(current.status||current.topic||current.type||current.query);
 panel.append(el('div',{class:'flex flex-wrap items-center gap-2'},el('span',{class:'field-label mr-1'},dict.readingHub.filterStatus),
  statusOptions.map(option=>replaceLink(context,hrefWith(pathname,current,null,{status:option.value}),{class:current.status===option.value?'chip chip-active':'chip','data-reading-status':option.value||'all','aria-pressed':String(current.status===option.value)},option.label)),
  hasFilters?replaceLink(context,pathname,{class:'btn-ghost ml-auto h-[var(--control-h-sm)]','data-reading-reset':true},dict.readingHub.filterReset):null));
 const dropdowns=[];
 function dropdown(kind,label,items,allLabel,selectedCode,attrs){
  const details=el('details',{class:`dropdown w-full sm:w-auto`,'data-reading-filter':kind});dropdowns.push(details);
  details.addEventListener('click',e=>closeDropdownAfterSelection(details,e.target),{signal});
  const selected=items.find(i=>i.code===selectedCode)?.label??allLabel;
  const menu=el('ul',{class:kind==='type'?'dropdown-menu dropdown-menu-wide':'dropdown-menu',role:'listbox'},
   el('li',{},replaceLink(context,hrefWith(pathname,current,null,{[kind]:''}),{class:'dropdown-item',[attrs.option]:''},allLabel)),
   items.map(item=>el('li',{},replaceLink(context,hrefWith(pathname,current,null,{[kind]:item.code}),{class:item.code===selectedCode?'dropdown-item dropdown-item-active':'dropdown-item',[attrs.option]:item.code,'aria-current':item.code===selectedCode?'true':null},item.label,el('span',{class:'dropdown-count'},String(item.count))))));
  details.append(el('summary',{class:'input flex min-h-[var(--control-h)] cursor-pointer items-center justify-between gap-2'},el('span',{},selected),el('span',{'aria-hidden':'true',class:'text-ink-300'},'▾')),menu);
  return el('div',{class:'flex w-full flex-col gap-1.5 sm:w-auto'},el('span',{class:'field-label'},label),details);
 }
 panel.append(el('div',{class:'flex flex-wrap items-start gap-3'},
  dropdown('topic',dict.readingHub.filterTopic,topics,dict.readingHub.filterTopicAll,current.topic,{option:'data-reading-topic-option'}),
  dropdown('type',dict.readingHub.filterType,types,dict.readingHub.filterTypeAll,current.type,{option:'data-reading-type-option'})));
 const onKey=e=>closeReadingDropdownsOnEscape(e,dropdowns);const onPointer=e=>closeReadingDropdownsOutside(dropdowns,e.target);
 document.addEventListener('keydown',onKey,{signal});document.addEventListener('pointerdown',onPointer,{signal});
 return panel;
}
function cards(context,data,lang){
 const {dict,url}=context,lib=data.library,filter=data.filter;
 const buildPageHref=page=>{const search=new URLSearchParams();for(const [key,value] of Object.entries({...filter,page})){if(value&&key!=='page')search.set(key==='query'?'q':key,String(value));}if(page>1)search.set('page',String(page));return search.toString()?`/app/reading/general?${search}`:'/app/reading/general';};
 const out=[el('p',{class:'meta-text','data-reading-count':true},dict.readingHub.resultsCount.replace('{n}',String(lib.total)))];
 if(lib.items.length===0)out.push(el('div',{class:'flex flex-col items-center gap-2 py-10 text-center'},el('p',{class:'font-display text-ink-900'},dict.readingHub.noResults),el('p',{class:'body-text'},dict.readingHub.noResultsHint),el('a',{class:'btn-secondary',href:'/app/reading/general','data-reading-empty-reset':true},dict.readingHub.filterReset)));
 else out.push(el('div',{class:'grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'},lib.items.map(passage=>passageCard(context,passage,lang))));
 if(lib.pageCount>1)out.push(el('nav',{class:'flex flex-wrap items-center justify-between gap-3','aria-label':dict.readingHub.page},
  el('span',{class:'meta-text','data-reading-page':true},`${dict.readingHub.page} ${lib.page} / ${lib.pageCount}`),
  el('div',{class:'flex items-center gap-2'},lib.page>1?el('a',{class:'btn-secondary',href:buildPageHref(lib.page-1),'data-reading-page-prev':true},dict.readingHub.prevPage):null,lib.page<lib.pageCount?el('a',{class:'btn-secondary',href:buildPageHref(lib.page+1),'data-reading-page-next':true},dict.readingHub.nextPage):null)));
 void url;
 return out;
}
/** Original ReadingPassageCard: what it is, how big, and what has been done (never a status without its cause). */
function passageCard(context,passage,lang){
 const {dict}=context;
 const statusLabel=passage.status==='completed'?dict.readingHub.stateCompleted:passage.status==='in_progress'?dict.readingHub.stateInProgress:dict.readingHub.stateNotStarted;
 const action=passage.status==='completed'?dict.readingHub.actionRetry:dict.readingHub.actionStart;
 const topic=topicLabel(passage.topicCode,lang);
 let actionNode;
 if(passage.setId)actionNode=el('a',{class:'btn-primary',href:`/app/reading/general/${passage.setId}?passage=${passage.passageNo}`},passage.status==='in_progress'?dict.readingHub.actionResume:action);
 else if(passage.status==='in_progress'&&passage.lastAttemptId)actionNode=el('a',{class:'btn-primary min-h-[var(--control-h)]',href:`/app/reading/attempts/${passage.lastAttemptId}`,'data-passage-action':'resume'},dict.readingHub.actionResume);
 else actionNode=startPassageButton(context,{passageId:passage.id,label:action});
 return el('article',{class:'panel flex h-full flex-col gap-3','data-passage':passage.id,'data-passage-status':passage.status},
  el('div',{class:'flex items-start justify-between gap-3'},
   el('span',{'aria-hidden':'true',class:'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-100 bg-paper-sunken text-[20px] text-gold'},IconReading({})),
   answerProgress({state:passage.status,done:passage.answeredCount,total:passage.questionCount,label:statusLabel,attrs:{'data-passage-state':passage.status}})),
  el('h3',{class:'card-title leading-snug'},passage.title),
  el('dl',{class:'flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-500'},
   passage.passageNo?el('dd',{},`Passage ${passage.passageNo}`):null,
   el('dd',{},dict.readingHub.questionsShort.replace('{n}',String(passage.questionCount))),
   el('dd',{},`${passage.suggestedMinutes} ${dict.reading.minutes}`),
   topic?el('dd',{},topic):null),
  passage.questionTypes?.length?el('ul',{class:'flex flex-wrap gap-1.5','data-passage-question-types':true},passage.questionTypes.map(type=>el('li',{class:'rounded-md border border-ink-100 bg-paper-sunken px-2 py-1 text-xs text-ink-700'},questionTypeLabel(type,lang)??type))):null,
  passage.status==='completed'&&passage.lastScore!==null?el('p',{class:'text-[0.875rem] text-ink-700','data-passage-score':true},dict.readingHub.scoreShort.replace('{score}',String(passage.lastScore)).replace('{total}',String(passage.questionCount))):null,
  el('div',{class:'mt-auto flex items-center justify-between gap-3 pt-1'},actionNode,
   passage.status==='completed'?el('a',{href:'/app/reading/history',class:'inline-flex items-center gap-1 text-[0.875rem] font-medium text-ink-500 hover:text-ink-900'},dict.reading.historyTitle,IconChevronRight({class:'text-[15px]'})):null));
}
