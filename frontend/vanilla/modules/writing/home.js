import {el,button,WRITING_TABS,viewRegion,navBack,state,safeArray,d} from './shared.js';
const moduleFor={lessons:'./lessons.js',exam:'./exam.js',translation:'./translation.js',typing:'./typing.js','topic-vocabulary':'./topic.js',grade:'./grade.js',activation:'./activation.js','language-stealing':'./stealing.js'};
/** Original src/app/app/(shell)/writing/page.tsx & WritingNav: eight URL-backed tabs. */
export function mount(ctx){
 const {root,dict,signal,url}=ctx;
 const current=WRITING_TABS.includes(url.searchParams.get('tab'))?url.searchParams.get('tab'):'lessons';
 const host=el('main',{class:'mx-auto flex max-w-6xl flex-col gap-5','data-writing-native':'','data-route-usable':'writing','data-writing-active-tab':current});root.append(host);
 const nav=el('div',{role:'tablist','aria-label':dict.writingWorkspace?.tabsLabel??dict.writingWorkspace?.title??'Writing',class:'writing-tabs','data-writing-tablist':''});
 const panel=el('section',{role:'tabpanel',id:'writing-panel','aria-labelledby':`writing-tab-${current}`,class:'motion-tab-panel'});
 const labels=dict.writingWorkspace?.tabs??dict.writingWorkspace?.nav??{};
 WRITING_TABS.forEach((tab,i)=>{
  const b=button(d(labels,tab,d(dict,`writingWorkspace.${tab}.title`,tab)),()=>{if(tab!==current)void ctx.navigate(`/app/writing?tab=${encodeURIComponent(tab)}`);},{cls:'',signal,attrs:{id:`writing-tab-${tab}`,role:'tab','aria-selected':tab===current?'true':'false','aria-controls':'writing-panel',tabindex:tab===current?'0':'-1','data-writing-tab':tab}});
  b.addEventListener('keydown',e=>{let next=null;if(e.key==='ArrowRight')next=(i+1)%WRITING_TABS.length;if(e.key==='ArrowLeft')next=(i+WRITING_TABS.length-1)%WRITING_TABS.length;if(e.key==='Home')next=0;if(e.key==='End')next=WRITING_TABS.length-1;if(next===null)return;e.preventDefault();void ctx.navigate(`/app/writing?tab=${encodeURIComponent(WRITING_TABS[next])}`);},{signal});nav.append(b);
 });
 host.append(nav,panel);
 const modulePath=moduleFor[current];
 void import(modulePath).then(module=>{if(signal.aborted)return;if(module.mountTab)module.mountTab(ctx,panel);else panel.append(state(dict.common.error));}).catch(()=>{if(!signal.aborted)panel.replaceChildren(state(dict.common.error,'alert'));});
}
