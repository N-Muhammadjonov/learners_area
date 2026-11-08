import {el} from '../dom.js';
/** Shared brand mark for login, header, app shell and dashboard. */
export function brandBlock(className='',size=44,withTagline=true){
 return el('span',{'data-sidebar-brand':'',class:`flex items-center gap-3 ${className}`},
  el('span',{class:'brand-mark',style:{width:size+'px',height:size+'px',display:'inline-grid',placeItems:'center',overflow:'visible'}},
   el('img',{src:'/brand/learners-area-la-glass.svg',width:size,height:size,alt:'', 'aria-hidden':'true',decoding:'async',fetchpriority:'high',style:{width:'100%',height:'100%',objectFit:'contain'}})),
  el('span',{class:'flex min-w-0 flex-col'},el('span',{class:'brand-name'},'Learners Area'),
   withTagline?el('span',{class:'brand-tagline'},'Take your learning journey with us'):null));
}
