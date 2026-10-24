import {el} from '../../js/dom.js';
import {brandBlock} from '../../js/components/brand.js';

/** Preserve the destination branch's map and Main navigation in the native shell. */
export function campusHeader(header,context){
 const children=[...header.children];
 ['heading','search','preferences','profile'].forEach((name,i)=>{if(children[i])children[i].setAttribute('data-campus-header-'+name,'');});
 const brand=el('a',{href:'/app','data-campus-topbar-brand':'','aria-label':'Learners Area'},brandBlock('',36,true));
 const back=el('a',{href:'/app','data-campus-main-link':'','data-back-to-campus':'','aria-label':'Main',class:'btn-secondary'},el('span',{'aria-hidden':'true'},'←'),'Main');
 header.prepend(brand);header.append(back);
 return {update(url){
  const path=url.pathname.replace(/\/+$/,'');
  brand.hidden=path!=='/app';
  back.hidden=!path.startsWith('/app/')||/^\/app\/(management|teacher|admin|owner)(?:\/|$)/.test(path);
  if(back.hidden)back.removeAttribute('data-back-to-campus');else back.setAttribute('data-back-to-campus','');
 }};
}

