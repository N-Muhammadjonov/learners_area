import * as THREE from '../vendor/three-runtime.js';
import {orbitFacingAnchor} from './campus-label-anchors.js';

export const moduleLabelScale=id=>.864*(id==='video_lessons'?.8:.9);

/** World-anchored badges. Geometry in front of a building also hides its badge. */
export class CampusLabels {
 constructor(container,camera,onNavigate,buildings=new Map()){
  Object.assign(this,{container,camera,onNavigate,buildings});this.labels=[];
  this.viewDirection=new THREE.Vector3();this.raycaster=new THREE.Raycaster();
  this.overlay=document.createElement('div');this.overlay.className='campus-labels-overlay';container.append(this.overlay);
  this.lastCamera=new THREE.Matrix4();this.lastProjection=new THREE.Matrix4();this.nextOcclusion=0;
 }
 initLabels(modules,icons){
  this.overlay.replaceChildren();this.labels=[];
  for(const module of modules){
   const el=document.createElement('button');el.type='button';el.className='campus-module-label';
   el.style.setProperty('--module-accent',module.accentHex);el.dataset.moduleId=module.id;el.dataset.navigationRoute=module.route;
   const hint=(action,delay=90)=>el.dispatchEvent(new CustomEvent('learners-area:prefetch-intent',{bubbles:true,detail:{action,delay}}));
   el.addEventListener('mouseenter',()=>hint('prepare'));el.addEventListener('mouseleave',()=>hint('cancel'));
   el.addEventListener('focus',()=>hint('prepare'));el.addEventListener('blur',()=>hint('cancel'));
   el.addEventListener('pointerdown',()=>hint('prepare',0));
   el.setAttribute('aria-label',`Navigate to ${module.name}`);
   const icon=document.createElement('span');icon.className='module-icon';icon.style.color=module.accentHex;
   icon.innerHTML=icons[module.icon]||'';
   const text=document.createElement('span');text.className='module-text';text.textContent=module.name;el.append(icon,text);
   const p=module.labelPos||module.pos;
   const item={el,module,anchorPos:new THREE.Vector3(p.x,p.y,p.z),active:false,occluded:false};
   const hover=active=>{item.active=active;this.paint(item);window.dispatchEvent(new CustomEvent('campus-module-hover',{detail:{id:module.id,active}}));};
   el.addEventListener('click',event=>{event.stopPropagation();this.onNavigate?.(module);});
   el.addEventListener('mouseenter',()=>hover(true));el.addEventListener('mouseleave',()=>hover(false));
   el.addEventListener('focus',()=>hover(true));el.addEventListener('blur',()=>hover(false));
   this.paint(item);this.overlay.append(el);this.labels.push(item);
  }
 }
 paint(item){
  const {el,module,active}=item;
  el.style.transform=`translate(-50%,-50%) scale(${moduleLabelScale(module.id)*(active?1.08:1)})`;
  el.style.boxShadow=active?`0 0 20px ${module.accentHex}aa, inset 0 0 8px ${module.accentHex}66`:`0 0 12px ${module.accentHex}66, inset 0 0 6px ${module.accentHex}33`;
 }
 blocked(point,moduleId,ndcX,ndcY,boxes){
  this.raycaster.setFromCamera(new THREE.Vector2(ndcX,ndcY),this.camera);
  const ray=this.raycaster.ray,limit=point.clone().sub(ray.origin).dot(ray.direction)-.18;
  for(const [id,{building,box}] of boxes){
   if(id===moduleId||!ray.intersectsBox(box))continue;
   const hits=this.raycaster.intersectObject(building,true);
   if(hits.some(hit=>hit.distance<limit&&hit.object.isMesh&&!hit.object.material?.transparent))return true;
  }
  return false;
 }
 update(width,height){
  this.camera.updateMatrixWorld();this.camera.getWorldDirection(this.viewDirection).negate();
  const now=performance.now();
  if(width!==this.lastWidth||height!==this.lastHeight){
   for(const item of this.labels)item.screenSize={width:item.el.offsetWidth||105,height:item.el.offsetHeight||24};
   this.lastWidth=width;this.lastHeight=height;
  }
  const changed=!this.camera.matrixWorld.equals(this.lastCamera)||!this.camera.projectionMatrix.equals(this.lastProjection);
  const checkOcclusion=changed||now>=this.nextOcclusion;
  const boxes=new Map();
  if(checkOcclusion){
   for(const [id,building] of this.buildings){building.updateMatrixWorld(true);boxes.set(id,{building,box:new THREE.Box3().setFromObject(building)});}
   this.lastCamera.copy(this.camera.matrixWorld);this.lastProjection.copy(this.camera.projectionMatrix);this.nextOcclusion=now+120;
  }
  for(const item of this.labels){
   const anchor=orbitFacingAnchor(item.anchorPos,item.module,this.camera.position,this.viewDirection,item.footprint);
   const world=new THREE.Vector3(anchor.x,anchor.y,anchor.z),point=world.clone().project(this.camera);
   if(checkOcclusion){
    // A neighbouring roof touching the badge edge must not hide its visible facade.
    // Cast through the actual world anchor; screen-edge rays have a different depth.
    item.occluded=this.blocked(world,item.module.id,point.x,point.y,boxes);
   }
   const visible=Number.isFinite(point.x)&&Number.isFinite(point.y)&&Math.abs(point.x)<=1.2&&Math.abs(point.y)<=1.2&&point.z>=-1&&point.z<=1&&!item.occluded;
   item.el.style.visibility=visible?'visible':'hidden';item.el.tabIndex=visible?0:-1;
   if(!visible&&item.active){item.active=false;this.paint(item);window.dispatchEvent(new CustomEvent('campus-module-hover',{detail:{id:item.module.id,active:false}}));}
   // No collision displacement or viewport clamping: the badge stays on its building.
   item.el.style.left=`${((point.x*.5+.5)*width).toFixed(2)}px`;
   item.el.style.top=`${((-point.y*.5+.5)*height).toFixed(2)}px`;
   item.el.style.zIndex=String(Math.round((1-point.z)*10000));
  }
 }
 setHighlight(id,active){const item=this.labels.find(item=>item.module.id===id);if(item){item.active=active;this.paint(item);}}
}
