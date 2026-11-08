import {el} from '../dom.js';
import {brandBlock} from './brand.js';
import {controls} from './controls.js';
import {landscape} from './landscape.js';
import marks from './marks.js';
function loginSkillIcons(){
 const orbit=el('div',{class:'la-welcome-orbit la-login-skills','aria-hidden':'true'});
 ['listening','reading','writing','speaking','grammar','vocabulary'].forEach((kind,i)=>{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 32 32',width:'28',height:'28',fill:'none',stroke:'currentColor','stroke-width':'1.9','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'}))svg.setAttribute(key,value);
  const template=document.createElement('template');template.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg">${marks[kind]}</svg>`;
  for(const child of [...template.content.firstElementChild.children])svg.append(child);
  orbit.append(el('span',{class:`la-welcome-chip la-welcome-chip-${i}`},el('span',{class:'module-emoji'},svg)));
 });return orbit;
}
export function authShell(context,{title,subtitle,children,footer}){
 const {dict,signal}=context,style=document.createElement('link');
 style.rel='stylesheet';style.href='/modules/auth-redesign.css';style.dataset.loginDesign='';document.head.append(style);
 signal?.addEventListener('abort',()=>style.remove(),{once:true});
 const card=el('div',{class:'card p-6 la-auth-card'},el('h1',{class:'font-display text-xl text-ink-900'},title),subtitle?el('p',{'data-auth-subtitle':'',class:'mt-1 text-sm text-ink-500'},subtitle):null,el('div',{class:'mt-5'},children));
 const body=el('div',{class:'la-auth-content'},el('div',{class:'la-auth-brand','data-auth-brand':''},brandBlock('justify-center')),loginSkillIcons(),card,footer?el('div',{class:'la-auth-footer'},footer):null);
 return el('div',{'data-shell':'','data-auth-shell':'',class:'la-auth-redesign'},landscape(),controls(context,{showTheme:false}),body);
}
