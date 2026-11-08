import {plainPrimaryClick} from '../../js/return-navigation.js';

/** The source owns exit confirmation and checkpointing. The shell only asks it to return. */
export function activityBack({host,signal,active,back}){
 const click=event=>{
  if(signal.aborted||!host.isConnected||!active()||!plainPrimaryClick(event)||!event.target.closest?.('[data-campus-back-link]'))return;
  event.preventDefault();event.stopImmediatePropagation();back();
 };
 document.addEventListener('click',click,true);
 signal.addEventListener('abort',()=>document.removeEventListener('click',click,true),{once:true});
}

function brandHeader(){
 const update=()=>{for(const header of document.querySelectorAll('.exam-header')){
  const old=header.querySelector('.exam-logo')?.parentElement,brand=header.querySelector('.exam-telegram-brand');
  if(old&&old!==header&&!old.querySelector('button,input,a'))old.remove();
  if(brand&&brand.parentElement!==header)header.prepend(brand);
 }};
 document.addEventListener('DOMContentLoaded',()=>{update();const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});addEventListener('pagehide',()=>observer.disconnect(),{once:true});});
}
export const authoredHeader=()=>`(${brandHeader.toString()})();`;
