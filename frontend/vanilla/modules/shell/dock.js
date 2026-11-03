import {el,listen} from '../../js/dom.js';
import {ModuleEmoji} from '../../js/generated/module-emoji.js';
import {returnForWindow} from '../campus/return-policy.js';

/** Only module entries live here. Management keeps its role-scoped cards. */
export function dockItems(dict,role){
 const n=dict.nav;
 const items=[
  ['dashboard','/app',n.dashboard,'dashboard','#49caff','#007bff'],
  ['live-classes','/app/live-classes',n.liveClasses,'live','#ff7d9d','#e52e5f'],
  ['assignments','/app/assignments',n.assignments,'assignment','#b094ff','#7050df'],
  ['mocks','/app/mocks',n.mockTests,'assignment','#53d4dd','#168cbb'],
  ['video-lessons','/app/video-lessons',n.videoLessons,'video','#ff815e','#e63b42'],
  ['listening','/app/listening/lessons',n.listening,'listening','#68c5ff','#2469df'],
  ['reading','/app/reading/lessons',n.reading,'reading','#ffce70','#e38c20'],
  ['writing','/app/writing',n.writing,'writing','#57e2bc','#16a77c'],
  ['speaking','/app/speaking',n.speaking,'speaking','#ca8bff','#8940dc'],
  ['grammar','/app/grammar/lessons',n.grammar,'grammar','#7baaff','#465ade'],
  ['vocabulary','/app/vocabulary',n.vocabulary,'vocabulary','#ff88ad','#dd376c'],
  ['progress','/app/progress',n.progress,'progress','#a3df7b','#41a954'],
  ['courses','/app/courses/ielts',n.course,'reading','#7edcd1','#23989b'],
  ['coach','/app/coach',n.coach,'grammar','#bd9aff','#6b4bdd'],
  ['reports','/app/reports',dict.reporter.title,'progress','#82c4f5','#3673b5'],
  ['support','/app/support',n.support,'support','#8da6c3','#4b6589'],
 ];
 if(['teacher','admin','owner'].includes(role))items.push(['management','/app/management',n.management,'settings','#a1a9bb','#515d76']);
 return items.map(([key,href,label,icon,top,bottom])=>({key,href,label,icon,top,bottom}));
}

export function moduleDock(context){
 const {dict,signal,session}=context,html=document.documentElement;
 const node=el('div',{'data-module-dock':'',class:'module-dock'});
 const nav=el('nav',{'aria-label':dict.shell.learningNav,class:'module-dock__glass'});
 const tooltip=el('span',{class:'module-dock__label','aria-hidden':'true',hidden:true});
 const items=dockItems(dict,session.user.role),links=items.map(item=>{
  const icon=el('span',{class:'module-dock__icon'},ModuleEmoji({kind:item.icon}));
  icon.style.setProperty('--dock-top',item.top);icon.style.setProperty('--dock-bottom',item.bottom);
  return el('a',{href:item.href,'aria-label':item.label,'data-dock-module':item.key,class:'module-dock__item'},icon,el('span',{class:'module-dock__dot','aria-hidden':'true'}));
 });
 nav.append(...links);node.append(nav,tooltip);
 let current=context.url,frame=0,pointer=null,pending=null,opening=null;
 const win=document.defaultView;
 const reduced=()=>win.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
 function reset(){
  if(frame)win.cancelAnimationFrame(frame);frame=0;pointer=null;tooltip.hidden=true;
  for(const link of links){link.style.removeProperty('--dock-scale');link.style.removeProperty('--dock-lift');}
 }
 function showLabel(link){
  if(node.hidden)return;const index=links.indexOf(link);if(index<0)return;
  tooltip.textContent=items[index].label;tooltip.hidden=false;
  const bounds=node.getBoundingClientRect(),box=link.getBoundingClientRect();
  const half=tooltip.offsetWidth/2+6;
  tooltip.style.left=Math.max(half,Math.min(bounds.width-half,box.left+box.width/2-bounds.left))+'px';
 }
 function magnify(){
  frame=0;if(pointer===null||node.hidden)return;
  const centers=links.map(link=>{const box=link.getBoundingClientRect();return box.left+box.width/2;});
  links.forEach((link,index)=>{const amount=Math.max(0,1-Math.abs(pointer-centers[index])/100);
   link.style.setProperty('--dock-scale',String(1+.25*amount*amount));
   link.style.setProperty('--dock-lift',String(-9*amount*amount)+'px');
  });
 }
 listen(nav,'pointermove',event=>{if(event.pointerType==='touch'||reduced())return;pointer=event.clientX;if(!frame)frame=win.requestAnimationFrame(magnify);},signal);
 listen(nav,'pointerover',event=>{const link=event.target.closest?.('[data-dock-module]');if(link)showLabel(link);},signal);
 listen(node,'pointerleave',reset,signal);
 listen(nav,'scroll',reset,signal);
 listen(nav,'focusin',event=>{const link=event.target.closest?.('[data-dock-module]');if(link){reset();showLabel(link);}},signal);
 listen(nav,'focusout',event=>{if(!nav.contains(event.relatedTarget))reset();},signal);
 listen(nav,'keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  const index=links.indexOf(event.target);if(index<0)return;
  const next=event.key==='ArrowRight'?(index+1)%links.length:event.key==='ArrowLeft'?(index+links.length-1)%links.length:event.key==='Home'?0:event.key==='End'?links.length-1:null;
  if(next!==null){event.preventDefault();links[next].focus();}
 },signal);
 function visibility(){
  const hidden=returnForWindow(current).mode==='back'||html.dataset.studyFocus==='on'||html.dataset.retentionFocus==='on';
  node.hidden=hidden;node.setAttribute('aria-hidden',String(hidden));if(hidden)reset();
 }
 const observer=new MutationObserver(visibility);
 observer.observe(html,{attributes:true,attributeFilter:['data-study-focus','data-retention-focus']});
 function update(url){
  current=url;const segment=url.pathname.split('/')[2]??'dashboard';
  const active=['admin','owner','teacher'].includes(segment)?'management':segment;
  for(const link of links){if(link.dataset.dockModule===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  reset();visibility();
 }
 function begin(url,flight,source){
  pending=null;opening?.cancel();opening=null;
  const link=source?.closest?.('[data-dock-module]');
  if(!link||!node.contains(link)||node.hidden||flight.aborted)return;
  const box=link.getBoundingClientRect();const intent={path:url.pathname+url.search,x:box.left+box.width/2,y:box.top+box.height/2};
  pending=intent;flight.addEventListener('abort',()=>{if(pending===intent)pending=null;},{once:true});
 }
 function open(content,url){
  const intent=pending;pending=null;if(!intent||intent.path!==url.pathname+url.search||reduced()||typeof content.animate!=='function')return;
  const box=content.getBoundingClientRect();if(!box.width||!box.height)return;
  const x=intent.x-box.left-box.width/2,y=intent.y-box.top-box.height;
  opening=content.animate([
   {opacity:0,transform:`translate(${x}px,${y}px) scale(.18,.04)`,transformOrigin:'50% 100%'},
   {opacity:1,transform:'translate(0,0) scale(1,1)',transformOrigin:'50% 100%'}
  ],{duration:380,easing:'cubic-bezier(.16,1,.3,1)'});
 }
 signal.addEventListener('abort',()=>{observer.disconnect();reset();opening?.cancel();pending=null;node.remove();},{once:true});
 update(current);return {node,update,begin,open};
}
