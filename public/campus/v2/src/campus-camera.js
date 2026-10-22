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
    c.enableZoom = true; // keep native pinch-to-zoom on touch
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
    if(event.deltaX===0 && event.deltaY===0)return;
    const c=this.controls;
    const mul=event.deltaMode===1 ? 16 : event.deltaMode===2 ? this.domElement.clientHeight : 1;
    const dx=event.deltaX*mul;
    const dy=event.deltaY*mul;
    const offset=new THREE.Vector3().subVectors(this.camera.position,c.target);
    const spherical=new THREE.Spherical().setFromVector3(offset);
    // Two-finger horizontal gesture rotates; vertical gesture zooms independently.
    spherical.theta -= dx*.0034;
    spherical.radius = THREE.MathUtils.clamp(spherical.radius*Math.exp(dy*.0014),
      c.minDistance,c.maxDistance);
    spherical.phi=THREE.MathUtils.clamp(spherical.phi,c.minPolarAngle,c.maxPolarAngle);
    spherical.makeSafe();
    offset.setFromSpherical(spherical);
    this.camera.position.copy(c.target).add(offset);
    c.update();
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
        target: c.target.toArray()
      }));
    }catch{/* inaccessible storage is non-fatal */}
  }
  restoreState() {
    try{
      const data=JSON.parse(sessionStorage.getItem(this.storageKey)||'null');
      if(data && Array.isArray(data.position) && Array.isArray(data.target) &&
         data.position.length===3 && data.target.length===3 &&
         [...data.position,...data.target].every(Number.isFinite)) {
        const distance=new THREE.Vector3(...data.position).distanceTo(new THREE.Vector3(...data.target));
        if(distance>=this.controls.minDistance && distance<=this.controls.maxDistance){
          this.camera.position.fromArray(data.position);
          this.controls.target.fromArray(data.target);
          this.controls.update();
          return true;
        }
      }
    }catch{}
    this.camera.position.copy(this.initialPosition);
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
    return false;
  }
  resetToIsometric() {
    this.camera.position.copy(this.initialPosition);
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
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
