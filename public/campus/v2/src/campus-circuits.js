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
    this.group = new THREE.Group();
    this.group.name = 'circuit_network';
    this.scene.add(this.group);
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

    // Register active branch
    this.branches.push({
      id: pathDef.id,
      color: new THREE.Color(pathDef.color),
      totalLength,
      pulseLength,
      samplePoint,
      pulseGeo,
      pulseLine,
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
      this.junctionNodes.push({ mesh: node, baseScale: 1.0, phase: Math.random() * Math.PI * 2 });
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

  update(deltaTime, elapsedTime) {
    // 1. Update electrical branch current pulses
    for (const b of this.branches) {
      if (b.currentPause > 0) {
        b.currentPause -= deltaTime;
        b.pulseLine.visible = false;
        continue;
      }

      b.pulseLine.visible = true;
      b.progress += (b.speed * deltaTime) / b.totalLength;

      if (b.progress >= 1.0) {
        b.progress = 0;
        b.currentPause = b.pauseTime;
      }

      const headDist = b.progress * b.totalLength;
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

    // 3. Update junction node pulse breathing
    for (const j of this.junctionNodes) {
      const s = 1.0 + 0.3 * Math.sin(elapsedTime * 3.0 + j.phase);
      j.mesh.scale.set(s, 1, s);
    }
  }
}
