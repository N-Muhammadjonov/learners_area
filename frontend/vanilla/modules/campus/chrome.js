import {returnForWindow} from './return-policy.js';
import {plainPrimaryClick} from '../../js/return-navigation.js';
import {el} from '../../js/dom.js';
import {brandBlock} from '../../js/components/brand.js';

/** Module roots use the Dock. Details keep their existing Back destination. */
export function campusHeader(header,{dict,back:goBack,signal}={}){
 const brand=el('div',{'data-campus-topbar-brand':''},brandBlock('',44,true));
 const back=el('a',{href:'/app','data-campus-back-link':'','aria-label':dict?.common?.back??'Back',class:'btn-secondary'},el('span',{'aria-hidden':'true'},'←'),el('span',{class:'native-return-label','aria-hidden':'true'},'Back'));
 back.addEventListener('click',event=>{if(!back.hasAttribute('data-campus-back-link')||!plainPrimaryClick(event)||!goBack)return;event.preventDefault();goBack(back.getAttribute('href'));},{signal});
 const name=el('span',{'data-campus-module-name':'','aria-current':'location'});
 const sectionTitle=el('div',{'data-campus-section-title':'',hidden:true});
 const identity=el('div',{'data-campus-header-identity':''},brand,back,name,sectionTitle);
 header.prepend(identity);
 return {sectionTitle,name,update(url){
  const policy=returnForWindow(url),campus=['/app','/app/dashboard'].includes(url.pathname);
  back.href=policy.href;back.setAttribute('data-campus-return-link',policy.mode);back.title=back.getAttribute('aria-label');
  header.dataset.campusHome=String(campus);
  brand.hidden=!campus;back.hidden=policy.mode!=='back';name.hidden=campus;
  const segment=url.pathname==='/app/study-plan/leaderboard'?'leaderboard':url.pathname.split('/')[2],keys={'video-lessons':'videoLessons',mocks:'mockTests','live-classes':'liveClasses',admin:'management',teacher:'management',owner:'management'};
  name.textContent=segment==='leaderboard'?(dict?.nav?.leaderboard??(dict?.common?.back==='Back'?'Leaderboard':'Reyting')):segment==='riwi'?'RIWI':segment==='profile'?dict?.profile?.title:dict?.nav?.[keys[segment]||segment]||segment||'';
  name.title=name.textContent;
 }};
}
