import {el} from '../dom.js';
export function brandBlock(className='',size=44){
 return el('span',{'data-sidebar-brand':'',class:`flex items-center gap-3 ${className}`},
 el('span',{class:'brand-mark',style:{width:size+'px',height:size+'px'}},
 ...[['day','owner-neon-day',48,48,'light'],['night','owner-v11-night',48,36,'dark']].map(([,file,width,height,theme])=>el('img',{src:`/brand/derived/${file}-96.png`,srcset:`/brand/derived/${file}-96.png 1x, /brand/derived/${file}-192.png 2x`,width,height,alt:'','aria-hidden':'true',decoding:'async',fetchpriority:'high',class:`brand-asset-${theme}`}))),
 el('span',{class:'flex min-w-0 flex-col'},el('span',{class:'brand-name'},'Learners Area'),el('span',{class:'brand-tagline'},'Take your learning journey with us')));
}
