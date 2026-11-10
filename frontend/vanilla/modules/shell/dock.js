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
 let current=context.url,layoutFrame=0,scrollFrame=0,pending=null,opening=null;
 const win=document.defaultView;
 let pointerX = NaN;
 let pointerY = NaN;
 let focusedLink = null;
 let labelledLink = null;

 function hideLabel() {
  if (!labelledLink) return;
  tooltip.hidden = true;
  labelledLink = null;
 }

 function reset() {
  pointerX = pointerY = NaN;
  focusedLink = null;
  if (scrollFrame) win.cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  hideLabel();
 }

 function positionLabel(link) {
  const icon = link.getBoundingClientRect();
  const viewport = nav.getBoundingClientRect();
  const left = viewport.width ? Math.max(icon.left, viewport.left + EDGE_INSET) : icon.left;
  const right = viewport.width ? Math.min(icon.left + icon.width, viewport.right - EDGE_INSET) : icon.left + icon.width;
  if (viewport.width && left >= right) return false;
  const origin = node.getBoundingClientRect().left;
  // CSS clamps the label using its own width, so changing text needs no layout read.
  tooltip.style.setProperty('--dock-label-anchor', `${(left + right) / 2 - origin}px`);
  tooltip.style.setProperty('--dock-label-min', `${8 - origin}px`);
  tooltip.style.setProperty('--dock-label-max', `${win.innerWidth - 8 - origin}px`);
  return true;
 }

 function showLabel(link, reposition = false) {
  if (!link || node.hidden) {
   hideLabel();
   return;
  }
  if (!reposition && link === labelledLink) return;
  if (!positionLabel(link)) {
   hideLabel();
   return;
  }
  if (link === labelledLink) return;
  tooltip.textContent = link.getAttribute('aria-label');
  tooltip.hidden = false;
  labelledLink = link;
 }

 function targetLink(target) {
  const link = target?.closest?.('[data-dock-module]');
  return link && nav.contains(link) ? link : null;
 }

 function refreshLabel() {
  const link = Number.isFinite(pointerX)
   ? targetLink(document.elementFromPoint?.(pointerX, pointerY))
   : focusedLink;
  showLabel(link, true);
 }

 function updatePointerLabel(event) {
  if (event.pointerType === 'touch') {
   reset();
   return;
  }
  focusedLink = null;
  pointerX = event.clientX;
  pointerY = event.clientY;
  showLabel(targetLink(event.target));
 }
 listen(node,'pointermove',updatePointerLabel,signal);
 listen(node,'pointerover',event=>{if(!focusedLink)updatePointerLabel(event);},signal);
 listen(node,'pointerleave',reset,signal);
 listen(nav,'scroll',()=>{
  if (scrollFrame || (!Number.isFinite(pointerX) && !focusedLink)) return;
  scrollFrame = win.requestAnimationFrame(() => {
   scrollFrame = 0;
   refreshLabel();
  });
 },signal);
 function revealActive(){
  if(layoutFrame)win.cancelAnimationFrame(layoutFrame);
  layoutFrame=win.requestAnimationFrame(()=>{
   layoutFrame=0;if(signal.aborted||node.hidden||!node.isConnected)return;
   const link=links.find(a=>a.getAttribute('aria-current')==='page');
   if(link){
    const viewport=nav.getBoundingClientRect(),box=link.getBoundingClientRect();
    if(box.left<viewport.left+13)nav.scrollLeft-=viewport.left+13-box.left;
    else if(box.right>viewport.right-13)nav.scrollLeft+=box.right-viewport.right+13;
   }
   refreshLabel();
  });
 }
 listen(win,'resize',()=>{opening?.cancel();opening=null;pending=null;revealActive();},signal);
 listen(nav,'focusin',event=>{
  const link=event.target.closest?.('[data-dock-module]');
  if (!link) return;
  if (Number.isFinite(pointerX) && labelledLink === link) return;
  pointerX = pointerY = NaN;
  focusedLink = link;
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
  if(next!==null){event.preventDefault();pointerX=pointerY=NaN;links[next].focus();}
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
