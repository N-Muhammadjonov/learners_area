import {el} from '../../js/dom.js';

export async function mount(context){
 const {root,signal,session,dict,locale}=context;
 const section=el('section',{'data-campus-world':'',class:'la-campus','aria-label':'Learners Area 3D campus'});
 const canvas=el('div',{'data-campus-canvas':'',class:'la-campus-canvas'});
 const caption=el('div',{class:'la-campus-caption',role:'status'},locale==='uz'?'3D xarita yuklanmoqda…':'Loading 3D map…');
 section.append(canvas,caption);root.append(section);
 let scene;
 signal.addEventListener('abort',()=>{scene?.destroy();scene=null;},{once:true});
 try{
  const {LearnersAreaCampusScene}=await import('../../campus/v2/src/campus-scene.js');
  if(signal.aborted)return;
  scene=new LearnersAreaCampusScene(canvas,{
   management:['teacher','admin','owner'].includes(session.user.role),managementName:dict.nav.management,motion:'on',
   onNavigate(module){if(module.route.startsWith('/app/')){scene?.cameraController?.saveState();void context.navigate(module.route);}}
  });
  if(signal.aborted){scene.destroy();scene=null;return;}
  caption.remove();
 }catch{
  if(signal.aborted)return;
  scene?.destroy();scene=null;
  caption.textContent=locale==='uz'?'Modullarni quyidagi havolalardan oching.':'Open a module using the links below.';
  const {CAMPUS_CONFIG}=await import('../../campus/v2/src/campus-config.js');
  if(signal.aborted)return;
  const nav=el('nav',{'aria-label':dict.shell.learningNav,class:'la-campus-fallback'});
  for(const m of CAMPUS_CONFIG.modules)nav.append(el('a',{href:m.route},m.name));
  if(['teacher','admin','owner'].includes(session.user.role))nav.append(el('a',{href:'/app/management'},dict.nav.management));
  section.append(nav);
 }
}

export function preload(){return import('../../campus/v2/src/campus-scene.js');}

