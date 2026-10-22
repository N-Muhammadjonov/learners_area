/**
 * Learners Area 3D Campus Circuits & Electrical Animations
 * Embedded neon pathways with flowing electric currents,
 * sequential ring illumination, and road junction nodes.
 */

import * as THREE from 'https://esm.sh/three@0.180.0';

export class CampusCircuits {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.branches = [];
    this.ringPulses = [];
    this.junctionNodes = [];
    this.groundHalos = [];
    this.ringBulbs = [];
    this.haloTexture = this.createHaloTexture();
    this.group = new THREE.Group();
    this.group.name = 'circuit_network';
    this.scene.add(this.group);
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
    const pathways = modules.filter(m=>!m.isCenter).map((m,idx)=>{
      const x=m.pos.x,z=m.pos.z;
      const middleX=x*.56,middleZ=z*.55;
      return {id:m.id,color:m.color,points:[
        [0,0.075,0],[middleX,0.075,0],[middleX,0.075,middleZ],
        [x,0.075,middleZ],[x,0.075,z]
      ]};
    });

    pathways.forEach((pathDef, idx) => {
      this.createPathBranch(pathDef, idx);
    });

    this.createDashboardRingPulses();
    this.createGroundRingLights();
  }

  createPathBranch(pathDef, branchIndex) {
    const rawPoints = pathDef.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    
    // Create base static trace strip
    const baseMat = new THREE.LineBasicMaterial({
      color: pathDef.color,
      linewidth: 2,
      transparent: true,
      opacity: 0.88,
    });
    const lineGeo = new THREE.BufferGeometry().setFromPoints(rawPoints);
    const baseLine = new THREE.Line(lineGeo, baseMat);
    this.group.add(baseLine);
    // Thin neon cores + translucent atmospheric fringe, both physically
    // embedded in the asphalt; linewidth on WebGL lines is unreliable.
    for(let i=0;i<rawPoints.length-1;i++){
      const from=rawPoints[i],to=rawPoints[i+1],direction=new THREE.Vector3().subVectors(to,from);
      const length=direction.length();
      if(length<.01)continue;
      const midpoint=new THREE.Vector3().addVectors(from,to).multiplyScalar(.5);
      const rotation=new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0,1,0),direction.normalize());
      for(const [radius,opacity] of [[.057,.98],[.27,.20]]){
        const tube=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,6),
          new THREE.MeshBasicMaterial({color:pathDef.color,transparent:true,
            opacity,depthWrite:false,blending:THREE.AdditiveBlending}));
        tube.position.copy(midpoint);tube.position.y+=.036;
        tube.quaternion.copy(rotation);
        this.group.add(tube);
      }
    }

    // Compute total path length and cumulative segment distances
    let totalLength = 0;
    const segLengths = [];
    for (let i = 0; i < rawPoints.length - 1; i++) {
      const len = rawPoints[i].distanceTo(rawPoints[i + 1]);
      segLengths.push(len);
      totalLength += len;
    }

    // Function to sample position along polyline at distance d (0 <= d <= totalLength)
    const samplePoint = (dist) => {
      let accumulated = 0;
      for (let i = 0; i < segLengths.length; i++) {
        if (dist <= accumulated + segLengths[i]) {
          const t = (dist - accumulated) / segLengths[i];
          return new THREE.Vector3().lerpVectors(rawPoints[i], rawPoints[i + 1], t);
        }
        accumulated += segLengths[i];
      }
      return rawPoints[rawPoints.length - 1].clone();
    };

    // Create an animated current pulse head & tail
    const pulseLength = Math.min(6.5, totalLength * 0.4);
    const pulsePointsCount = 12;
    const pulsePositions = new Float32Array(pulsePointsCount * 3);
    const pulseColors = new Float32Array(pulsePointsCount * 3);

    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));

    const pulseMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 3,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    const pulseLine = new THREE.Line(pulseGeo, pulseMat);
    this.group.add(pulseLine);
    const streak=new THREE.Mesh(new THREE.BoxGeometry(1.05,.026,.115),
      new THREE.MeshBasicMaterial({color:0xf9ffff,transparent:true,opacity:.96,
        depthWrite:false,blending:THREE.AdditiveBlending}));
    streak.position.y=.16;this.group.add(streak);
    const halo=this.addHalo(pathDef.color,2.7,.46);

    // Register active branch
    this.branches.push({
      id: pathDef.id,
      color: new THREE.Color(pathDef.color),
      totalLength,
      pulseLength,
      samplePoint,
      pulseGeo,
      pulseLine,
      streak,
      halo,
      speed: 12.0 + Math.random() * 4.0, // units per second
      progress: (branchIndex * 0.35) % 1.0, // staggered start phase
      pauseTime: 0.5 + Math.random() * 1.5,
      currentPause: 0,
    });

    // Add glowing junction pads at corners
    for (let i = 1; i < rawPoints.length - 1; i++) {
      const nodeGeo = new THREE.PlaneGeometry(0.8, 0.8);
      nodeGeo.rotateX(-Math.PI / 2);
      const nodeMat = new THREE.MeshBasicMaterial({
        color: pathDef.color,
        side: THREE.DoubleSide,
      });
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.copy(rawPoints[i]);
      node.position.y += 0.01;
      this.group.add(node);
      const halo=this.addHalo(pathDef.color,1.65,.30);
      halo.position.set(node.position.x,.14,node.position.z);
      this.junctionNodes.push({ mesh: node,halo, baseScale: 1.0, phase: Math.random() * Math.PI * 2 });
    }
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
      this.group.add(arcMesh);

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
        this.group.add(point);
        const halo=this.addHalo(color,1.9,.29);
        halo.position.set(point.position.x,.142,point.position.z);
        this.ringBulbs.push({point,halo,index:i,ring:ri});
      }
    });
  }

  update(deltaTime, elapsedTime) {
    // 1. Update electrical branch current pulses
    for (const b of this.branches) {
      if (b.currentPause > 0) {
        b.currentPause -= deltaTime;
        b.pulseLine.visible = false;
        b.streak.visible=false;b.halo.visible=false;
        continue;
      }

      b.pulseLine.visible = true;
      b.streak.visible=true;b.halo.visible=true;
      b.progress += (b.speed * deltaTime) / b.totalLength;

      if (b.progress >= 1.0) {
        b.progress = 0;
        b.currentPause = b.pauseTime;
      }

      const headDist = b.progress * b.totalLength;
      const head=b.samplePoint(headDist);
      const behind=b.samplePoint(Math.max(0,headDist-.45));
      b.streak.position.set(head.x,.164,head.z);
      b.streak.rotation.y=-Math.atan2(head.z-behind.z,head.x-behind.x);
      b.halo.position.set(head.x,.147,head.z);
      const tailDist = Math.max(0, headDist - b.pulseLength);

      const posAttr = b.pulseGeo.attributes.position;
      const colAttr = b.pulseGeo.attributes.color;
      const count = posAttr.count;

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const curDist = tailDist + t * (headDist - tailDist);
        const pt = b.samplePoint(curDist);

        posAttr.setXYZ(i, pt.x, pt.y + 0.02, pt.z);

        // Alpha / brightness falls off from head to tail
        const brightness = Math.pow(t, 1.4);
        colAttr.setXYZ(i, b.color.r * brightness, b.color.g * brightness, b.color.b * brightness);
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

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
