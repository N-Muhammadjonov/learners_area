import {returnForWindow} from './return-policy.js';
import {plainPrimaryClick} from '../../js/return-navigation.js';
import {el} from '../../js/dom.js';
import {brandBlock} from '../../js/components/brand.js';

/** Main is the campus. Every nested workspace has one return link. */
export function campusHeader(header,{dict,back:goBack,signal}={}){
 const brand=el('a',{href:'/app','data-campus-topbar-brand':'','aria-label':'Learners Area'},brandBlock('',36,true));
 const back=el('a',{href:'/app','data-campus-main-link':'','aria-label':'Main',class:'btn-secondary'},el('span',{'aria-hidden':'true'},'←'),'Main');
 back.addEventListener('click',event=>{if(!back.hasAttribute('data-campus-back-link')||!plainPrimaryClick(event)||!goBack)return;event.preventDefault();goBack(back.getAttribute('href'));},{signal});
 const name=el('span',{'data-campus-module-name':'','aria-current':'location'});
 header.prepend(brand,back,name);
 return {update(url){
  const policy=returnForWindow(url),campus=policy.mode==='hidden';
  back.href=policy.href;back.toggleAttribute('data-campus-back-link',policy.mode==='back');back.toggleAttribute('data-campus-main-link',policy.mode==='main');back.setAttribute('data-campus-return-link',policy.mode);back.setAttribute('aria-label',policy.mode==='back'?(dict?.common?.back??'Back'):'Main');back.title=back.getAttribute('aria-label');back.replaceChildren(el('span',{'aria-hidden':'true'},'←'),...(policy.mode==='main'?['Main']:[el('span',{class:'native-return-label','aria-hidden':'true'},'Back')]));
  header.dataset.campusHome=String(campus);
  brand.hidden=!campus;back.hidden=campus;name.hidden=campus;
  const segment=url.pathname.split('/')[2],keys={'video-lessons':'videoLessons',mocks:'mockTests','live-classes':'liveClasses',admin:'management',teacher:'management',owner:'management'};
  name.textContent=segment==='riwi'?'RIWI':segment==='profile'?dict?.profile?.title:dict?.nav?.[keys[segment]||segment]||segment||'';
  name.title=name.textContent;
  back.toggleAttribute('data-back-to-campus',policy.mode==='main');
 }};
}
