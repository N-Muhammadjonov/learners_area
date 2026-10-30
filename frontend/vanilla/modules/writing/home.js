import {el,button,WRITING_TABS,viewRegion,navBack,state,safeArray,d} from './shared.js';
const moduleFor={lessons:'./lessons.js',exam:'./exam.js',translation:'./translation.js',typing:'./typing.js',grade:'./grade.js',activation:'./activation.js','language-stealing':'./stealing.js'};
/** Original src/app/app/(shell)/writing/page.tsx & WritingNav: eight URL-backed tabs. */
export function mount(ctx){
 const {root,dict,signal,url}=ctx;
 if(url.searchParams.get('tab')==='topic-vocabulary'){void ctx.navigate('/app/writing?tab=language-stealing',{replace:true,scroll:false});return;}
 let current=WRITING_TABS.includes(url.searchParams.get('tab'))?url.searchParams.get('tab'):'lessons';
 const host=el('main',{class:'mx-auto flex max-w-6xl flex-col gap-5','data-writing-native':'','data-route-usable':'writing','data-writing-active-tab':current});root.append(host);
 const nav=el('div',{role:'tablist','aria-label':dict.writingWorkspace?.tabsLabel??dict.writingWorkspace?.title??'Writing',class:'-mx-1 flex gap-1 overflow-x-auto border-b border-ink-100 px-1','data-writing-tablist':''});
 const panel=el('section',{role:'tabpanel',id:'writing-panel','aria-labelledby':`writing-tab-${current}`,class:'motion-tab-panel'});
 const labels=dict.writingWorkspace?.tabs??dict.writingWorkspace?.nav??{},buttons=new Map();let child,revision=0;
 WRITING_TABS.forEach((tab,i)=>{
  const b=button(d(labels,tab,d(dict,`writingWorkspace.${tab}.title`,tab)),()=>{if(tab!==current)void ctx.navigate(`/app/writing?tab=${encodeURIComponent(tab)}`,{scroll:false,focus:'[data-writing-tab="'+tab+'"]'});},{cls:'min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors '+(tab===current?'border-signal-600 text-ink-900 dark:border-signal-400':'border-transparent text-ink-500 hover:text-ink-900'),signal,attrs:{id:`writing-tab-${tab}`,role:'tab','aria-selected':tab===current?'true':'false','aria-controls':'writing-panel',tabindex:tab===current?'0':'-1','data-writing-tab':tab,'data-navigation-route':'/app/writing?tab='+tab}});
  b.addEventListener('keydown',e=>{let next=null;if(e.key==='ArrowRight')next=(i+1)%WRITING_TABS.length;if(e.key==='ArrowLeft')next=(i+WRITING_TABS.length-1)%WRITING_TABS.length;if(e.key==='Home')next=0;if(e.key==='End')next=WRITING_TABS.length-1;if(next===null)return;e.preventDefault();void ctx.navigate(`/app/writing?tab=${encodeURIComponent(WRITING_TABS[next])}`,{scroll:false,focus:'[data-writing-tab="'+WRITING_TABS[next]+'"]'});},{signal});nav.append(b);buttons.set(tab,b);
 });
 host.append(nav,panel);
 function select(next){
  const preserve=current===next.searchParams.get('tab')&&current==='language-stealing',scrollHost=document.querySelector('[data-shell-main]'),savedScroll=scrollHost?.scrollTop??0;if(preserve)panel.style.minHeight=panel.getBoundingClientRect().height+'px';
  const tab=WRITING_TABS.includes(next.searchParams.get('tab'))?next.searchParams.get('tab'):'lessons';current=tab;ctx.url=next;host.dataset.writingActiveTab=tab;panel.setAttribute('aria-labelledby','writing-tab-'+tab);
  for(const [key,b] of buttons){const active=key===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;b.className='min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors '+(active?'border-signal-600 text-ink-900 dark:border-signal-400':'border-transparent text-ink-500 hover:text-ink-900');}
  child?.abort('writing-tab-left');child=new window.AbortController();const own=child,token=++revision;
  panel.replaceChildren(state(dict.common.loading));
  void import(moduleFor[tab]).then(async module=>{if(signal.aborted||own.signal.aborted||token!==revision)return;const staging=el('div');if(module.mountTab)await module.mountTab({...ctx,url:next,signal:own.signal,onRegionReady:()=>{panel.style.minHeight='';if(preserve&&scrollHost)scrollHost.scrollTop=savedScroll;}},staging);else staging.append(state(dict.common.error));if(signal.aborted||own.signal.aborted||token!==revision)return;panel.replaceChildren(...staging.childNodes);}).catch(()=>{if(!signal.aborted&&!own.signal.aborted&&token===revision)panel.replaceChildren(state(dict.common.error,'alert'),button(dict.errorPage.retry,()=>window.location.reload(),{signal,cls:'btn-secondary'}));});
 }
 const switchTab=next=>{if(signal.aborted||next.pathname!=='/app/writing'||ctx.session?.expiresAt&&ctx.session.expiresAt*1000<=Date.now())return false;select(next);return true;};
 ctx.onNavigate?.(switchTab);ctx.onHistory?.(switchTab);
 signal.addEventListener('abort',()=>child?.abort('writing-left'),{once:true});select(url);
}
