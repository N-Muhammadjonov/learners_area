/**
 * Learners Area 3D Campus Materials
 * High-quality PBR materials, emissive neon glows, and custom pulse shaders.
 */

import * as THREE from '../vendor/three-runtime.js';

export class CampusMaterials {
  constructor() {
    this.textureLoader = new THREE.TextureLoader();
    this.materials = new Map();
    this.animatedMaterials = [];
    this.initCommonMaterials();
  }

  initCommonMaterials() {
    // 1. Asphalt Ground
    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x0c1424,
      roughness: 0.88,
      metalness: 0.12,
      flatShading: false,
    });
    this.materials.set('asphalt', asphaltMat);

    // 2. Platform Vertical Slab Sides
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x070d19,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.materials.set('platform_slab', slabMat);

    // 3. Platform Outer Neon Border
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
    });
    this.materials.set('platform_rim', rimMat);

    // 4. Polished Gold (Trophy, Brain, LA Logo accents)
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.22,
      metalness: 0.88,
      emissive: 0xb45309,
      emissiveIntensity: 0.25,
    });
    this.materials.set('gold', goldMat);

    // 5. Bright Polished Gold (Trophy cup)
    const trophyGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffbd22,
      roughness: .38,
      metalness: .5,
      emissive: 0x9b4c02,
      emissiveIntensity: .2,
    });
    this.materials.set('trophy_gold', trophyGoldMat);

    // 6. Chrome / Silver (Microphone, clip, ferrule)
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.15,
      metalness: 0.95,
    });
    this.materials.set('chrome', chromeMat);

    // 7. Dark Metal (Window mullions, bench frames, lamp posts)
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.6,
    });
    this.materials.set('dark_metal', darkMetalMat);

    // 8. Wood (Benches, pencil body wood cone)
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x92400e,
      roughness: 0.75,
      metalness: 0.05,
    });
    this.materials.set('wood', woodMat);

    const pencilWoodMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      roughness: 0.65,
      metalness: 0.05,
    });
    this.materials.set('pencil_wood', pencilWoodMat);

    // 9. Pencil Eraser
    const eraserMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      roughness: 0.5,
      metalness: 0.05,
    });
    this.materials.set('pencil_eraser', eraserMat);

    // 10. Pencil Lead
    const leadMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.8,
    });
    this.materials.set('pencil_lead', leadMat);

    // 11. Book Paper (Reading open book pages)
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xfffefa,
      emissive: 0xffffff,
      emissiveIntensity: .28,
      roughness: .9,
      metalness: 0,
    });
    this.materials.set('book_paper', paperMat);

    // 12. Tree Foliage (Teal / deep green low-poly)
    const treePineMat = new THREE.MeshStandardMaterial({
      color: 0x075f61,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x022c22,
      emissiveIntensity: 0.2,
      flatShading: true,
    });
    this.materials.set('tree_pine', treePineMat);

    const treeRoundMat = new THREE.MeshStandardMaterial({
      color: 0x047857,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x064e3b,
      emissiveIntensity: 0.15,
      flatShading: true,
    });
    this.materials.set('tree_round', treeRoundMat);

    // 13. Streetlight Globe (Warm golden white glow)
    const lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      emissive: 0xfef08a,
      emissiveIntensity: .7,
      roughness: 0.2,
    });
    this.materials.set('lamp_glow', lampGlowMat);
    this.animatedMaterials.push({
      mat: lampGlowMat,
      type: 'breathe',
      base: 2.2,
      amp: 0.4,
      freq: 1.8,
    });

    // 14. Dashboard Center Vertical Light Beam
    this.createVolumetricBeamMaterial();
  }

  createVolumetricBeamMaterial() {
    const beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x00e5ff) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          // Fade from bright at bottom to transparent at top
          float verticalFade = pow(1.0 - vUv.y, 1.8);
          // Soft rim effect
          float rim = pow(1.0 - abs(vNormal.z), 1.5);
          // Subtle pulsation
          float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
          float alpha = clamp(verticalFade * rim * 0.07 * pulse, 0.0, 1.0);
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.set('dashboard_beam', beamMat);
    this.animatedMaterials.push({ mat: beamMat, type: 'shader' });
  }

  // Create building wall and trim materials matching module color
  getBuildingMaterials(moduleConfig) {
    const key = `bldg_${moduleConfig.id}`;
    if (this.materials.has(key)) return this.materials.get(key);

    const baseColor = new THREE.Color(moduleConfig.color);
    const emissiveColor = new THREE.Color(moduleConfig.emissive);

    // Wall stone / panels
    const wallColor = baseColor.clone().multiplyScalar(.72).add(new THREE.Color(0x090f1d));
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      emissive: baseColor.clone().multiplyScalar(.1),
      roughness: 0.72,
      metalness: 0.28,
      flatShading: false,
    });

    // Glowing roof trim / architectural accents
    const trimMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emissiveColor,
      emissiveIntensity: .045,
      roughness: .92,
      metalness: .02,
    });

    if(['speaking','vocabulary'].includes(moduleConfig.id)){trimMat.color.multiplyScalar(.76);trimMat.emissiveIntensity=.02;}

    // Glowing foundation neon band
    const foundationMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emissiveColor,
      emissiveIntensity: .7,
      roughness: 0.2,
    });
    this.animatedMaterials.push({
      mat: foundationMat,
      type: 'pulse',
      base: .7,
      amp: .12,
      freq: 1.5 + [...moduleConfig.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%5*.1,
    });

    // Glowing illuminated windows
    const coolWindows=['listening','writing','live_classes'].includes(moduleConfig.id);
    const windowColor=coolWindows?baseColor.clone().lerp(new THREE.Color(0xacfaff),.22):new THREE.Color(0xffbc60);
    const windowMat = new THREE.MeshStandardMaterial({
      color: windowColor,
      emissive: windowColor,
      emissiveIntensity: 1.4,
      roughness: 0.33,
      metalness: 0.04,
    });

    const set = { wall: wallMat, trim: trimMat, foundation: foundationMat, window: windowMat };
    this.materials.set(key, set);
    return set;
  }

  update(deltaTime, elapsedTime) {
    for (const item of this.animatedMaterials) {
      if (item.type === 'shader') {
        if (item.mat.uniforms && item.mat.uniforms.uTime) {
          item.mat.uniforms.uTime.value = elapsedTime;
        }
      } else if (item.type === 'pulse') {
        item.mat.emissiveIntensity = item.base + Math.sin(elapsedTime * item.freq + (item.phase||0)) * item.amp;
      } else if (item.type === 'breathe') {
        item.mat.emissiveIntensity = item.base + Math.sin(elapsedTime * item.freq + (item.phase||0)) * item.amp;
      }
    }
  }
}
