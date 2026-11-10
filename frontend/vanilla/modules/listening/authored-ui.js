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

export function positionExamBrand(root){
 for(const header of root.querySelectorAll('.exam-header')){
  const label=header.querySelector('.exam-logo')?.parentElement,brand=header.querySelector('.exam-telegram-brand');
  if(label&&label!==header&&!label.querySelector('button,input,a'))label.remove();
  if(brand&&brand.parentElement!==header)header.prepend(brand);
 }
}

export const authoredHeader=()=>`(()=>{const update=()=> (${positionExamBrand.toString()})(document);
 document.addEventListener('DOMContentLoaded',()=>{
  update();const observer=new MutationObserver(update);
  observer.observe(document.body,{childList:true,subtree:true});
  addEventListener('pagehide',()=>observer.disconnect(),{once:true});
 });
 })();`;
