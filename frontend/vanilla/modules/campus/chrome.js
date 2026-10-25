import {el} from '../../js/dom.js';
import {brandBlock} from '../../js/components/brand.js';

/** Main is the campus. Every nested workspace has one return link. */
export function campusHeader(header,{dict}={}){
 const brand=el('a',{href:'/app','data-campus-topbar-brand':'','aria-label':'Learners Area'},brandBlock('',36,true));
 const back=el('a',{href:'/app','data-campus-main-link':'','aria-label':'Main',class:'btn-secondary'},el('span',{'aria-hidden':'true'},'←'),'Main');
 const name=el('span',{'data-campus-module-name':'','aria-current':'location'});
 header.prepend(brand,back,name);
 return {update(url){
  const campus=url.pathname.replace(/\/+$/,'')==='/app';
  header.dataset.campusHome=String(campus);
  brand.hidden=!campus;back.hidden=campus;name.hidden=campus;
  const segment=url.pathname.split('/')[2],keys={'video-lessons':'videoLessons',mocks:'mockTests','live-classes':'liveClasses',admin:'management',teacher:'management',owner:'management'};
  name.textContent=segment==='profile'?dict?.profile?.title:dict?.nav?.[keys[segment]||segment]||segment||'';
  name.title=name.textContent;
  if(campus)back.removeAttribute('data-back-to-campus');else back.setAttribute('data-back-to-campus','');
 }};
}
