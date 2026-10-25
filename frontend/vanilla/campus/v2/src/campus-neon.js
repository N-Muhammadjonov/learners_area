import * as THREE from '../vendor/three-runtime.js';

const up=new THREE.Vector3(0,1,0);
export function neonMaterial(color,power=2.6,opacity=1){
  return new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(power),
    toneMapped:false,transparent:opacity<1,opacity,depthWrite:opacity===1,
    blending:opacity<1?THREE.AdditiveBlending:THREE.NormalBlending});
}
export function scaleNeonEmission(group,scale){
  const seen=new Set();
  group.traverse(object=>{
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material?.color&&!seen.has(material)){material.color.multiplyScalar(scale);seen.add(material);}
    }
  });
}
export function neonTube(from,to,color,radius=.07,power=2.6){
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),direction=b.clone().sub(a);
  const group=new THREE.Group(),length=direction.length();
  if(length<1e-6)return group;
  const core=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,16),neonMaterial(color,power));
  core.quaternion.setFromUnitVectors(up,direction.normalize());core.position.copy(a).add(b).multiplyScalar(.5);
  group.add(core);
  const fringe=new THREE.Mesh(new THREE.CylinderGeometry(radius*3.5,radius*3.5,length,16),neonMaterial(color,1.5,.12));
  fringe.quaternion.copy(core.quaternion);fringe.position.copy(core.position);group.add(fringe);
  return group;
}

// Physical gaps remain dark while fixed LED dashes illuminate one after another.
// Each edge is partitioned independently so no dash cuts diagonally across a corner.
export class NeonDashLoop {
  constructor(points,color,{speed=29,phase=0,pitch=4.5,duty=.6,gapMultiplier=2}={}){
    this.speed=speed;this.phase=phase;this.totalLength=0;this.centers=[];this.gap=pitch*(1-duty)*gapMultiplier;
    this.group=new THREE.Group();this.group.name='platform_side_dashes';
    const transforms=[],matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
    for(let edge=1;edge<points.length;edge++){
      const a=new THREE.Vector3(...points[edge-1]),b=new THREE.Vector3(...points[edge]);
      const direction=b.clone().sub(a),length=direction.length();direction.normalize();
      const oldStep=length/Math.ceil(length/pitch),dashLength=oldStep*duty;
      const step=dashLength+oldStep*(1-duty)*gapMultiplier;
      const slots=Math.max(1,Math.floor(length/step));
      const inset=(length-(slots-1)*step-dashLength)/2;
      rotation.setFromUnitVectors(up,direction);
      for(let i=0;i<slots;i++){
        const distance=inset+dashLength/2+i*step;
        matrix.compose(a.clone().addScaledVector(direction,distance),rotation,new THREE.Vector3(1,dashLength,1));
        transforms.push(matrix.clone());this.centers.push(this.totalLength+distance);
      }
      this.totalLength+=length;
    }
    this.count=transforms.length;this.strengths=new Float32Array(this.count);
    this.core=new THREE.InstancedMesh(new THREE.CylinderGeometry(.115,.115,1,16),neonMaterial(color,4.5),this.count);
    this.fringe=new THREE.InstancedMesh(new THREE.CylinderGeometry(.31,.31,1,16),neonMaterial(color,2,.2),this.count);
    this.core.name='separate_led_dashes';this.fringe.name='separate_led_glow';
    for(const mesh of [this.core,this.fringe]){
      mesh.frustumCulled=false;
      transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));this.group.add(mesh);
    }
    this.color=new THREE.Color();this.update(0);
  }
  update(elapsed){
    const period=this.totalLength/3,head=elapsed*this.speed+this.phase*this.totalLength;
    for(let i=0;i<this.count;i++){
      const behind=THREE.MathUtils.euclideanModulo(head-this.centers[i],period);
      const strength=behind<period*.29?(1-behind/(period*.29))**1.4:0;
      this.strengths[i]=strength;
      this.color.setScalar(.018+strength);this.core.setColorAt(i,this.color);
      this.color.setScalar(strength);this.fringe.setColorAt(i,this.color);
    }
    this.core.instanceColor.needsUpdate=true;this.fringe.instanceColor.needsUpdate=true;
  }
}
export function platformEdgeLoops(config){
  const p=config.platform,xs=p.polygon.map(v=>v[0]),zs=p.polygon.map(v=>v[1]);
  // The extruded bevel projects beyond the configured top outline. Put the
  // side conduits outside its maximum extent, never inside the slab wall.
  const offset=p.bevelSize+.25;
  const x0=Math.min(...xs)-offset,x1=Math.max(...xs)+offset;
  const z0=Math.min(...zs)-offset,z1=Math.max(...zs)+offset;
  return [-1.55,-3.55].map(y=>[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1],[x0,y,z0]]);
}

export class NeonCurrent {
  constructor(points,color,{speed=14,phase=0,tail=6,loop=false,power=4.5}={}){
    this.points=points.map(p=>new THREE.Vector3(...p));this.lengths=[];this.totalLength=0;
    for(let i=1;i<this.points.length;i++){
      const length=this.points[i].distanceTo(this.points[i-1]);this.lengths.push(length);this.totalLength+=length;
    }
    this.speed=speed;this.phase=phase;this.tail=tail;this.loop=loop;
    this.group=new THREE.Group();this.group.name='traveling_neon_current';
    this.count=18;
    this.trail=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.16,1,16),neonMaterial(color,power),this.count);
    this.trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.trail.frustumCulled=false;
    for(let i=0;i<this.count;i++)this.trail.setColorAt(i,new THREE.Color().setScalar(.015+.985*(i/(this.count-1))**2));
    this.group.add(this.trail);
    this.head=new THREE.Mesh(new THREE.SphereGeometry(.23,12,8),neonMaterial(color,power*1.1));this.group.add(this.head);
    this.matrix=new THREE.Matrix4();this.rotation=new THREE.Quaternion();this.scale=new THREE.Vector3();
    this.a=new THREE.Vector3();this.b=new THREE.Vector3();this.direction=new THREE.Vector3();this.midpoint=new THREE.Vector3();
    this.update(0);
  }
  sample(distance,result=new THREE.Vector3()){
    let remaining=this.loop?THREE.MathUtils.euclideanModulo(distance,this.totalLength):THREE.MathUtils.clamp(distance,0,this.totalLength);
    for(let i=0;i<this.lengths.length;i++){
      const length=this.lengths[i];
      if(remaining<=length&&length>1e-6)return result.lerpVectors(this.points[i],this.points[i+1],remaining/length);
      remaining-=length;
    }
    return result.copy(this.points.at(-1));
  }
  update(elapsed){
    if(this.totalLength<1e-6)return;
    const head=THREE.MathUtils.euclideanModulo(elapsed*this.speed+this.phase*this.totalLength,this.totalLength);
    this.sample(head,this.head.position);
    for(let i=0;i<this.count;i++){
      this.sample(head-this.tail*(1-i/this.count),this.a);
      this.sample(head-this.tail*(1-(i+1)/this.count),this.b);
      this.direction.subVectors(this.b,this.a);const length=this.direction.length();
      this.midpoint.copy(this.a).add(this.b).multiplyScalar(.5);
      this.rotation.setFromUnitVectors(up,length>1e-6?this.direction.multiplyScalar(1/length):up);
      this.scale.set(1,Math.max(1e-6,length),1);
      this.matrix.compose(this.midpoint,this.rotation,this.scale);this.trail.setMatrixAt(i,this.matrix);
    }
    this.trail.instanceMatrix.needsUpdate=true;
  }
}
