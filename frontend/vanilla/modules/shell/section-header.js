import {el} from '../../js/dom.js';
import {navigationLinks} from '../../js/generated/module-navigation.js';
import {render as sectionNav} from '../../js/generated/module-section-nav.js';

const WRITING=['lessons','exam','translation','typing','grade','activation','language-stealing'];
/** The same section identity as Main, resolved directly into native DOM. */
export function sectionIdentity(url,dict){
 const path=url.pathname,module=path.split('/')[2],tab=url.searchParams.get('tab');
 if(!['listening','reading','grammar','writing','vocabulary','video-lessons'].includes(module))return null;
 if(module==='video-lessons'){const index=path==='/app/video-lessons';return {module,key:index?'library':'detail',title:index?dict.videoLessons.title:'',index};}
 if(module==='vocabulary'){
  const key=path.startsWith('/app/vocabulary/games')?'games':path==='/app/vocabulary'?(['revision','use','board','dictionary'].includes(tab)?tab:'words'):null;
  return key?{module,key,title:dict.vocabulary.tab[key],index:path==='/app/vocabulary'||path==='/app/vocabulary/games'}:null;
 }
 if(module==='writing'){
  const segment=path.split('/')[3],key=path==='/app/writing'?(WRITING.includes(tab)?tab:'lessons'):['lessons','exam','translation','language-stealing','grade'].includes(segment)?segment:null;
  return key?{module,key,title:dict.writingWorkspace.tabs[key],index:path==='/app/writing'}:null;
 }
 if(module==='grammar'&&path==='/app/grammar'){const key=tab==='speaking'?'speaking':'writing';return {module,key,title:key==='speaking'?dict.grammar.forSpeaking:dict.grammar.forWriting,index:true};}
 const normalized=path==='/app/listening/academic'?'/app/listening/tests':path;
 const links=navigationLinks({module,dict}),link=links.find(item=>normalized===item.href||normalized.startsWith(item.href+'/'));
 return link?{module,key:link.key,title:module==='listening'&&link.key==='mcq'?'🎯 '+link.label:link.label,index:normalized===link.href}:null;
}

export function sectionHeader(context,title,moduleName){
 const {dict,signal}=context;
 const node=el('section',{'data-native-module-header':'',class:'native-module-header'}),nav=el('div',{'data-module-header-navigation':''});node.append(nav);
 let identity,url,content,observer,activeModule;
 function showTitle(text,key,index=true){
  const heading=title.firstElementChild;
  if(heading?.textContent!==text||heading?.dataset.moduleSectionHeading!==key){
   title.replaceChildren(...(text?[el(index?'h1':'span',{'data-module-section-heading':key,class:'native-module-title',title:text},text)]:[]));
  }
  title.hidden=!text;
 }
 function sourceHeading(heading,key){
  const name=heading?.textContent.trim();
  if(!name)return;
  heading.dataset.shellTitleSource='';
  heading.hidden=true;
  showTitle(name,key);
 }
 function attach(root){
  content=root;
  if(moduleName.hidden)return;
  const existing=activeModule&&content.querySelector('[data-module-sections], [data-writing-tablist], [data-video-header-sections]');
  if(existing)nav.replaceChildren(existing);
  node.hidden=!nav.childElementCount;
  if(identity?.module==='video-lessons'&&identity.key==='detail'){
   sourceHeading(content.querySelector('[data-video-detail-heading]'),'video-lessons:detail');
  }else if(!identity?.title){
   const heading=[...content.querySelectorAll('h1')].find(h=>h.hasAttribute('data-shell-title-source')||!h.closest('[hidden]'));
   if(heading?.textContent.trim()!==moduleName.textContent)sourceHeading(heading,url.pathname.split('/')[2]+':page');
  }
  if(identity?.index)for(const heading of content.querySelectorAll('h1')){
   if(heading.textContent.trim()===identity.title)heading.hidden=true;
  }
  for(const old of content.querySelectorAll('[data-listening-section-heading]'))old.hidden=true;
 }
 function update(next){
  url=next;identity=sectionIdentity(url,dict);activeModule=url.pathname.split('/')[2];
  if(!['listening','reading','grammar','writing','vocabulary','video-lessons'].includes(activeModule))activeModule=null;
  showTitle(identity?.title,identity?.title?identity.module+':'+identity.key:undefined,identity?.index);
  node.hidden=true;nav.replaceChildren();
  if(!activeModule)return;
  if(['listening','reading','grammar','vocabulary'].includes(activeModule)){
   const refs={current:[]},menu=sectionNav({module:activeModule,label:dict.nav[activeModule],links:navigationLinks({module:activeModule,dict}),pathname:url.pathname,query:url.searchParams,refs});
   if(menu){refs.current=[...menu.querySelectorAll('a')];nav.append(menu);node.hidden=false;}
  }
 }
 observer=new MutationObserver(()=>{if(content)attach(content);});
 function watch(root){observer.disconnect();attach(root);observer.observe(root,{childList:true,subtree:true});}
 signal.addEventListener('abort',()=>{observer.disconnect();node.remove();},{once:true});
 function updateLocation(next){
  const nextIdentity=sectionIdentity(next,dict);
  if(next.pathname!==url.pathname){update(next);return;}
  url=next;identity=nextIdentity;
  if(identity?.title)showTitle(identity.title,identity.module+':'+identity.key,identity.index);
  else if(content)attach(content);
  if(activeModule==='vocabulary'){const refs={current:[]},menu=sectionNav({module:activeModule,label:dict.nav[activeModule],links:navigationLinks({module:activeModule,dict}),pathname:next.pathname,query:next.searchParams,refs});if(menu)nav.replaceChildren(menu);}
 }
 update(context.url);return {node,update,updateLocation,attach:watch};
}
