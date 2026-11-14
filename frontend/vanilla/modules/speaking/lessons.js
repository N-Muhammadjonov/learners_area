import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {materialPlayer,blockRenderer,stopMedia} from './media.js';
import {RegionFailureNotice,BackLink} from '../shared/presentation.js';
/** Source: src/app/app/(shell)/speaking/lessons/page.tsx.
 * The projected view is an existing frontend boundary, not a request for a new API. */
const ORDER=['part1','part2','part3','general','top_structures'];
function requirePayload(value){
 if(!value||value.kind!=='speaking_materials'||!Array.isArray(value.rows))throw Error('speaking_materials_missing');
 for(const entry of value.rows){if(!entry?.material||typeof entry.material.id!=='string'||typeof entry.material.category!=='string'||typeof entry.material.title!=='string')throw Error('material_invalid');}
 return value;
}
export function mount(context){
 const {root,dict,signal,url}=context,t=dict.speaking,host=el('div',{class:'mx-auto flex max-w-3xl flex-col gap-6','data-route-usable':'speaking-lessons'});
 root.append(host);let busy=false;
 const skeleton=()=>el('div',{'data-speaking-materials-skeleton':'','data-async-loading':'speaking-materials',class:'flex flex-col gap-4'},
  [0,1,2].map(()=>el('div',{class:'h-36 animate-pulse rounded-xl bg-ink-50','aria-hidden':'true'})));
 async function load(){
  if(signal.aborted||busy)return;busy=true;stopMedia(host);
  host.replaceChildren(BackLink({fallbackHref:'/app/speaking',label:dict.common.back}),
   el('header',{},el('h1',{class:'font-display text-2xl text-ink-900'},dict.speakingHub.lessonsTitle),el('p',{class:'mt-1 text-base text-ink-500'},dict.speakingHub.lessonsBody)),skeleton());
  try{
   const payload=requirePayload(await viewData(url.pathname+url.search,signal));if(signal.aborted)return;
   const rows=payload.rows.filter(x=>ORDER.includes(x.material.category));const groups=new Map();
   for(const entry of rows){const cat=entry.material.category;if(!ORDER.includes(cat))continue;const list=groups.get(cat)??[];list.push(entry);groups.set(cat,list);}
   const region=el('div',{'data-speaking-materials':'','data-async-content':'speaking-materials'});
   if(rows.length===0)region.append(el('section',{class:'card flex flex-col gap-2 p-6'},el('p',{},'🎙'),el('h2',{class:'font-display text-lg'},dict.speakingHub.lessonsEmptyTitle),el('p',{class:'text-ink-500'},dict.speakingHub.lessonsEmptyBody)));
   if(payload.blocksUnavailable)region.append(RegionFailureNotice({region:'speaking-material-blocks',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}));
   for(const category of ORDER){if(!groups.has(category))continue;
    const group=el('section',{class:'mb-8'},el('h2',{class:'mb-3 font-display text-lg text-ink-900'},t.category[category]));
    const list=el('div',{class:'flex flex-col gap-4'});
    for(const entry of groups.get(category)){
     const m=entry.material;
     const card=el('article',{id:`material-${m.id}`,class:'card flex scroll-mt-40 flex-col gap-3'},el('h3',{class:'text-sm font-medium text-ink-900'},m.title),
      materialPlayer({url:m.primaryUrl,type:m.primaryType,openLabel:t.openMaterial,emptyLabel:t.noFileYet}));
     if(Array.isArray(entry.blocks)&&entry.blocks.length){const b=el('div',{class:'flex flex-col gap-3 border-t border-ink-100 pt-3'});for(const block of entry.blocks){const rendered=blockRenderer(block,dict);if(rendered)b.append(rendered);}card.append(b);}
     list.append(card);
    }
    group.append(list);region.append(group);
   }
   host.lastElementChild.replaceWith(region);
  }catch(e){if(signal.aborted)return;host.lastElementChild.replaceWith(RegionFailureNotice({region:'speaking-materials',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:load}));}
  finally{busy=false;}
 }
 signal.addEventListener('abort',()=>stopMedia(host),{once:true});void load();
}
