/**
 * Learners Area 3D Campus Circuits & Electrical Animations
 * Embedded neon pathways with flowing electric currents,
 * sequential ring illumination, and road junction nodes.
 */

import * as THREE from '../vendor/three-runtime.js';
import {NeonCurrent,NeonDashLoop,neonTube,neonMaterial,platformEdgeLoops,scaleNeonEmission} from './campus-neon.js';
import {dashboardRingAngle} from './campus-motion.js';

// Street traces follow the blue/violet electrical network in the artwork.
// In particular, the Live classes branch runs beside Assignments rather
// than through the administrative building on its way to the pavilion.
export function campusRoadPath(module) {
  const routes={
    reading:[[-12,0],[-12,-18],[-26,-18],[-26,-38]],
    listening:[[-16,0],[-16,-4]],
    writing:[[-15,0],[-15,18],[-36,18],[-36,28]],
    speaking:[[-12,0],[-12,35],[-18,35]],
    grammar:[[0,16],[7,16],[7,39],[18,39]],
    vocabulary:[[14,0],[14,20],[33,20],[33,36]],
    progress:[[18,0]],
    mocks:[[16,0],[32,0],[32,-28]],
    assignments:[[12,0],[12,-20],[39,-20],[39,-48],[54,-48]],
    live_classes:[[0,-16],[4,-16],[4,-43],[24,-43]],
    video_lessons:[[0,-16],[-5,-16],[-5,-43],[-16,-43]],
  };
  const points=[[0,0],...(routes[module.id]||[])];
  const last=points.at(-1);
  // Keep the final connection orthogonal after a pavilion is repositioned.
  if(last[0]!==module.pos.x&&last[1]!==module.pos.z)points.push([module.pos.x,last[1]]);
  points.push([module.pos.x,module.pos.z]);
  // One shared blue guide keeps every route as bright as Writing.
  return {id:module.id,color:0x32bfff,
    points:points.map(([x,z])=>[x,.27,z])};
}

export class CampusCircuits {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.branches = [];
    this.currents=[];
    this.sideLoops=[];
    this.ringPulses = [];
    this.junctionNodes = [];
    this.groundHalos = [];
    this.ringBulbs = [];
    this.haloTexture = this.createHaloTexture();
    this.group = new THREE.Group();
    this.group.name = 'circuit_network';
    this.scene.add(this.group);
    this.dashboardRings=new THREE.Group();this.dashboardRings.name='dashboard_rotating_circuit_lights';
    this.group.add(this.dashboardRings);
  }

  // All glows are horizontal planes anchored to the road at the same height
  // as the reference lights. No rising particles or airborne bubbles.
  createHaloTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(64,64,0,64,64,64);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(.16,'rgba(255,255,255,.79)');
    g.addColorStop(.40,'rgba(255,255,255,.26)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = g;ctx.fillRect(0,0,128,128);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }
  addHalo(color, size=2, opacity=.35) {
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(size,size),
      new THREE.MeshBasicMaterial({map:this.haloTexture,color,transparent:true,opacity,
        depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
    mesh.rotation.x=-Math.PI/2;
    mesh.position.y=.135;this.group.add(mesh);
    return mesh;
  }

  // Define and build all 11 road circuit pathways connecting Dashboard to buildings
  buildCircuitNetwork(modules) {
    const pathways = modules.filter(m=>!m.isCenter).map(campusRoadPath);

    pathways.forEach((pathDef, idx) => {
      this.createPathBranch(pathDef, idx);
    });

    this.createDashboardRingPulses();
    this.createGroundRingLights();
  }

  createPathBranch(pathDef,branchIndex){
    const guide=new THREE.Group();guide.name='road_guide_'+pathDef.id;
    for(let i=1;i<pathDef.points.length;i++)guide.add(neonTube(pathDef.points[i-1],pathDef.points[i],pathDef.color,.115,4.2));
    scaleNeonEmission(guide,.95);
    this.group.add(guide);
    const currents=[];
    for(const [index,[color,power]] of [[0xff405b,6],[0xf4fbff,2.6],[0x42bfff,4.5]].entries()){
      const current=new NeonCurrent(pathDef.points,color,{speed:14,phase:branchIndex*.087+index/3,tail:6.5,power});
      current.group.name='road_current_'+pathDef.id;current.group.userData.color=color;
      scaleNeonEmission(current.group,.95);
      this.group.add(current.group);this.currents.push(current);currents.push(current);
    }
    this.branches.push({id:pathDef.id,currents,guide});
    for(let i=1;i<pathDef.points.length-1;i++){
      const node=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),neonMaterial(pathDef.color,2.1));
      node.position.set(...pathDef.points[i]);this.group.add(node);
      node.material.color.multiplyScalar(.95);
      const halo=this.addHalo(pathDef.color,1.65,.3);halo.position.set(node.position.x,.12,node.position.z);
      halo.material.color.multiplyScalar(.95);
      this.junctionNodes.push({mesh:node,halo,phase:branchIndex*.7+i*.43});
    }
  }

  buildPlatformNetwork(config){
    for(const [index,loop] of platformEdgeLoops(config).entries()){
      const color=index===0?0x00bdff:0x087bff;
      const dashes=new NeonDashLoop(loop,color,{speed:index===0?29:-24,phase:index*.18});
      this.group.add(dashes.group);this.sideLoops.push(dashes);
    }
    const p=config.platform.polygon;const top=p.map(([x,z])=>[x,.22,z]);top.push(top[0]);
    for(let i=1;i<top.length;i++)this.group.add(neonTube(top[i-1],top[i],0x007dff,.08,3.4));
    const bottom=platformEdgeLoops(config)[1].map(([x,,z])=>[x,-config.platform.height+.16,z]);
    this.lowerRim=new THREE.Group();this.lowerRim.name='platform_lower_continuous_rim';
    for(let i=1;i<bottom.length;i++)this.lowerRim.add(neonTube(bottom[i-1],bottom[i],0x40cfff,.105,3.8));
    this.group.add(this.lowerRim);
  }

  addFoundationCurrent(building,config){
    const current=new NeonCurrent(building.userData.foundationLoop,config.color,{speed:7,phase:.25,tail:4,loop:true});
    current.group.name='foundation_current';building.add(current.group);this.currents.push(current);
  }

  // Sequential traveling pulse segments around Dashboard concentric rings
  createDashboardRingPulses() {
    const ringRadii = [13.5, 11.0, 8.5];
    const ringColors = [0x00e5ff, 0x0099ff, 0x00e5ff];

    ringRadii.forEach((radius, idx) => {
      // Create a traveling arc segment using Torus
      const arcLength = Math.PI * 0.35;
      const arcGeo = new THREE.TorusGeometry(radius, 0.22, 12, 32, arcLength);
      arcGeo.rotateX(Math.PI / 2);

      const arcMat = new THREE.MeshBasicMaterial({
        color: ringColors[idx],
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      });

      const arcMesh = new THREE.Mesh(arcGeo, arcMat);
      arcMesh.position.y = 0.09 + idx * 0.02;
      this.dashboardRings.add(arcMesh);

      this.ringPulses.push({
        mesh: arcMesh,
        speed: (idx % 2 === 0 ? 0.85 : -0.65) * (1.0 + idx * 0.2),
        angle: (idx * Math.PI * 0.6),
      });
    });
  }

  createGroundRingLights() {
    const rings=[8.5,11,13.5];
    rings.forEach((radius,ri)=>{
      for(let i=0;i<28;i++){
        const angle=2*Math.PI*i/28;
        const color=ri===1?0x70edff:0x19d8ff;
        const point=new THREE.Mesh(new THREE.CircleGeometry(.19,12),
          new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55,
            depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
        point.rotation.x=-Math.PI/2;
        point.position.set(Math.cos(angle)*radius,.143,Math.sin(angle)*radius);
        this.dashboardRings.add(point);
        const halo=this.addHalo(color,1.9,.29);
        halo.position.set(point.position.x,.142,point.position.z);
        this.dashboardRings.add(halo);
        this.ringBulbs.push({point,halo,index:i,ring:ri});
      }
    });
  }

  update(deltaTime, elapsedTime) {
    // Position is an absolute function of time, so switching tabs never freezes
    // a current at its first frame or leaves a zero-sized bounding sphere.
    for(const current of this.currents)current.update(elapsedTime);
    for(const loop of this.sideLoops)loop.update(elapsedTime);
    this.dashboardRings.rotation.y=dashboardRingAngle(elapsedTime);

    // 2. Update Dashboard ring rotating illumination
    for (const r of this.ringPulses) {
      r.angle += r.speed * deltaTime;
      r.mesh.rotation.y = r.angle;
    }

    for(const light of this.ringBulbs){
      const phase=elapsedTime*2.3-light.index*.24-light.ring*.70;
      const strength=.14+.86*Math.pow(Math.max(0,Math.sin(phase)),4);
      light.point.material.opacity=strength;
      light.halo.material.opacity=.32*strength;
    }

    // 3. Update junction node pulse breathing
    for (const j of this.junctionNodes) {
      const s = 1.0 + 0.3 * Math.sin(elapsedTime * 3.0 + j.phase);
      j.mesh.scale.set(s,s,1);
      j.halo.material.opacity=.17+.22*Math.pow(Math.max(0,Math.sin(elapsedTime*3+j.phase)),2);
    }
  }
}


