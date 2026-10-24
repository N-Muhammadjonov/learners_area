import * as THREE from '../vendor/three-runtime.js';
const view=new THREE.Vector3();
export const dashboardRingAngle=elapsed=>elapsed*.22;
export function resolveReducedMotion(mode,systemReducedMotion){
  return mode==='on'?false:mode==='off'?true:systemReducedMotion;
}
export function setBuildingHover(buildings,id,active){
  const building=buildings.get(id);if(!building)return;
  building.userData.hoverTarget=active?1:0;
}
export function updateCampusObjects(buildings,camera,delta,elapsed,reducedMotion=false){
  camera.getWorldDirection(view).negate();const azimuth=Math.atan2(view.x,view.z);
  let scaleChanged=false;
  for(const building of buildings.values()){
    const {landmark,rocket,rings}=building.userData;
    if(landmark){landmark.rotation.order='YXZ';landmark.rotation.y=azimuth;}
    if(rocket)rocket.rotation.y=reducedMotion?0:elapsed*.45;
    if(rings)rings.rotation.y=dashboardRingAngle(reducedMotion?0:elapsed);
    const base=building.userData.restingScale||=building.scale.clone();
    const old=building.userData.hoverAmount||0,target=building.userData.hoverTarget||0;
    const amount=reducedMotion?target:THREE.MathUtils.damp(old,target,12,delta);
    if(Math.abs(amount-old)>1e-5)scaleChanged=true;
    building.userData.hoverAmount=amount;
    building.scale.copy(base).multiplyScalar(1+.065*amount);
  }
  return scaleChanged;
}

