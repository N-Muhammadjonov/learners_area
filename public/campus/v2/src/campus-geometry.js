/**
 * Learners Area 3D Campus Geometry
 * Procedural low-poly architectures, genuine 3D rooftop landmarks,
 * platform slab, trees, benches, lamp posts, and official LA logo dais.
 */

import * as THREE from 'https://esm.sh/three@0.180.0';

export class CampusGeometry {
  constructor(materials) {
    this.materials = materials;
  }

  // =========================================================================
  // 1. MAIN CAMPUS PLATFORM
  // =========================================================================
  createPlatform(config) {
    const group = new THREE.Group();
    group.name = 'platform_root';

    const p = config.platform;
    const h = p.height;
    const poly = p.polygon;

    // Create calibrated platform perimeter polygon shape
    const shape = new THREE.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      shape.lineTo(poly[i][0], poly[i][1]);
    }
    shape.closePath();

    // Extrude platform slab downwards
    const extrudeSettings = {
      steps: 1,
      depth: h,
      bevelEnabled: true,
      bevelThickness: p.bevelSize,
      bevelSize: p.bevelSize,
      bevelSegments: 2,
    };

    const slabGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    slabGeo.rotateX(Math.PI / 2); // align to XZ plane
    slabGeo.translate(0, -h, 0);

    const slabMesh = new THREE.Mesh(slabGeo, this.materials.materials.get('platform_slab'));
    slabMesh.receiveShadow = true;
    group.add(slabMesh);

    // Asphalt surface plane (top face)
    const asphaltGeo = new THREE.ShapeGeometry(shape);
    asphaltGeo.rotateX(-Math.PI / 2);
    asphaltGeo.translate(0, 0.02, 0);

    const asphaltMesh = new THREE.Mesh(asphaltGeo, this.materials.materials.get('asphalt'));
    asphaltMesh.receiveShadow = true;
    group.add(asphaltMesh);

    // Platform Outer Glowing Rim (Double Neon Border)
    const points = shape.getPoints();
    const linePoints = points.map(pt => new THREE.Vector3(pt.x, 0.08, pt.y));
    linePoints.push(linePoints[0]); // close loop

    const rimGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const rimLine = new THREE.Line(rimGeo, this.materials.materials.get('platform_rim'));
    group.add(rimLine);

    // Slightly inset secondary neon trace
    const innerPoints = shape.getPoints().map(pt => {
      const mag = Math.hypot(pt.x, pt.y);
      const factor = (mag - 1.2) / mag;
      return new THREE.Vector3(pt.x * factor, 0.08, pt.y * factor);
    });
    innerPoints.push(innerPoints[0]);
    const innerRimGeo = new THREE.BufferGeometry().setFromPoints(innerPoints);
    const innerRimMat = new THREE.LineBasicMaterial({ color: 0x0099ff, linewidth: 1.5 });
    const innerRimLine = new THREE.Line(innerRimGeo, innerRimMat);
    group.add(innerRimLine);

    // Dedicated illuminated strips on the SIDE of the slab, not just its top.
    // Segmenting the edges creates the alternating road-light pattern in the reference.
    const borderGlow=new THREE.MeshBasicMaterial({color:p.rimGlowColor,transparent:true,
      opacity:.91,depthWrite:false,blending:THREE.AdditiveBlending});
    const borderDim=new THREE.MeshBasicMaterial({color:p.rimInnerColor,transparent:true,
      opacity:.52,depthWrite:false});
    for(let edge=0;edge<poly.length;edge++){
      const [ax,az]=poly[edge], [bx,bz]=poly[(edge+1)%poly.length];
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),segments=Math.ceil(len/5.5);
      for(let i=0;i<segments;i++){
        const a=(i+.12)/segments,b=(i+.84)/segments;
        const x=ax+(bx-ax)*(a+b)/2,z=az+(bz-az)*(a+b)/2;
        const width=len*(b-a);
        const neon=new THREE.Mesh(new THREE.BoxGeometry(width,.11,.15),
          i%3===0?borderDim:borderGlow);
        neon.position.set(x,-1.45,z);
        neon.rotation.y=-Math.atan2(dz,dx);
        group.add(neon);
        // A second, lower side trace makes the platform visibly volumetric.
        if(i%2===0){
          const under=new THREE.Mesh(new THREE.BoxGeometry(width*.65,.08,.13),borderDim);
          under.position.set(x,-3.15,z);
          under.rotation.y=neon.rotation.y;group.add(under);
        }
      }
    }
    return group;
  }

  // =========================================================================
  // 2. CENTRAL DASHBOARD DAIS & OFFICIAL LEARNERS AREA LA LOGO
  // =========================================================================
  createDashboard(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_dashboard';
    group.userData = { id: config.id, name: config.name, route: config.route };

    // Concentric circular cyan neon rings
    const ringRadii = [13.5, 11.0, 8.5, 6.0];
    ringRadii.forEach((r, idx) => {
      const ringGeo = new THREE.RingGeometry(r - 0.18, r + 0.18, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: idx === 0 ? 0x00e5ff : idx === 1 ? 0x0099ff : 0x00e5ff,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.05 + idx * 0.02;
      group.add(ringMesh);
    });

    // Radial dash lines on mid ring
    const dashesGroup = new THREE.Group();
    const numDashes = 16;
    for (let i = 0; i < numDashes; i++) {
      const angle = (i / numDashes) * Math.PI * 2;
      const dashGeo = new THREE.PlaneGeometry(0.35, 2.2);
      dashGeo.rotateX(-Math.PI / 2);
      dashGeo.rotateY(angle);
      const dashMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide });
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.position.set(Math.cos(angle) * 9.75, 0.07, Math.sin(angle) * 9.75);
      dashesGroup.add(dash);
    }
    group.add(dashesGroup);
    group.userData.dashes = dashesGroup;

    // Stepped central cylindrical dais
    const daisGeo1 = new THREE.CylinderGeometry(5.2, 5.8, 0.6, 48);
    const daisMat1 = new THREE.MeshStandardMaterial({
      color: 0x0b172a,
      roughness: 0.7,
      metalness: 0.3,
    });
    const dais1 = new THREE.Mesh(daisGeo1, daisMat1);
    dais1.position.y = 0.3;
    group.add(dais1);

    const daisGeo2 = new THREE.CylinderGeometry(4.2, 4.6, 0.5, 48);
    const daisMat2 = new THREE.MeshStandardMaterial({
      color: 0x091424,
      roughness: 0.6,
      metalness: 0.4,
      emissive: 0x002244,
      emissiveIntensity: 0.4,
    });
    const dais2 = new THREE.Mesh(daisGeo2, daisMat2);
    dais2.position.y = 0.75;
    group.add(dais2);

    // Glowing dais edge rings
    const edgeRingGeo = new THREE.TorusGeometry(4.2, 0.12, 16, 48);
    edgeRingGeo.rotateX(Math.PI / 2);
    const edgeRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const edgeRing = new THREE.Mesh(edgeRingGeo, edgeRingMat);
    edgeRing.position.y = 1.0;
    group.add(edgeRing);

    // Raised rocket-inspired central tower supporting the single official LA emblem.
    const tower = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({color:0x143b69,metalness:.43,roughness:.33,emissive:0x063b65,emissiveIntensity:.42});
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(3.1,3.8,2.4,8),towerMat);stage.position.y=2.0;tower.add(stage);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.48,2.7,4.0,8),towerMat);stem.position.y=4.7;tower.add(stem);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.9,2.1,8),this.materials.materials.get('platform_rim'));crown.position.y=7.6;tower.add(crown);
    for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){const fin = new THREE.Mesh(new THREE.BoxGeometry(.38,3.0,1.5),this.materials.materials.get('platform_rim'));fin.position.set(Math.sin(angle)*2.2,3.7,Math.cos(angle)*2.2);fin.rotation.y=angle;tower.add(fin);}
    group.add(tower);

    // Volumetric vertical light beam
    const beam = this.materials.materials.get('dashboard_beam');
    if (beam) {
      const beamGeo = new THREE.CylinderGeometry(3.5, 6.0, 24, 32, 1, true);
      const beamMesh = new THREE.Mesh(beamGeo, beam);
      beamMesh.position.y = 12.0;
      group.add(beamMesh);
    }

    // THE EXACT OFFICIAL LEARNERS AREA LA LOGO
    // Loaded from the official transparent brand asset: la-logo-clean.png
    const textureLoader = new THREE.TextureLoader();
    const laTexture = textureLoader.load('/brand/derived/mark-day-cutout-192.png');
    laTexture.colorSpace = THREE.SRGBColorSpace;

    // A single, camera-facing sprite prevents the LA mark from being mirrored
    // or disappearing when orbiting behind the central platform.
    const logoMat = new THREE.SpriteMaterial({
      map: laTexture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.03,
    });
    const logoMesh = new THREE.Sprite(logoMat);
    logoMesh.position.set(0, 9.2, 0);
    logoMesh.scale.set(8.4, 8.4, 1);
    group.add(logoMesh);
    group.userData.logo = logoMesh;

    // Central cyan point light illuminating the logo and surrounding platform
    const centerLight = new THREE.PointLight(0x00e5ff, 2.5, 35, 1.2);
    centerLight.position.set(0, 4.5, 0);
    group.add(centerLight);

    return group;
  }

  // =========================================================================
  // 3. READING (WARM AMBER / GOLD - 3D OPEN BOOK)
  // =========================================================================
  createReading(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_reading';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Stepped plinth with foundation neon
    const plinthGeo = new THREE.BoxGeometry(11.5, 0.6, 10.5);
    const plinth = new THREE.Mesh(plinthGeo, mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRimGeo = new THREE.BoxGeometry(11.8, 0.15, 10.8);
    const glowRim = new THREE.Mesh(glowRimGeo, mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Main classical hall building
    const hallGeo = new THREE.BoxGeometry(9.5, 4.8, 8.5);
    const hall = new THREE.Mesh(hallGeo, mats.wall);
    hall.position.y = 3.0;
    group.add(hall);

    // Front colonnade pillars (4 pillars)
    const pillarMat = this.materials.materials.get('gold');
    for (let i = 0; i < 4; i++) {
      const px = -3.3 + i * 2.2;
      const pillarGeo = new THREE.CylinderGeometry(0.35, 0.4, 4.6, 16);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 2.9, 4.6);
      group.add(pillar);
    }

    // Pediment triangular roof
    const pedimentShape = new THREE.Shape();
    pedimentShape.moveTo(-5.2, 0);
    pedimentShape.lineTo(0, 2.4);
    pedimentShape.lineTo(5.2, 0);
    pedimentShape.closePath();

    const pedimentGeo = new THREE.ExtrudeGeometry(pedimentShape, { steps: 1, depth: 9.2, bevelEnabled: false });
    pedimentGeo.translate(0, 5.4, -4.6);
    const pediment = new THREE.Mesh(pedimentGeo, mats.trim);
    group.add(pediment);

    // Glowing warm windows
    for (let i = 0; i < 3; i++) {
      const winGeo = new THREE.PlaneGeometry(1.6, 2.4);
      const win = new THREE.Mesh(winGeo, mats.window);
      win.position.set(-2.5 + i * 2.5, 3.2, 4.3);
      group.add(win);
    }

    // ROOFTOP LANDMARK: 3D OPEN BOOK
    const bookGroup = new THREE.Group();
    bookGroup.position.set(0, 8.2, 0);
    bookGroup.rotation.y = Math.PI / 4;

    // Hardcover leather spine/back
    const spineGeo = new THREE.CylinderGeometry(0.3, 0.3, 5.8, 12, 1, false, 0, Math.PI);
    spineGeo.rotateZ(Math.PI / 2);
    const spine = new THREE.Mesh(spineGeo, this.materials.materials.get('wood'));
    bookGroup.add(spine);

    // Left curved page block
    const leftPageGeo = new THREE.BoxGeometry(3.6, 0.4, 5.4);
    const leftPage = new THREE.Mesh(leftPageGeo, this.materials.materials.get('book_paper'));
    leftPage.position.set(-1.8, 0.4, 0);
    leftPage.rotation.z = 0.28; // tilted open
    bookGroup.add(leftPage);

    // Right curved page block
    const rightPageGeo = new THREE.BoxGeometry(3.6, 0.4, 5.4);
    const rightPage = new THREE.Mesh(rightPageGeo, this.materials.materials.get('book_paper'));
    rightPage.position.set(1.8, 0.4, 0);
    rightPage.rotation.z = -0.28; // tilted open
    bookGroup.add(rightPage);

    // Amber edge glow on book
    const bookGlowMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.8,
    });
    const bookCoverLeft = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.15, 5.6), bookGlowMat);
    bookCoverLeft.position.set(-1.9, 0.15, 0);
    bookCoverLeft.rotation.z = 0.28;
    bookGroup.add(bookCoverLeft);

    const bookCoverRight = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.15, 5.6), bookGlowMat);
    bookCoverRight.position.set(1.9, 0.15, 0);
    bookCoverRight.rotation.z = -0.28;
    bookGroup.add(bookCoverRight);

    group.add(bookGroup);
    return group;
  }

  // =========================================================================
  // 4. LISTENING (ELECTRIC BLUE - 3D DETAILED HEADPHONES)
  // =========================================================================
  createListening(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_listening';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Stepped plinth with foundation neon
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.6, 10.0), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.15, 10.4), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Lower tier
    const lower = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3.4, 8.6), mats.wall);
    lower.position.y = 2.3;
    group.add(lower);

    // Lower tier panoramic glowing windows
    const winFront = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 1.8), mats.window);
    winFront.position.set(0, 2.3, 4.35);
    group.add(winFront);

    // Upper tier
    const upper = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.8, 6.0), mats.wall);
    upper.position.y = 5.4;
    group.add(upper);

    // Roof trim
    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.4, 6.4), mats.trim);
    roofTrim.position.y = 6.9;
    group.add(roofTrim);

    // ROOFTOP LANDMARK: 3D HEADPHONES
    const hpGroup = new THREE.Group();
    hpGroup.position.set(0, 8.0, 0);
    hpGroup.rotation.y = Math.PI / 4;

    // Arched Headband (half Torus)
    const bandGeo = new THREE.TorusGeometry(3.2, 0.45, 16, 32, Math.PI);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.25,
      metalness: 0.7,
      emissive: 0x0099ff,
      emissiveIntensity: 0.4,
    });
    const headband = new THREE.Mesh(bandGeo, bandMat);
    headband.rotation.z = 0;
    hpGroup.add(headband);

    // Inner cushion pad
    const cushionGeo = new THREE.TorusGeometry(3.0, 0.28, 16, 32, Math.PI * 0.75);
    const padMat = this.materials.materials.get('dark_metal');
    const cushion = new THREE.Mesh(cushionGeo, padMat);
    cushion.rotation.z = Math.PI * 0.125;
    hpGroup.add(cushion);

    // Ear Cups (Left and Right)
    const cupMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      roughness: 0.3,
      metalness: 0.8,
    });
    const ringGlowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    [-3.2, 3.2].forEach((xPos, idx) => {
      const earCupGroup = new THREE.Group();
      earCupGroup.position.set(xPos, 0, 0);
      earCupGroup.rotation.y = idx === 0 ? 0.25 : -0.25;

      // Outer housing cylinder
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.1, 24), cupMat);
      housing.rotation.z = Math.PI / 2;
      earCupGroup.add(housing);

      // Glowing outer accent ring
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 16, 32), ringGlowMat);
      glowRing.rotation.y = Math.PI / 2;
      glowRing.position.x = idx === 0 ? -0.55 : 0.55;
      earCupGroup.add(glowRing);

      // Soft donut cushion
      const earDonut = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.35, 16, 24), padMat);
      earDonut.rotation.y = Math.PI / 2;
      earDonut.position.x = idx === 0 ? 0.4 : -0.4;
      earCupGroup.add(earDonut);

      hpGroup.add(earCupGroup);
    });

    group.add(hpGroup);
    return group;
  }

  // =========================================================================
  // 5. WRITING (EMERALD GREEN - LARGE 3D PENCIL)
  // =========================================================================
  createWriting(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_writing';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation & plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 9.5), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 9.9), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Main studio building
    const studio = new THREE.Mesh(new THREE.BoxGeometry(8.8, 4.4, 7.8), mats.wall);
    studio.position.y = 2.8;
    group.add(studio);

    // Overhanging green roof eaves
    const eaves = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 8.6), mats.trim);
    eaves.position.y = 5.2;
    group.add(eaves);

    // Windows with mullions
    for (let i = 0; i < 2; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), mats.window);
      win.position.set(-2.0 + i * 4.0, 3.0, 3.95);
      group.add(win);
    }

    // ROOFTOP LANDMARK: LARGE 3D PENCIL
    const pencilGroup = new THREE.Group();
    pencilGroup.position.set(0, 6.8, 0);
    // Angled upwards at 35 degrees pointing top-right
    pencilGroup.rotation.y = Math.PI / 4;
    pencilGroup.rotation.z = -0.55;

    // Hexagonal pencil body (6-sided cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.75, 0.75, 6.5, 6);
    const pencilBodyMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.35,
      metalness: 0.25,
      emissive: 0x059669,
      emissiveIntensity: 0.5,
    });
    const body = new THREE.Mesh(bodyGeo, pencilBodyMat);
    pencilGroup.add(body);

    // Sharpened wooden cone collar
    const coneGeo = new THREE.ConeGeometry(0.75, 2.0, 24);
    const cone = new THREE.Mesh(coneGeo, this.materials.materials.get('pencil_wood'));
    cone.position.y = 4.25;
    pencilGroup.add(cone);

    // Graphite lead tip
    const tipGeo = new THREE.ConeGeometry(0.28, 0.75, 16);
    const tip = new THREE.Mesh(tipGeo, this.materials.materials.get('pencil_lead'));
    tip.position.y = 4.88;
    pencilGroup.add(tip);

    // Gold ferrule ring
    const ferruleGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.7, 16);
    const ferrule = new THREE.Mesh(ferruleGeo, this.materials.materials.get('gold'));
    ferrule.position.y = -3.5;
    pencilGroup.add(ferrule);

    // Pink rubber eraser
    const eraserGeo = new THREE.CylinderGeometry(0.74, 0.74, 0.9, 16);
    const eraser = new THREE.Mesh(eraserGeo, this.materials.materials.get('pencil_eraser'));
    eraser.position.y = -4.1;
    pencilGroup.add(eraser);

    group.add(pencilGroup);
    return group;
  }

  // =========================================================================
  // 6. SPEAKING (PURPLE / VIOLET - 3D MICROPHONE & SOUND WAVES)
  // =========================================================================
  createSpeaking(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_speaking';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 9.5), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 9.9), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Stepped building body
    const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.0, 7.8), mats.wall);
    body.position.y = 2.6;
    group.add(body);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 8.4), mats.trim);
    roofTrim.position.y = 4.8;
    group.add(roofTrim);

    // Vertical glowing purple windows
    for (let i = 0; i < 3; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), mats.window);
      win.position.set(-2.2 + i * 2.2, 2.7, 3.95);
      group.add(win);
    }

    // ROOFTOP LANDMARK: 3D STUDIO MICROPHONE
    const micGroup = new THREE.Group();
    micGroup.position.set(-0.8, 6.2, 0);
    micGroup.rotation.y = Math.PI / 4;

    // Mic stand base & pole
    const baseGeo = new THREE.CylinderGeometry(1.4, 1.5, 0.4, 24);
    const base = new THREE.Mesh(baseGeo, this.materials.materials.get('chrome'));
    micGroup.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 2.4, 16);
    const pole = new THREE.Mesh(poleGeo, this.materials.materials.get('chrome'));
    pole.position.y = 1.4;
    micGroup.add(pole);

    // Swivel yoke mount
    const yokeGeo = new THREE.TorusGeometry(1.3, 0.15, 12, 24, Math.PI);
    const yoke = new THREE.Mesh(yokeGeo, this.materials.materials.get('dark_metal'));
    yoke.position.y = 2.7;
    micGroup.add(yoke);

    // Mic capsule body
    const capsuleMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0x9333ea,
      emissiveIntensity: 0.5,
    });
    const capBody = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.8, 24), capsuleMat);
    capBody.position.y = 3.0;
    micGroup.add(capBody);

    // Mesh dome grille
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.materials.materials.get('chrome'));
    dome.position.y = 3.9;
    micGroup.add(dome);

    // SOUND-WAVE DETAILS: 3 Glowing concentric arcs to the right of mic
    const waveGroup = new THREE.Group();
    waveGroup.position.set(1.4, 2.8, 0);

    const waveRadii = [1.6, 2.5, 3.4];
    waveRadii.forEach((r, idx) => {
      const arcGeo = new THREE.TorusGeometry(r, 0.12, 12, 24, Math.PI * 0.45);
      arcGeo.rotateZ(-Math.PI * 0.225);
      const arcMat = new THREE.MeshBasicMaterial({ color: 0xe879f9 });
      const arcMesh = new THREE.Mesh(arcGeo, arcMat);
      arcMesh.position.set(idx * 0.5, 0, 0);
      waveGroup.add(arcMesh);
    });

    micGroup.add(waveGroup);
    group.add(micGroup);
    return group;
  }

  // =========================================================================
  // 7. GRAMMAR (BLUE - EXACT GOLD BRAIN SYMBOL)
  // =========================================================================
  createGrammar(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_grammar';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 10.0), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 10.4), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Two-tiered building
    const lower = new THREE.Mesh(new THREE.BoxGeometry(8.8, 3.6, 8.2), mats.wall);
    lower.position.y = 2.4;
    group.add(lower);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.2, 6.2), mats.wall);
    upper.position.y = 5.2;
    group.add(upper);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.4, 6.6), mats.trim);
    roofTrim.position.y = 6.4;
    group.add(roofTrim);

    // Vertical blue illuminated windows
    for (let i = 0; i < 3; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.0), mats.window);
      win.position.set(-2.0 + i * 2.0, 2.5, 4.15);
      group.add(win);
    }

    // ROOFTOP LANDMARK: THE EXACT GOLD BRAIN SYMBOL (NOT LA LOGO!)
    const brainGroup = new THREE.Group();
    brainGroup.position.set(0, 7.6, 0);
    brainGroup.rotation.y = Math.PI / 4;

    const goldMat = this.materials.materials.get('gold');

    // Dual Cerebral Hemispheres (Left & Right) with convolutions
    [-1.2, 1.2].forEach((xSide) => {
      const hemiGroup = new THREE.Group();
      hemiGroup.position.set(xSide, 0, 0);

      // Base hemisphere ellipsoid
      const baseHemi = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 20), goldMat);
      baseHemi.scale.set(0.85, 1.1, 1.25);
      hemiGroup.add(baseHemi);

      // Convoluted lobes / sulci modeled with rounded toruses/spheres
      const lobes = [
        { p: [0.3 * (xSide > 0 ? 1 : -1), 0.7, 0.6], s: [0.7, 0.6, 0.8] },
        { p: [0.4 * (xSide > 0 ? 1 : -1), 0.8, -0.5], s: [0.8, 0.7, 0.7] },
        { p: [0.5 * (xSide > 0 ? 1 : -1), -0.5, 0.4], s: [0.7, 0.6, 0.7] },
        { p: [0.5 * (xSide > 0 ? 1 : -1), -0.6, -0.4], s: [0.6, 0.6, 0.7] },
      ];

      lobes.forEach(l => {
        const lobeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), goldMat);
        lobeMesh.position.set(l.p[0], l.p[1], l.p[2]);
        lobeMesh.scale.set(l.s[0], l.s[1], l.s[2]);
        hemiGroup.add(lobeMesh);
      });

      brainGroup.add(hemiGroup);
    });

    // Golden pedestal collar
    const brainPedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.5, 24), goldMat);
    brainPedestal.position.y = -1.2;
    brainGroup.add(brainPedestal);

    group.add(brainGroup);
    return group;
  }

  // =========================================================================
  // 8. VOCABULARY (CORAL/PINK - 3D A, B, C BLOCKS)
  // =========================================================================
  createVocabulary(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_vocabulary';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // 3-Tiered Stepped Ziggurat Pavilion
    const tiers = [
      { w: 10.8, d: 9.8, h: 1.4, y: 0.7 },
      { w: 8.6, d: 7.8, h: 1.4, y: 2.1 },
      { w: 6.4, d: 5.8, h: 1.4, y: 3.5 },
    ];

    tiers.forEach((t, idx) => {
      const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), mats.wall);
      tierMesh.position.y = t.y;
      group.add(tierMesh);

      // Glowing pink neon edge on each tier
      const rim = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.35, 0.15, t.d + 0.35), mats.foundation);
      rim.position.y = t.y - t.h / 2 + 0.1;
      group.add(rim);
    });

    // ROOFTOP LANDMARK: 3D A, B, C BLOCKS (Pyramid Stack)
    const blocksGroup = new THREE.Group();
    blocksGroup.position.set(0, 5.0, 0);
    blocksGroup.rotation.y = Math.PI / 4;

    const blockSize = 2.2;
    const blockGeo = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

    // Helper to create block with canvas texture letter
    const makeLetterBlock = (letter, blockHex) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = blockHex;
      ctx.fillRect(0, 0, 256, 256);
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(8, 8, 240, 240);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 150px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 128, 134);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const blockMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.3,
        metalness: 0.2,
      });
      return new THREE.Mesh(blockGeo, blockMat);
    };

    // Block 'A' (Top center, Red/Pink)
    const blockA = makeLetterBlock('A', '#e11d48');
    blockA.position.set(0, blockSize * 1.05, 0);
    blocksGroup.add(blockA);

    // Block 'B' (Bottom left, Purple/Violet)
    const blockB = makeLetterBlock('B', '#9333ea');
    blockB.position.set(-blockSize * 0.58, 0, blockSize * 0.25);
    blocksGroup.add(blockB);

    // Block 'C' (Bottom right, Warm Orange/Amber)
    const blockC = makeLetterBlock('C', '#f59e0b');
    blockC.position.set(blockSize * 0.58, 0, -blockSize * 0.25);
    blocksGroup.add(blockC);

    group.add(blocksGroup);
    return group;
  }

  // =========================================================================
  // 9. MY PROGRESS (GOLDEN YELLOW - DETAILED GOLDEN TROPHY)
  // =========================================================================
  createProgress(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_progress';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Monumental fluted pedestal
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.8, 9.5), mats.wall);
    plinth.position.y = 0.4;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.18, 9.9), mats.foundation);
    glowRim.position.y = 0.15;
    group.add(glowRim);

    // Fluted vertical core
    const core = new THREE.Mesh(new THREE.BoxGeometry(8.2, 4.4, 7.8), mats.wall);
    core.position.y = 3.0;
    group.add(core);

    // Decorative vertical fluted ribs
    const goldMat = this.materials.materials.get('gold');
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 0.35), goldMat);
      rib.position.set(-2.8 + i * 1.86, 3.0, 3.98);
      group.add(rib);
    }

    const pedestalTop = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.6, 8.4), mats.trim);
    pedestalTop.position.y = 5.4;
    group.add(pedestalTop);

    // ROOFTOP LANDMARK: DETAILED GOLDEN TROPHY
    const trophyGroup = new THREE.Group();
    trophyGroup.position.set(0, 6.4, 0);
    trophyGroup.rotation.y = Math.PI / 4;

    const trophyMat = this.materials.materials.get('trophy_gold');

    // Stepped round base
    const base1 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.5, 32), trophyMat);
    trophyGroup.add(base1);

    const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.4, 32), trophyMat);
    base2.position.y = 0.45;
    trophyGroup.add(base2);

    // Slender knurled stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 1.6, 24), trophyMat);
    stem.position.y = 1.45;
    trophyGroup.add(stem);

    // Flared Cup Body
    const cupLower = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.8, 32), trophyMat);
    cupLower.rotation.x = Math.PI;
    cupLower.position.y = 2.9;
    trophyGroup.add(cupLower);

    const cupUpper = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.2, 2.2, 32, 1, true), trophyMat);
    cupUpper.position.y = 4.4;
    trophyGroup.add(cupUpper);

    // Flared rim ring
    const rimTorus = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.18, 16, 32), trophyMat);
    rimTorus.rotation.x = Math.PI / 2;
    rimTorus.position.y = 5.5;
    trophyGroup.add(rimTorus);

    // Two Ornate Curved Handles (Left and Right)
    [-2.6, 2.6].forEach(xSide => {
      const handleGeo = new THREE.TorusGeometry(1.4, 0.22, 16, 24, Math.PI * 0.85);
      handleGeo.rotateZ(xSide > 0 ? -Math.PI * 0.425 : Math.PI * 0.425);
      const handle = new THREE.Mesh(handleGeo, trophyMat);
      handle.position.set(xSide, 4.0, 0);
      trophyGroup.add(handle);
    });

    group.add(trophyGroup);
    return group;
  }

  // =========================================================================
  // 10. MOCK TESTS (LIGHT BLUE - 3D CHART / BARS)
  // =========================================================================
  createMockTests(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_mocks';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Plinth & foundation
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 9.5), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 9.9), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Stepped office body
    const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.6, 7.8), mats.wall);
    body.position.y = 2.9;
    group.add(body);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 8.4), mats.trim);
    roofTrim.position.y = 5.4;
    group.add(roofTrim);

    // Horizontal window bands
    for (let r = 0; r < 2; r++) {
      const winStrip = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.9), mats.window);
      winStrip.position.set(0, 2.2 + r * 1.6, 3.95);
      group.add(winStrip);
    }

    // ROOFTOP LANDMARK: 3D CHART / BARS (Ascending 3 Bars)
    const chartGroup = new THREE.Group();
    chartGroup.position.set(0, 6.2, 0);
    chartGroup.rotation.y = Math.PI / 4;

    const barHeights = [2.4, 4.2, 6.0];
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
    });
    const capMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    barHeights.forEach((bh, idx) => {
      const barGeo = new THREE.BoxGeometry(1.4, bh, 1.4);
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(-2.0 + idx * 2.0, bh / 2, 0);
      chartGroup.add(bar);

      // Glowing cap on top of bar
      const capGeo = new THREE.BoxGeometry(1.45, 0.18, 1.45);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(-2.0 + idx * 2.0, bh + 0.09, 0);
      chartGroup.add(cap);
    });

    group.add(chartGroup);
    return group;
  }

  // =========================================================================
  // 11. ASSIGNMENTS (PURPLE/VIOLET - 3D CLIPBOARD)
  // =========================================================================
  createAssignments(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_assignments';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 9.5), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 9.9), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Two-story administrative hall
    const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.8, 7.8), mats.wall);
    body.position.y = 3.0;
    group.add(body);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 8.4), mats.trim);
    roofTrim.position.y = 5.6;
    group.add(roofTrim);

    // Grid of glowing purple windows
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), mats.window);
        win.position.set(-2.2 + c * 2.2, 2.0 + r * 1.8, 3.95);
        group.add(win);
      }
    }

    // ROOFTOP LANDMARK: 3D CLIPBOARD
    const cbGroup = new THREE.Group();
    cbGroup.position.set(0, 6.8, 0);
    cbGroup.rotation.y = Math.PI / 4;
    cbGroup.rotation.x = 0.45; // angled back

    // Wooden backing board
    const boardGeo = new THREE.BoxGeometry(4.4, 6.2, 0.3);
    const board = new THREE.Mesh(boardGeo, this.materials.materials.get('wood'));
    cbGroup.add(board);

    // Paper sheet
    const paperGeo = new THREE.BoxGeometry(3.8, 5.4, 0.05);
    const paper = new THREE.Mesh(paperGeo, this.materials.materials.get('book_paper'));
    paper.position.set(0, -0.2, 0.18);
    cbGroup.add(paper);

    // Metallic spring clip on top
    const clipGeo = new THREE.BoxGeometry(2.4, 0.8, 0.45);
    const clip = new THREE.Mesh(clipGeo, this.materials.materials.get('chrome'));
    clip.position.set(0, 2.6, 0.25);
    cbGroup.add(clip);

    // Checkbox and text lines on paper
    for (let i = 0; i < 4; i++) {
      const lineY = 1.6 - i * 1.1;
      const chk = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), this.materials.materials.get('dark_metal'));
      chk.position.set(-1.3, lineY, 0.22);
      cbGroup.add(chk);

      const line = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.15), this.materials.materials.get('dark_metal'));
      line.position.set(0.2, lineY, 0.22);
      cbGroup.add(line);
    }

    group.add(cbGroup);
    return group;
  }

  // =========================================================================
  // 12. TED / PODCAST (CRIMSON/RUBY - 3D VIDEO/PLAY MONITOR)
  // =========================================================================
  createTedPodcast(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_ted_podcast';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation & plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 9.5), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.15, 9.9), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Stepped studio body
    const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, 4.4, 7.8), mats.wall);
    body.position.y = 2.8;
    group.add(body);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 8.4), mats.trim);
    roofTrim.position.y = 5.2;
    group.add(roofTrim);

    // Glowing red studio windows
    for (let i = 0; i < 2; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.2), mats.window);
      win.position.set(-2.0 + i * 4.0, 2.9, 3.95);
      group.add(win);
    }

    // ROOFTOP LANDMARK: 3D PLAY MONITOR
    const tvGroup = new THREE.Group();
    tvGroup.position.set(0, 6.8, 0);
    tvGroup.rotation.y = Math.PI / 4;

    // Monitor cabinet in ruby red
    const cabGeo = new THREE.BoxGeometry(5.2, 4.0, 1.4);
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0xbe123c,
      roughness: 0.3,
      metalness: 0.6,
      emissive: 0x881337,
      emissiveIntensity: 0.4,
    });
    const cab = new THREE.Mesh(cabGeo, cabMat);
    tvGroup.add(cab);

    // Recessed dark screen face
    const screenGeo = new THREE.PlaneGeometry(4.4, 3.2);
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x4c0519 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, 0, 0.72);
    tvGroup.add(screen);

    // 3D White/Silver Triangular Play Button
    const playShape = new THREE.Shape();
    playShape.moveTo(-0.7, -0.9);
    playShape.lineTo(-0.7, 0.9);
    playShape.lineTo(0.9, 0);
    playShape.closePath();

    const playGeo = new THREE.ExtrudeGeometry(playShape, { depth: 0.25, bevelEnabled: false });
    const playMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
    });
    const play = new THREE.Mesh(playGeo, playMat);
    play.position.set(0, 0, 0.74);
    tvGroup.add(play);

    // Broadcast antenna knob on top
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 12), this.materials.materials.get('chrome'));
    ant.position.set(0, 2.6, 0);
    tvGroup.add(ant);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), this.materials.materials.get('chrome'));
    knob.position.set(0, 3.2, 0);
    tvGroup.add(knob);

    group.add(tvGroup);
    return group;
  }

  // =========================================================================
  // 13. LIVE CLASSES (TURQUOISE/TEAL - 3-PERSON GROUP SYMBOL)
  // =========================================================================
  createLiveClasses(config) {
    const group = new THREE.Group();
    group.position.set(config.pos.x, config.pos.y, config.pos.z);
    group.name = 'building_live_classes';
    group.userData = { id: config.id, name: config.name, route: config.route };

    const mats = this.materials.getBuildingMaterials(config);

    // Foundation & plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.6, 10.0), mats.wall);
    plinth.position.y = 0.3;
    group.add(plinth);

    const glowRim = new THREE.Mesh(new THREE.BoxGeometry(11.9, 0.15, 10.4), mats.foundation);
    glowRim.position.y = 0.1;
    group.add(glowRim);

    // Open colonnade pavilion
    const pavilionBase = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.2, 8.2), mats.wall);
    pavilionBase.position.y = 1.2;
    group.add(pavilionBase);

    // Pillars (6 pillars)
    const pillarMat = mats.trim;
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 2; r++) {
        const px = -3.2 + c * 3.2;
        const pz = -2.8 + r * 5.6;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.2, 16), pillarMat);
        pillar.position.set(px, 3.4, pz);
        group.add(pillar);
      }
    }

    // Wide flat modern roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.5, 8.8), mats.trim);
    roof.position.y = 5.2;
    group.add(roof);

    // Glowing turquoise interior backlight
    const glowBack = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 2.6), mats.window);
    glowBack.position.set(0, 3.2, 0);
    group.add(glowBack);

    // ROOFTOP LANDMARK: THREE-PERSON GROUP SYMBOL
    const groupSym = new THREE.Group();
    groupSym.position.set(0, 6.8, 0);
    groupSym.rotation.y = Math.PI / 4;

    const figMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4bf,
      roughness: 0.25,
      metalness: 0.75,
      emissive: 0x0d9488,
      emissiveIntensity: 0.6,
    });

    // Helper to create a stylized figure bust (head + torso)
    const makeFigure = (scale, yOffset, xOffset) => {
      const f = new THREE.Group();
      f.position.set(xOffset, yOffset, 0);

      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.75 * scale, 24, 20), figMat);
      head.position.y = 2.2 * scale;
      f.add(head);

      // Torso / shoulders
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * scale, 1.3 * scale, 1.6 * scale, 24), figMat);
      torso.position.y = 0.9 * scale;
      f.add(torso);

      return f;
    };

    // Center taller avatar
    const centerFig = makeFigure(1.15, 0, 0);
    groupSym.add(centerFig);

    // Left companion figure
    const leftFig = makeFigure(0.9, -0.25, -1.8);
    groupSym.add(leftFig);

    // Right companion figure
    const rightFig = makeFigure(0.9, -0.25, 1.8);
    groupSym.add(rightFig);

    group.add(groupSym);
    return group;
  }

  // =========================================================================
  // 14. DECORATIVE ELEMENTS: TREES, STREETLIGHTS, BENCHES
  // =========================================================================
  createPineTree(scale = 1.0) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * scale, 0.35 * scale, 1.5 * scale, 8), this.materials.materials.get('wood'));
    trunk.position.y = 0.75 * scale;
    tree.add(trunk);

    const foliageMat = this.materials.materials.get('tree_pine');
    // 3 stacked cones
    for (let i = 0; i < 3; i++) {
      const coneR = (1.8 - i * 0.4) * scale;
      const coneH = (2.2 - i * 0.3) * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 7), foliageMat);
      cone.position.y = (1.8 + i * 1.2) * scale;
      tree.add(cone);
    }
    return tree;
  }

  createStreetLamp(scale = 1.0) {
    const lamp = new THREE.Group();
    const postMat = this.materials.materials.get('dark_metal');
    const glowMat = this.materials.materials.get('lamp_glow');

    // Vertical post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 4.2 * scale, 12), postMat);
    post.position.y = 2.1 * scale;
    lamp.add(post);

    // Top arm
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 1.0 * scale, 8), postMat);
    arm.rotation.z = Math.PI / 4;
    arm.position.set(0.35 * scale, 4.4 * scale, 0);
    lamp.add(arm);

    // Glowing globe
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.42 * scale, 16, 16), glowMat);
    globe.position.set(0.7 * scale, 4.5 * scale, 0);
    lamp.add(globe);

    // Small warm point light
    const pl = new THREE.PointLight(0xfef08a, 1.2, 14, 1.5);
    pl.position.set(0.7 * scale, 4.5 * scale, 0);
    lamp.add(pl);

    return lamp;
  }

  createBench(scale = 1.0) {
    const bench = new THREE.Group();
    const woodMat = this.materials.materials.get('wood');
    const metalMat = this.materials.materials.get('dark_metal');

    // Legs
    [-1.0, 1.0].forEach(x => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2 * scale, 0.7 * scale, 0.8 * scale), metalMat);
      leg.position.set(x * scale, 0.35 * scale, 0);
      bench.add(leg);
    });

    // Seat slats
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6 * scale, 0.15 * scale, 0.8 * scale), woodMat);
    seat.position.y = 0.7 * scale;
    bench.add(seat);

    // Backrest
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6 * scale, 0.6 * scale, 0.15 * scale), woodMat);
    back.position.set(0, 1.2 * scale, -0.35 * scale);
    bench.add(back);

    return bench;
  }
}
