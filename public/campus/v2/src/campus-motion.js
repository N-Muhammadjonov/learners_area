import * as THREE from '../vendor/three-runtime.js';
const view=new THREE.Vector3();
export const dashboardRingAngle=elapsed=>elapsed*.22;
export function resolveReducedMotion(mode){
  return mode==='off';
}
export function setBuildingHover(buildings,id,active){
  const building=buildings.get(id);if(!building)return;
  building.userData.hoverTarget=active?1:0;
}
export function updateCampusObjects(buildings,camera,delta,elapsed,reducedMotion=false){
  camera.getWorldDirection(view).negate();const azimuth=Math.atan2(view.x,view.z);
  let scaleChanged=false;
  for(const building of buildings.values()){
    const {landmark,rocket,rings,flag}=building.userData;
    if(flag)waveCampusFlag(flag,reducedMotion?0:elapsed);
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



/** A shared wave keeps the stripes, crescent and stars on the same cloth. */
export function waveCampusFlag(flag,elapsed){
 for(const {mesh,rest} of flag.userData.fabric||[]){
  const position=mesh.geometry.attributes.position;
  for(let i=0;i<position.count;i++){
   const x=rest[i*3]+mesh.position.x,envelope=Math.max(0,x/5);
   position.setZ(i,rest[i*3+2]+envelope*(.32*Math.sin(x*1.8-elapsed*2.1)+.1*Math.sin(x*3.4-elapsed*2.8)));
  }
  position.needsUpdate=true;
 }
}
