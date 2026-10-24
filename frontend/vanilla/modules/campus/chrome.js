import {el} from '../../js/dom.js';
import {brandBlock} from '../../js/components/brand.js';

/** Main is the campus. Every nested workspace has one return link. */
export function campusHeader(header){
 const brand=el('a',{href:'/app','data-campus-topbar-brand':'','aria-label':'Learners Area'},brandBlock('',36,true));
 const back=el('a',{href:'/app','data-campus-main-link':'','aria-label':'Main',class:'btn-secondary'},el('span',{'aria-hidden':'true'},'←'),'Main');
 header.prepend(brand,back);
 return {update(url){
  const campus=url.pathname.replace(/\/+$/,'')==='/app';
  header.dataset.campusHome=String(campus);
  brand.hidden=!campus;back.hidden=campus;
  if(campus)back.removeAttribute('data-back-to-campus');else back.setAttribute('data-back-to-campus','');
 }};
}
