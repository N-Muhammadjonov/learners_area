import {el,listen} from '../../js/dom.js';
import {dockIcon} from './dock-icons.js';
import {returnForWindow} from '../campus/return-policy.js';
import {captureWindow,openWindow} from './window-opening.js';

const EDGE_INSET = 10;

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
 ];
 if(['teacher','admin','owner'].includes(role))items.push(['management','/app/management',n.management,'settings','#a1a9bb','#515d76']);
 return items.map(([key,href,label,icon,top,bottom])=>({key,href,label,icon,top,bottom}));
}

export function moduleDock(context){
 const {dict,signal,session}=context,html=document.documentElement;
 const node=el('div',{'data-module-dock':'',class:'module-dock'});
 node.style.setProperty('--dock-edge-inset', `${EDGE_INSET}px`);
 const nav=el('nav',{'aria-label':dict.shell.learningNav,class:'module-dock__glass'});
 const tooltip=el('span',{class:'module-dock__label','aria-hidden':'true',hidden:true});
 const items=dockItems(dict,session.user.role),links=items.map(item=>{
  const artwork=dockIcon(item.key),icon=el('span',{class:'module-dock__icon'+(artwork.hasAttribute('data-dock-reference')?' module-dock__icon--reference':'')},artwork);
  icon.style.setProperty('--dock-top',item.top);icon.style.setProperty('--dock-bottom',item.bottom);
  return el('a',{href:item.href,'aria-label':item.label,'data-dock-module':item.key,class:'module-dock__item'},icon,el('span',{class:'module-dock__dot','aria-hidden':'true'}));
 });
 nav.append(...links);node.append(nav,tooltip);
 let current=context.url,frame=0,layoutFrame=0,pointer=null,pending=null,opening=null;
 const win=document.defaultView;
 let pointerPoint = null;
 let focusedLink = null;
 let labelledLink = null;

 function hideLabel() {
  tooltip.hidden = true;
  labelledLink = null;
 }

 function clearMagnification(){
  if(frame)win.cancelAnimationFrame(frame);frame=0;pointer=null;
  for(const link of links){link.style.removeProperty('--dock-scale');link.style.removeProperty('--dock-lift');}
 }

 function reset() {
  pointerPoint = null;
  focusedLink = null;
  clearMagnification();
  hideLabel();
 }

 function positionLabel(link) {
  const artwork = link.querySelector('.module-dock__icon').getBoundingClientRect();
  const icon = artwork.width ? artwork : link.getBoundingClientRect();
  const viewport = nav.getBoundingClientRect();
  const left = viewport.width ? Math.max(icon.left, viewport.left + EDGE_INSET) : icon.left;
  const right = viewport.width ? Math.min(icon.left + icon.width, viewport.right - EDGE_INSET) : icon.left + icon.width;
  if (viewport.width && left >= right) {
   hideLabel();
   return;
  }
  const anchor = (left + right) / 2;
  const halfWidth = tooltip.offsetWidth / 2;
  const center = Math.max(halfWidth + 8, Math.min(win.innerWidth - halfWidth - 8, anchor));
  tooltip.style.left = `${center - node.getBoundingClientRect().left}px`;
  tooltip.style.setProperty('--dock-label-arrow', `${tooltip.clientWidth / 2 + anchor - center}px`);
 }

 function showLabel(link, reposition = false) {
  if (!link || node.hidden) {
   hideLabel();
   return;
  }
  if (link !== labelledLink) {
   tooltip.textContent = link.getAttribute('aria-label');
   tooltip.hidden = false;
   labelledLink = link;
   reposition = true;
  }
  if (reposition) positionLabel(link);
 }

 function linkAtPoint(point, fallback) {
  const hit = point && typeof document.elementFromPoint === 'function'
   ? document.elementFromPoint(point.x, point.y)
   : fallback;
  const link = hit?.closest?.('[data-dock-module]');
  return link && nav.contains(link) ? link : null;
 }

 function refreshLabel() {
  const link = pointerPoint ? linkAtPoint(pointerPoint) : focusedLink;
  showLabel(link, true);
 }

 function updatePointerLabel(event) {
  if (event.pointerType === 'touch') {
   reset();
   return;
  }
  focusedLink = null;
  pointerPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
   ? {x: event.clientX, y: event.clientY}
   : null;
  showLabel(linkAtPoint(pointerPoint, event.target));
 }
 function magnify(){
  frame=0;if(pointer===null||node.hidden)return;
  const centers=links.map(link=>{const box=link.getBoundingClientRect();return box.left+box.width/2;});
  links.forEach((link,index)=>{const amount=Math.max(0,1-Math.abs(pointer-centers[index])/100);
   link.style.setProperty('--dock-scale',String(1+.1*amount*amount));
   link.style.setProperty('--dock-lift',String(-3*amount*amount)+'px');
  });
  if (labelledLink) positionLabel(labelledLink);
 }
 listen(node,'pointermove',event=>{
  updatePointerLabel(event);
  if(event.pointerType==='touch')return;
  pointer=event.clientX;
  if(!frame)frame=win.requestAnimationFrame(magnify);
 },signal);
 listen(node,'pointerover',event=>{if(!focusedLink)updatePointerLabel(event);},signal);
 listen(node,'pointerleave',reset,signal);
 listen(nav,'scroll',()=>{
  clearMagnification();
  refreshLabel();
  if (pointerPoint) {
   pointer = pointerPoint.x;
   frame = win.requestAnimationFrame(magnify);
  }
 },signal);
 function revealActive(){
  if(layoutFrame)win.cancelAnimationFrame(layoutFrame);
  layoutFrame=win.requestAnimationFrame(()=>{
   layoutFrame=0;if(signal.aborted||node.hidden||!node.isConnected)return;
   const link=links.find(a=>a.getAttribute('aria-current')==='page');if(!link)return;
   const viewport=nav.getBoundingClientRect(),box=link.getBoundingClientRect();
   if(box.left<viewport.left+13)nav.scrollLeft-=viewport.left+13-box.left;
   else if(box.right>viewport.right-13)nav.scrollLeft+=box.right-viewport.right+13;
   refreshLabel();
  });
 }
 listen(win,'resize',()=>{opening?.cancel();opening=null;pending=null;revealActive();refreshLabel();},signal);
 listen(nav,'focusin',event=>{
  const link=event.target.closest?.('[data-dock-module]');
  if (!link) return;
  if (linkAtPoint(pointerPoint) !== link) {
   pointerPoint = null;
   focusedLink = link;
   clearMagnification();
  }
  showLabel(link, true);
 },signal);
 listen(nav,'focusout',event=>{
  if (nav.contains(event.relatedTarget)) return;
  focusedLink = null;
  refreshLabel();
 },signal);
 listen(nav,'keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  const index=links.indexOf(event.target);if(index<0)return;
  const next=event.key==='ArrowRight'?(index+1)%links.length:event.key==='ArrowLeft'?(index+links.length-1)%links.length:event.key==='Home'?0:event.key==='End'?links.length-1:null;
  if(next!==null){event.preventDefault();pointerPoint=null;links[next].focus();}
 },signal);
 function visibility(){
  const hidden=returnForWindow(current).mode==='back'||html.dataset.studyFocus==='on'||html.dataset.retentionFocus==='on';
  const wasHidden=node.hidden;node.hidden=hidden;node.setAttribute('aria-hidden',String(hidden));if(hidden){reset();opening?.cancel();opening=null;pending=null;}else if(wasHidden)revealActive();
 }
 const observer=new MutationObserver(visibility);
 observer.observe(html,{attributes:true,attributeFilter:['data-study-focus','data-retention-focus']});
 function update(url){
  current=url;const segment=url.pathname.split('/')[2]??'dashboard';
  const active=['admin','owner','teacher'].includes(segment)?'management':segment;
  for(const link of links){if(link.dataset.dockModule===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  reset();visibility();revealActive();
 }
 function begin(url,flight,source,viewport){
  pending=null;opening?.cancel();opening=null;
  const link=source?.closest?.('[data-dock-module]');
  if(!link||!node.contains(link)||node.hidden||flight.aborted)return;
  const artwork=link.querySelector('.module-dock__icon')?.getBoundingClientRect();
  const box=artwork?.width&&artwork?.height?artwork:link.getBoundingClientRect();
  const intent={path:url.pathname+url.search,x:box.left+box.width/2,y:box.top+box.height/2,width:box.width,height:box.height,previous:captureWindow(viewport)};
  pending=intent;flight.addEventListener('abort',()=>{if(pending===intent)pending=null;},{once:true});
 }
 function open(content,url){
  const intent=pending;pending=null;if(!intent||intent.path!==url.pathname+url.search||typeof content.animate!=='function')return;
  opening=openWindow(content,intent);
 }
 signal.addEventListener('abort',()=>{observer.disconnect();reset();if(layoutFrame)win.cancelAnimationFrame(layoutFrame);opening?.cancel();pending=null;node.remove();},{once:true});
 update(current);return {node,update,begin,open};
}
