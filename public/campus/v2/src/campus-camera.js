/**
 * Learners Area campus camera: stable 3D orbit, desktop/trackpad/touch.
 * Source: recovered prototype, corrected for horizontal-wheel rotation,
 * camera persistence and exact restoration after module navigation.
 */
import * as THREE from 'https://esm.sh/three@0.180.0';
import { OrbitControls } from 'https://esm.sh/three@0.180.0/addons/controls/OrbitControls.js';

export class CampusCameraController {
  constructor(camera, domElement, config) {
    this.camera = camera;
    this.domElement = domElement;
    this.config = config;
    this.storageKey = config.storage.cameraKey;
    this.initialPosition = new THREE.Vector3(
      config.camera.position.x, config.camera.position.y, config.camera.position.z
    );
    this.initialTarget = new THREE.Vector3(
      config.camera.target.x, config.camera.target.y, config.camera.target.z
    );
    this.controls = new OrbitControls(camera, domElement);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = config.camera.dampingFactor || .075;
    c.enablePan = false;
    c.enableZoom = true; // native touch pinch updates orthographic zoom
    c.minZoom=0.65;
    c.maxZoom=2.6;
    c.minDistance = config.camera.minDistance;
    c.maxDistance = config.camera.maxDistance;
    c.minPolarAngle = config.camera.minPolarAngle;
    c.maxPolarAngle = config.camera.maxPolarAngle;
    c.mouseButtons = {LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.NONE};
    c.touches = {ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
    this.lastSave=0;
    this.pendingSave=null;
    this.onEnd = ()=>this.saveState();
    this.onPageHide=()=>this.saveState();
    this.onWheel=this.handleWheel.bind(this);
    c.addEventListener('end',this.onEnd);
    window.addEventListener('pagehide',this.onPageHide);
    // CAPTURE phase takes precedence over OrbitControls' own wheel handler.
    domElement.addEventListener('wheel',this.onWheel,{passive:false,capture:true});
    this.restoreState();
  }

  handleWheel(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const c=this.controls;
    const mul=event.deltaMode===1?16:event.deltaMode===2?this.domElement.clientHeight:1;
    const dx=THREE.MathUtils.clamp(event.deltaX*mul,-80,80);
    const dy=THREE.MathUtils.clamp(event.deltaY*mul,-80,80);
    const spherical=new THREE.Spherical().setFromVector3(
      new THREE.Vector3().subVectors(this.camera.position,c.target));
    // Horizontal Mac trackpad: orbit. Vertical: independent orthographic zoom.
    spherical.theta += dx*.0034;
    spherical.phi=THREE.MathUtils.clamp(spherical.phi,c.minPolarAngle,c.maxPolarAngle);
    spherical.makeSafe();
    this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom*Math.exp(-dy*.0014),c.minZoom,c.maxZoom);
    this.camera.updateProjectionMatrix();
    const damping=c.enableDamping;
    c.enableDamping=false;
    this.camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(spherical));
    c.update();
    c.enableDamping=damping;
    clearTimeout(this.pendingSave);
    this.pendingSave=setTimeout(()=>this.saveState(),150);
  }

  update() {
    this.controls.update();
    const now=performance.now();
    if(now-this.lastSave>500){
      this.lastSave=now;
      this.saveState();
    }
  }
  saveState() {
    try{
      const c=this.controls;
      const numbers=[...this.camera.position.toArray(),...c.target.toArray()];
      if(!numbers.every(Number.isFinite))return;
      sessionStorage.setItem(this.storageKey,JSON.stringify({
        position: this.camera.position.toArray(),
        target: c.target.toArray(),
        zoom: this.camera.zoom
      }));
    }catch{/* inaccessible storage is non-fatal */}
  }
  restoreState() {
    try {
      const data=JSON.parse(sessionStorage.getItem(this.storageKey)||'null');
      if(data&&Array.isArray(data.position)&&Array.isArray(data.target)&&
         data.position.length===3&&data.target.length===3&&
         [...data.position,...data.target].every(Number.isFinite)){
        const pos=new THREE.Vector3().fromArray(data.position);
        const target=new THREE.Vector3().fromArray(data.target);
        const d=pos.distanceTo(target);
        if(d>=this.controls.minDistance&&d<=this.controls.maxDistance){
          this.applyExactPose(pos,target,Number.isFinite(data.zoom)?data.zoom:1);
          return true;
        }
      }
    }catch{}
    this.applyExactPose(this.initialPosition,this.initialTarget,1);
    return false;
  }
  applyExactPose(position,target,zoom=1) {
    // Clear momentum to prevent map moving after navigating back.
    const c=this.controls, damping=c.enableDamping;
    c.enableDamping=false;
    this.camera.zoom=THREE.MathUtils.clamp(zoom,c.minZoom,c.maxZoom);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(position);
    c.target.copy(target);
    c.update();
    c.enableDamping=damping;
  }
  resetToIsometric() {
    this.applyExactPose(this.initialPosition,this.initialTarget,1);
    this.saveState();
  }
  dispose() {
    this.saveState();
    clearTimeout(this.pendingSave);
    this.domElement.removeEventListener('wheel',this.onWheel,true);
    window.removeEventListener('pagehide',this.onPageHide);
    this.controls.removeEventListener('end',this.onEnd);
    this.controls.dispose();
  }
}
