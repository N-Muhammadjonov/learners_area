import {el,listen} from '../../js/dom.js';
import {paymentsNavigationVisible} from '../../js/adapters/frontend.js';
import {dockIcon} from './dock-icons.js';
import {activeDockModule,dockItems,moduleDock,moduleNavigationVisible} from './dock.js';
/** Optional labelled navigation, inside Study tools. Uses the Dock's exact role-scoped items. */
export function navigationList(context){
 const details=el('details',{class:'la-navigation-list','data-navigation-list':''}),nav=el('nav',{'aria-label':context.dict.shell.learningNav});
 const active=activeDockModule(context.url);
 details.append(el('summary',{},context.dict.shell.learningNav),nav);
 for(const item of dockItems(context.dict,context.session.user.role,paymentsNavigationVisible(context.session)))nav.append(el('a',{href:item.href,...(item.key===active?{'aria-current':'page'}:{}),'data-navigation-list-item':item.key},dockIcon(item.key),el('span',{},item.label)));
 return details;
}

const NAVIGATION_MODE_KEY='la-module-navigation-mode';
const MOBILE_NAVIGATION='(max-width: 767px), (max-width: 1024px) and (max-height: 500px) and (pointer: coarse)';
const SIDEBAR_ID='module-sidebar';

function readNavigationMode(){
 try{return window.localStorage.getItem(NAVIGATION_MODE_KEY)==='sidebar'?'sidebar':'dock';}
 catch{return 'dock';}
}

export function moduleNavigation(context,{top,main}){
 const {signal,session,dict}=context;
 const mobile=window.matchMedia?.(MOBILE_NAVIGATION)??{matches:false};
 const uz=context.locale==='uz';
 const openLabel=uz?'Modullar menyusini ochish':'Open module menu';
 const closeLabel=uz?'Modullar menyusini yopish':'Close module menu';
 const sidebarLabel=uz?'Modullarni chap panelga o‘tkazish':'Move modules to the sidebar';
 const dockLabel=uz?'Dock ko‘rinishiga qaytish':'Switch back to the Dock';
 const splitIcon=()=>el('span',{class:'module-nav-split-icon','aria-hidden':'true'});
 const toSidebar=el('button',{type:'button',class:'module-nav-switch','data-module-nav-switch':'sidebar',
  'aria-label':sidebarLabel,title:sidebarLabel},splitIcon());
 const toDock=el('button',{type:'button',class:'module-nav-switch','data-module-nav-switch':'dock',
  title:dockLabel},splitIcon(),el('span',{},dockLabel));
 const toggle=el('button',{type:'button',class:'module-nav-hamburger','data-module-nav-hamburger':'',
  'aria-controls':SIDEBAR_ID,'aria-expanded':'false','aria-label':openLabel,hidden:true},
  el('span',{class:'module-nav-hamburger-icon','aria-hidden':'true'}));
 top.querySelector('[data-campus-header-identity]')?.prepend(toggle);
 const scroll=el('nav',{'aria-label':dict.shell.learningNav,class:'module-sidebar__links'});
 const links=dockItems(dict,session.user.role,paymentsNavigationVisible(session)).map(item=>
  el('a',{href:item.href,'data-module-sidebar-link':item.key},dockIcon(item.key,{reference:false}),el('span',{},item.label)));
 scroll.append(...links);
 const panel=el('aside',{id:SIDEBAR_ID,'data-module-sidebar':'',class:'module-sidebar',hidden:true},
  el('div',{class:'module-sidebar__title'},dict.shell.learningNav),scroll,
  el('div',{class:'module-sidebar__footer'},toDock));
 const backdrop=el('div',{class:'module-sidebar-backdrop','aria-hidden':'true',hidden:true});
 let mode=readNavigationMode(),mobileOpen=false,current=context.url;
 const dock=moduleDock(context,{switchButton:toSidebar,isSelected:()=>mode==='dock'});

 function positionDrawer(){
  const bottom=top.getBoundingClientRect().bottom;
  if(bottom>0)panel.style.setProperty('--module-sidebar-top',bottom+'px');
 }
 function render(){
  const available=mode==='sidebar'&&moduleNavigationVisible(current);
  if(!available||!mobile.matches)mobileOpen=false;
  const overlayOpen=available&&mobile.matches&&mobileOpen;
  panel.hidden=!available||(mobile.matches&&!mobileOpen);
  toggle.hidden=!available||!mobile.matches;
  toggle.setAttribute('aria-expanded',String(overlayOpen));
  toggle.setAttribute('aria-label',overlayOpen?closeLabel:openLabel);
  backdrop.hidden=!overlayOpen;
  if(overlayOpen)positionDrawer();
  main.toggleAttribute('inert',overlayOpen);
  dock.visibility();
 }
 function switchMode(next){
  mode=next;
  mobileOpen=next==='sidebar'&&mobile.matches;
  try{window.localStorage.setItem(NAVIGATION_MODE_KEY,mode);}catch{}
  render();
  (mode==='dock'?toSidebar:links[0])?.focus({preventScroll:true});
 }
 function closeDrawer(restoreFocus=true){
  if(!mobileOpen)return;
  mobileOpen=false;
  render();
  if(restoreFocus&&!toggle.hidden)toggle.focus({preventScroll:true});
 }
 listen(toSidebar,'click',()=>switchMode('sidebar'),signal);
 listen(toDock,'click',()=>switchMode('dock'),signal);
 listen(toggle,'click',()=>{
  if(mobileOpen){closeDrawer();return;}
  mobileOpen=true;
  render();
  links.find(link=>link.getAttribute('aria-current')==='page')?.focus({preventScroll:true});
 },signal);
 listen(backdrop,'click',()=>closeDrawer(),signal);
 listen(document,'keydown',event=>{
  if(event.key!=='Escape'||!mobileOpen||event.defaultPrevented)return;
  event.preventDefault();
  closeDrawer();
 },signal);
 listen(scroll,'click',event=>{
  if(!event.target.closest?.('[data-module-sidebar-link]')||event.button!==0||
      event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  closeDrawer();
 },signal);
 mobile.addEventListener?.('change',render,{signal});
 const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>{
  if(mobileOpen)positionDrawer();
 }):null;
 resize?.observe(top);
 const observer=new MutationObserver(render);
 observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-study-focus','data-retention-focus']});
 signal.addEventListener('abort',()=>{observer.disconnect();resize?.disconnect();},{once:true});

 function update(url){
  if(current.href!==url.href)mobileOpen=false;
  current=url;
  const active=activeDockModule(url);
  for(const link of links){
   if(link.dataset.moduleSidebarLink===active)link.setAttribute('aria-current','page');
   else link.removeAttribute('aria-current');
  }
  dock.update(url);
  render();
 }
 update(current);
 return {dock:dock.node,panel,backdrop,scroll,update};
}
