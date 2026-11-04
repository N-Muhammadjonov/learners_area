import {el,listen} from '../../js/dom.js';
import {dockIcon} from './dock-icons.js';
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
  const icon=el('span',{class:'module-dock__icon'},dockIcon(item.key));
  icon.style.setProperty('--dock-top',item.top);icon.style.setProperty('--dock-bottom',item.bottom);
  return el('a',{href:item.href,'aria-label':item.label,'data-dock-module':item.key,class:'module-dock__item'},el('span',{class:'module-dock__launch'},icon),el('span',{class:'module-dock__dot','aria-hidden':'true'}));
 });
 nav.append(...links);node.append(nav,tooltip);
 let current=context.url,frame=0,layoutFrame=0,pointer=null,pending=null,opening=null;
 const launches=new Map();
 const win=document.defaultView;
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
   link.style.setProperty('--dock-scale',String(1+.1*amount*amount));
   link.style.setProperty('--dock-lift',String(-3*amount*amount)+'px');
  });
 }
 listen(nav,'pointermove',event=>{if(event.pointerType==='touch')return;pointer=event.clientX;if(!frame)frame=win.requestAnimationFrame(magnify);},signal);
 listen(nav,'pointerover',event=>{const link=event.target.closest?.('[data-dock-module]');if(link)showLabel(link);},signal);
 listen(node,'pointerleave',reset,signal);
 listen(nav,'scroll',reset,signal);
 function revealActive(){
  if(layoutFrame)win.cancelAnimationFrame(layoutFrame);
  layoutFrame=win.requestAnimationFrame(()=>{
   layoutFrame=0;if(signal.aborted||node.hidden||!node.isConnected)return;
   const link=links.find(a=>a.getAttribute('aria-current')==='page');if(!link)return;
   const viewport=nav.getBoundingClientRect(),box=link.getBoundingClientRect();
   if(box.left<viewport.left+13)nav.scrollLeft-=viewport.left+13-box.left;
   else if(box.right>viewport.right-13)nav.scrollLeft+=box.right-viewport.right+13;
  });
 }
 listen(win,'resize',revealActive,signal);
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
  const wasHidden=node.hidden;node.hidden=hidden;node.setAttribute('aria-hidden',String(hidden));if(hidden)reset();else if(wasHidden)revealActive();
 }
 const observer=new MutationObserver(visibility);
 observer.observe(html,{attributes:true,attributeFilter:['data-study-focus','data-retention-focus']});
 function update(url){
  current=url;const segment=url.pathname.split('/')[2]??'dashboard';
  const active=['admin','owner','teacher'].includes(segment)?'management':segment;
  for(const link of links){if(link.dataset.dockModule===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  reset();visibility();revealActive();
 }
 function begin(url,flight,source){
  pending=null;opening?.cancel();opening=null;
  const link=source?.closest?.('[data-dock-module]');
  if(!link||!node.contains(link)||node.hidden||flight.aborted)return;
  const artwork=link.querySelector('.module-dock__icon')?.getBoundingClientRect();
  const box=artwork?.width&&artwork?.height?artwork:link.getBoundingClientRect();
  const intent={path:url.pathname+url.search,x:box.left+box.width/2,y:box.top+box.height/2,width:box.width,height:box.height};
  const launch=link.querySelector('.module-dock__launch');
  if(typeof launch?.animate==='function'&&!launches.has(launch)){
   // Adapted from macBounce: play beside navigation, without delaying it.
   const bounce=launch.animate([
    {offset:0,transform:'translateY(0) scaleY(1)'},
    {offset:.3,transform:'translateY(-30px) scaleY(1.1)'},
    {offset:.5,transform:'translateY(0) scaleY(.85)'},
    {offset:.7,transform:'translateY(-12px) scaleY(1.05)'},
    {offset:.9,transform:'translateY(0) scaleY(.95)'},
    {offset:1,transform:'translateY(0) scaleY(1)'}
   ],{duration:500,iterations:2,easing:'ease-in-out'});
   bounce.id='dock-bounce';launches.set(launch,bounce);
   const release=()=>{if(launches.get(launch)===bounce)launches.delete(launch);};
   bounce.finished.then(release,release);tooltip.hidden=true;
  }
  pending=intent;flight.addEventListener('abort',()=>{if(pending===intent)pending=null;},{once:true});
 }
 function open(content,url){
  const intent=pending;pending=null;if(!intent||intent.path!==url.pathname+url.search||typeof content.animate!=='function')return;
  const box=content.getBoundingClientRect();if(!box.width||!box.height)return;
  const x=intent.x-box.left-box.width/2,y=intent.y+intent.height/2-box.top-box.height;
  const originX=Math.max(0,Math.min(box.width,intent.x-box.left));
  const seedX=Math.min(1,intent.width/box.width),seedY=Math.min(1,intent.height/box.height);
  // Start at the clicked artwork's exact rectangle. Its narrow neck stays
  // attached to that icon while the window grows upward, then opens fully.
  function funnel(center,spread,neck){
   const levels=[0,30,40,50,60,70,80,90,100],left=Math.max(0,center-neck/2)*(1-spread),right=Math.max(0,100-center-neck/2)*(1-spread);
   const bend=y=>{const t=Math.max(0,(y-30)/70);return t*t*(3-2*t);};
   return 'polygon('+[...levels.map(y=>`${left*bend(y)}% ${y}%`),...levels.slice().reverse().map(y=>`${100-right*bend(y)}% ${y}%`)].join(',')+')';
  }
  function grow(offset,sx,sy,spread,dy,opacity=1){
   const expansion=Math.max(0,Math.min(1,(sx-seedX)/Math.max(.001,1-seedX))),centerDx=x*(1-expansion);
   // openApp's dynamic origin, using the actual viewport instead of 15vw/800px.
   const dx=centerDx+(box.width/2-originX)*(1-sx);
   const neckCenter=Math.max(0,Math.min(100,50+(x-centerDx)/(sx*box.width)*100));
   return {offset,opacity,transform:`translate(${dx}px,${dy}px) scale(${sx},${sy}) skewX(0deg)`,clipPath:funnel(neckCenter,spread,intent.width/(sx*box.width)*100),transformOrigin:`${originX}px 100%`};
  }
  opening=content.animate([
   grow(0,seedX,seedY,0,y,0),
   grow(.16,Math.min(1,seedX*2.2),Math.min(1,seedY*2.3),0,y),
   grow(.43,seedX+(1-seedX)*.78,seedY+(1-seedY)*.63,0,y),
   grow(.68,1,1,.12,y*.5),
   grow(.86,1,1,.72,0),
   grow(1,1,1,1,0)
  ],{duration:600,easing:'cubic-bezier(.25,.8,.25,1.1)'});
  opening.id='dock-genie';
 }
 signal.addEventListener('abort',()=>{observer.disconnect();reset();if(layoutFrame)win.cancelAnimationFrame(layoutFrame);opening?.cancel();for(const bounce of launches.values())bounce.cancel();launches.clear();pending=null;node.remove();},{once:true});
 update(current);return {node,update,begin,open};
}
