import {h,fragment} from '../../js/native.js';
import {navigationLinks} from '../../js/generated/module-navigation.js';
import {render as sectionNav} from '../../js/generated/module-section-nav.js';
import {render as sectionHeading} from '../../js/generated/listening-section-heading.js';
/** Native counterpart of the three source layouts used by existing candidates.
 * Links to unimplemented sections remain real URLs, NOT completed destinations. */
export function moduleLayout(context,children){const {url,dict,signal,navigate}=context,module=url.pathname.split('/')[2];if(!['listening','reading','grammar','vocabulary'].includes(module))return fragment({children});
 const refs={current:[]},nav=sectionNav({module,label:dict.nav[module],links:navigationLinks({module,dict}),pathname:url.pathname,query:url.searchParams,refs});
 if(nav){refs.current=[...nav.querySelectorAll('a')];nav.addEventListener('click',e=>{if(signal.aborted||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download'))return;e.preventDefault();void navigate(a.getAttribute('href'),{scroll:false});});}
 const titles=module==='listening'?Object.fromEntries(['lessons','academic','general','mcq'].map(k=>[k,dict.listening[k==='mcq'?'mcqProgram':k].title])):null;
 return h('div',{className:'mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5','data-module-layout':module},titles?sectionHeading({titles,pathname:url.pathname}):null,nav,children);
}
