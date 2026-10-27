import {el} from '../../js/dom.js';
import {clickableText} from '../vocabulary/clickable-text.js';
import {safeExternalUrl,safeObjectKey} from './contract.js';
/** Read-only student ResourceBlocks presentation. R2 object keys always pass through authenticated /api/resources/. */
export function resourceBlocks(context,blocks){
 const {dict}=context;
 if(!Array.isArray(blocks)||!blocks.length)return null;
 const t=dict.resources,items=[];
 for(const b of blocks){if(!b||typeof b!=='object'||typeof b.id!=='string')continue;
  let child=null;
  if(b.type==='text')child=clickableText(context,{text:String(b.textContent??''),sourceType:'material',sourceId:b.id,lexicalAssistance:true,className:'text-sm leading-relaxed text-ink-700'}).node;
  else if(b.type==='link'&&safeExternalUrl(b.linkUrl))child=el('a',{href:safeExternalUrl(b.linkUrl),target:'_blank',rel:'noopener noreferrer',class:'btn-secondary'},b.originalName??t.openLink);
  else if(['image','audio','file'].includes(b.type)&&safeObjectKey(b.objectKey)){
    const url='/api/resources/'+safeObjectKey(b.objectKey);
    if(b.type==='image'){const writing=context.url?.pathname.startsWith('/app/writing');const image=el('img',{src:url,alt:b.originalName??t.blockImage,class:writing?'writing-original-image rounded-sm border border-ink-100':'max-h-80 w-auto rounded-sm border border-ink-100',loading:'lazy',decoding:'async'});child=writing?el('a',{href:url,target:'_blank',rel:'noopener noreferrer','data-writing-original-image':'',class:'writing-image-link'},image,el('span',{class:'text-sm underline'},context.locale==='uz'?'Asl o‘lchamda ochish':'Open original size')):image;}
    if(b.type==='audio')child=el('div',{class:'flex flex-col gap-1'},el('span',{class:'text-xs text-ink-300'},b.originalName??''),el('audio',{src:url,controls:true,preload:'none',class:'w-full'},t.blockAudio));
    if(b.type==='file')child=el('a',{href:url,class:'btn-secondary'},`${b.originalName??t.download} — ${t.download}`);
  }
  if(child)items.push(el('li',{'data-resource-block':b.type,class:'flex flex-col gap-1.5'},child));
 }
 if(!items.length)return null;
 return el('section',{class:'card flex flex-col gap-3 p-5','data-resource-blocks':''},el('h2',{class:'card-title'},t.studentsTitle),el('ul',{class:'flex flex-col gap-3'},items));
}
