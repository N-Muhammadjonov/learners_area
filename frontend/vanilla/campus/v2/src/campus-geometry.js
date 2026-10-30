/**
 * Learners Area 3D Campus Geometry
 * Procedural low-poly architectures, genuine 3D rooftop landmarks,
 * platform slab, trees, benches, lamp posts, and official LA logo dais.
 */

import * as THREE from '../vendor/three-runtime.js';
import {neonTube} from './campus-neon.js';

export class CampusGeometry {
  constructor(materials) {
    this.materials = materials;
  }

  finishArchitecture(group) {
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      mesh.castShadow=!mesh.material.transparent;
      mesh.receiveShadow=true;
      const params=mesh.geometry.parameters;
      // Textured letter blocks retain their six normalized BoxGeometry UVs.
      if(mesh.material.map||(Array.isArray(mesh.material)&&mesh.material.some(m=>m.map)))return;
      if(mesh.geometry.type!=='BoxGeometry'||!params||params.height<.3||params.width<2||params.depth<2)return;
      const {width:w,height:h,depth:d}=params;
      const r=Math.min(.18,Math.min(w,h,d)*.2);
      const face=new THREE.Shape();
      face.moveTo(-w/2+r,-h/2+r);face.lineTo(w/2-r,-h/2+r);
      face.lineTo(w/2-r,h/2-r);face.lineTo(-w/2+r,h/2-r);face.closePath();
      const geometry=new THREE.ExtrudeGeometry(face,{depth:d-2*r,steps:1,
        bevelEnabled:true,bevelSize:r,bevelThickness:r,bevelSegments:3});
      geometry.translate(0,0,-(d-2*r)/2);
      mesh.geometry.dispose();mesh.geometry=geometry;
    });
  }

  createBuildingLot(config) {
    const lot=new THREE.Group();
    const width=config.id==='live_classes'?18:21.5,depth=config.id==='live_classes'?17:19.5;
    const surface=new THREE.Mesh(new THREE.BoxGeometry(width,.035,depth),
      new THREE.MeshStandardMaterial({color:0x182138,roughness:.94,metalness:.04}));
    surface.position.y=.041;surface.receiveShadow=true;lot.add(surface);
    const outline=new THREE.MeshBasicMaterial({color:0x254279,transparent:true,opacity:.72});
    for(const sign of [-1,1]){
      const horizontal=new THREE.Mesh(new THREE.BoxGeometry(width,.025,.065),outline);
      horizontal.position.set(0,.067,sign*depth/2);lot.add(horizontal);
      const vertical=new THREE.Mesh(new THREE.BoxGeometry(.065,.025,depth),outline);
      vertical.position.set(sign*width/2,.067,0);lot.add(vertical);
    }
    lot.position.set(config.pos.x,0,config.pos.z);return lot;
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
      depth: Math.max(.1,h-2*p.bevelSize),
      bevelEnabled: true,
      bevelThickness: p.bevelSize,
      bevelSize: p.bevelSize,
      bevelSegments: 2,
    };

    const slabGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    slabGeo.rotateX(Math.PI / 2); // XY -> XZ; extrude spans y=0 down to -h.
    // ExtrudeGeometry's bevel also extends above the un-beveled top. Align
    // that upper face with y=0 so it cannot cover the roads and foundations.
    slabGeo.translate(0, -p.bevelSize, 0);
    // The previous extra -h translation left the platform slab one full
    // thickness below its asphalt, causing its glowing sidewalls to float.
    // Keep the top flush with the road surface at y=0.
    slabGeo.computeVertexNormals();

    const slabMesh = new THREE.Mesh(slabGeo, this.materials.materials.get('platform_slab'));
    slabMesh.receiveShadow = true;
    group.add(slabMesh);

    // Asphalt surface plane (top face)
    const asphaltGeo = new THREE.ShapeGeometry(shape);
    // Use the SAME X/Z winding as the extruded slab. The old -PI/2 mirrored
    // the asphalt polygon and made embedded circuitry disappear at some edges.
    asphaltGeo.rotateX(Math.PI / 2);
    asphaltGeo.translate(0, 0.02, 0);

    const asphaltMat=this.materials.materials.get('asphalt');
    asphaltMat.side=THREE.DoubleSide; // road normals point down after alignment
    const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphaltMesh.receiveShadow = true;
    group.add(asphaltMesh);

    // Circuit-board pavement: shallow panels never cover electrical conduits.
    const panelMaterial=new THREE.MeshStandardMaterial({color:0x15213a,roughness:.95,metalness:0});
    for(let x=-60;x<=60;x+=12)for(let z=-66;z<=60;z+=12){
      const panel=new THREE.Mesh(new THREE.BoxGeometry(11.7,.018,11.7),panelMaterial);
      panel.position.set(x,.023,z);panel.receiveShadow=true;group.add(panel);
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
    const rings=new THREE.Group();rings.name='dashboard_rotating_rings';
    group.add(rings);group.userData.rings=rings;
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
      rings.add(ringMesh);
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
    rings.add(dashesGroup);
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

    // The rocket is an independent 3D object; the official LA emblem floats above it.
    const rocket=new THREE.Group();rocket.name='campus_rocket';
    rocket.scale.setScalar(1.32);
    const rocketMat=new THREE.MeshStandardMaterial({color:0xfff0c6,roughness:.44,metalness:.12,emissive:0xffc46b,emissiveIntensity:.32});
    const rocketAccent=new THREE.MeshStandardMaterial({color:0xff862e,roughness:.48,metalness:.1,emissive:0xff6218,emissiveIntensity:.28});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.7,4.8,32),rocketMat);
    body.position.y=4.1;rocket.add(body);
    const nose=new THREE.Mesh(new THREE.ConeGeometry(1.45,2.5,32),rocketAccent);nose.position.y=7.75;rocket.add(nose);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(1.55,.13,12,32),this.materials.materials.get('platform_rim'));
    collar.rotation.x=Math.PI/2;collar.position.y=2.0;rocket.add(collar);
    const port=new THREE.Mesh(new THREE.CylinderGeometry(.57,.57,.14,24),this.materials.materials.get('platform_rim'));
    port.rotation.x=Math.PI/2;port.position.set(0,4.85,1.5);rocket.add(port);
    const glass=new THREE.Mesh(new THREE.CircleGeometry(.42,24),new THREE.MeshBasicMaterial({color:0x102e58}));
    glass.position.set(0,4.85,1.58);rocket.add(glass);
    const finShape=new THREE.Shape();finShape.moveTo(1.45,1.1);finShape.lineTo(3.1,.95);finShape.lineTo(1.65,3.8);finShape.closePath();
    for(let i=0;i<4;i++){
      const fin=new THREE.Mesh(new THREE.ExtrudeGeometry(finShape,{depth:.28,bevelEnabled:true,bevelSize:.08,bevelThickness:.06,bevelSegments:2}),rocketAccent);
      fin.rotation.y=i*Math.PI/2;rocket.add(fin);
    }
    group.add(rocket);group.userData.rocket=rocket;
    // Volumetric vertical light beam
    const beam = this.materials.materials.get('dashboard_beam');
    if (beam) {
      const beamGeo = new THREE.CylinderGeometry(3.5, 6.0, 24, 32, 1, true);
      const beamMesh = new THREE.Mesh(beamGeo, beam);
      beamMesh.position.y = 12.0;
      group.add(beamMesh);
    }

    // THE EXACT OFFICIAL LEARNERS AREA LA LOGO
    // Official transparent gold-and-blue brand mark from the repository.
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
    logoMesh.position.set(0, 18.2, 0);
    logoMesh.scale.set(11.2, 11.2, 1);
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

    // The approved reading hall has a flat, stepped roof below the book.
    const pediment = new THREE.Mesh(new THREE.BoxGeometry(10.6,.55,9.4),mats.trim);
    pediment.position.y=5.65;
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
    bookGroup.position.set(0, 6.55, 0);
    bookGroup.rotation.x = .17;
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

    // Curved paper surfaces and printed rules sit above the physical page blocks.
    const ink=new THREE.MeshBasicMaterial({color:0x8d9cac});
    for(const sign of [-1,1]){
      const points=[],indices=[];
      const rows=14,cols=20;
      const pageY=u=>.58+.48*Math.sin(u*Math.PI*.85);
      for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){
        const u=col/cols,v=row/rows;
        points.push(sign*(.12+3.45*u),pageY(u),(v-.5)*5.3);
      }
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const n=row*(cols+1)+col;
        indices.push(n,n+cols+1,n+1,n+1,n+cols+1,n+cols+2);
      }
      const paper=new THREE.BufferGeometry();
      paper.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      paper.setIndex(indices);paper.computeVertexNormals();
      const surfaceMat=this.materials.materials.get('book_paper').clone();
      surfaceMat.side=THREE.DoubleSide;
      bookGroup.add(new THREE.Mesh(paper,surfaceMat));
      for(let row=0;row<11;row++){
        const z=-2.15+row*.4;
        const line=[];
        for(let i=0;i<14;i++){
          const u=.12+i/13*(row%3===0?.61:.76);
          line.push(new THREE.Vector3(sign*(.12+3.45*u),pageY(u)+.014,z));
        }
        const curve=new THREE.CatmullRomCurve3(line);
        bookGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve,14,.017,4,false),ink));
      }
    }

    group.add(bookGroup);
    group.userData.landmark=bookGroup;
    bookGroup.name='rooftop_landmark';
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
    hpGroup.position.set(0, 9.05, 0);
    hpGroup.rotation.y = Math.PI / 4;

    // Arched Headband (half Torus)
    const bandGeo = new THREE.TorusGeometry(3, .3, 16, 48, Math.PI);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xb5e7ff,
      roughness: .5,
      metalness: .18,
      emissive: 0x5cbce9,
      emissiveIntensity: .3,
    });
    const headband = new THREE.Mesh(bandGeo, bandMat);
    headband.rotation.z = 0;
    hpGroup.add(headband);

    // Inner cushion pad
    const cushionGeo = new THREE.TorusGeometry(2.7, .18, 16, 48, Math.PI);
    const padMat = this.materials.materials.get('dark_metal');
    const cushion = new THREE.Mesh(cushionGeo, padMat);
    hpGroup.add(cushion);

    // Ear Cups (Left and Right)
    const cupMat = new THREE.MeshStandardMaterial({
      color: 0xd1eeff,
      roughness: .55,
      metalness: .15,
      emissive: 0x478cb8,
      emissiveIntensity: .22,
    });
    const ringGlowMat = new THREE.MeshBasicMaterial({ color: 0x8ae7ff, toneMapped:false });

    [-3, 3].forEach((xPos, idx) => {
      const earCupGroup = new THREE.Group();
      earCupGroup.position.set(xPos, -.35, 0);
      earCupGroup.rotation.y = idx === 0 ? .12 : -.12;

      // Outer housing cylinder
      const housing = new THREE.Mesh(new THREE.CapsuleGeometry(.66,1.15,8,20), cupMat);
      housing.scale.z=.72;
      earCupGroup.add(housing);

      // Glowing outer accent ring
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(.56, .09, 12, 32), ringGlowMat);
      glowRing.scale.y=1.72;
      glowRing.rotation.y = 0;
      glowRing.position.z = .49;
      earCupGroup.add(glowRing);

      // Soft donut cushion
      const earDonut = new THREE.Mesh(new THREE.TorusGeometry(.39, .17, 12, 32), padMat);
      earDonut.scale.y=1.75;
      earDonut.rotation.y = 0;
      earDonut.position.z = .55;
      earCupGroup.add(earDonut);
      const hinge=new THREE.Mesh(new THREE.BoxGeometry(.35,.85,.32),bandMat);
      hinge.position.set(0,.95,-.06);earCupGroup.add(hinge);

      hpGroup.add(earCupGroup);
    });

    group.add(hpGroup);
    group.userData.landmark=hpGroup;
    hpGroup.name='rooftop_landmark';
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

    // Hollow cyan pen nib, as in the approved landmark artwork.
    const pencilGroup=new THREE.Group();pencilGroup.position.set(0,5.9,0);pencilGroup.rotation.y=Math.PI/4;
    const pen=new THREE.Group();pen.rotation.z=-Math.PI/4;pen.position.set(-1.0,.2,0);pencilGroup.add(pen);
    const outline=new THREE.Shape();outline.moveTo(-.62,1);outline.lineTo(-.62,4.4);outline.quadraticCurveTo(0,4.95,.62,4.4);outline.lineTo(.62,1);outline.lineTo(0,0);outline.closePath();
    const hole=new THREE.Path();hole.moveTo(-.36,1.15);hole.lineTo(.36,1.15);hole.lineTo(.36,4.15);hole.quadraticCurveTo(0,4.5,-.36,4.15);hole.closePath();outline.holes.push(hole);
    const nib=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:.35,bevelEnabled:true,bevelSize:.06,bevelThickness:.05,bevelSegments:2}),new THREE.MeshStandardMaterial({color:0x72fff2,emissive:0x18bfb4,emissiveIntensity:.32,roughness:.5,metalness:.1}));pen.add(nib);
    const divider=new THREE.Mesh(new THREE.BoxGeometry(1.08,.13,.43),nib.material);divider.position.set(0,1.15,.15);pen.add(divider);
    group.add(pencilGroup);
    group.userData.landmark=pencilGroup;
    pencilGroup.name='rooftop_landmark';
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
    micGroup.position.set(-0.8, 5.2, 0);
    micGroup.scale.setScalar(.86);
    micGroup.rotation.y = Math.PI / 4;
    const standMat=new THREE.MeshStandardMaterial({color:0xd5e3ed,roughness:.5,metalness:.2,emissive:0xd1efff,emissiveIntensity:.2});

    // Mic stand base & pole
    const baseGeo = new THREE.CylinderGeometry(1.4, 1.5, 0.4, 24);
    const base = new THREE.Mesh(baseGeo, standMat);
    micGroup.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 2.4, 16);
    const pole = new THREE.Mesh(poleGeo, standMat);
    pole.position.y = 1.4;
    micGroup.add(pole);

    // Swivel yoke mount
    const yokeGeo = new THREE.TorusGeometry(1.3, 0.15, 12, 24, Math.PI);
    const yoke = new THREE.Mesh(yokeGeo, this.materials.materials.get('dark_metal'));
    yoke.position.y = 2.7;
    micGroup.add(yoke);

    // Mic capsule body
    const capsuleMat = new THREE.MeshStandardMaterial({
      color: 0xfff3ce,
      roughness: .5,
      metalness: .18,
      emissive: 0xffe6a6,
      emissiveIntensity: .3,
    });
    const capBody = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.8, 24), capsuleMat);
    capBody.position.y = 3.0;
    micGroup.add(capBody);

    // Mesh dome grille
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), capsuleMat);
    dome.position.y = 3.9;
    micGroup.add(dome);
    for(let i=0;i<4;i++){
      const slot=new THREE.Mesh(new THREE.BoxGeometry(1.15,.085,.08),this.materials.materials.get('dark_metal'));
      slot.position.set(0,2.45+i*.33,.72);micGroup.add(slot);
    }
    const waveMat=new THREE.MeshBasicMaterial({color:0xffdf86,toneMapped:false});
    for(const [i,h] of [1.3,2.1,3.0,3.5,2.8,2.1,1.3].entries()){
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.18,h,.22),waveMat);
      bar.position.set(3.9+i*.48,h/2,.15);micGroup.add(bar);
    }

    // SOUND-WAVE DETAILS: 3 Glowing concentric arcs to the right of mic
    const waveGroup = new THREE.Group();
    waveGroup.position.set(1.4, 2.8, 0);

    const waveRadii = [1.6, 2.5, 3.4];
    waveRadii.forEach((r, idx) => {
      const arcGeo = new THREE.TorusGeometry(r, 0.12, 12, 24, Math.PI * 0.45);
      arcGeo.rotateZ(-Math.PI * 0.225);
      const arcMat = waveMat;
      const arcMesh = new THREE.Mesh(arcGeo, arcMat);
      arcMesh.position.set(idx * 0.5, 0, 0);
      waveGroup.add(arcMesh);
    });

    micGroup.add(waveGroup);
    group.add(micGroup);
    group.userData.landmark=micGroup;
    micGroup.name='rooftop_landmark';
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
    brainGroup.position.set(0, 8.35, 0);
    brainGroup.rotation.y = Math.PI / 4;

    const goldMat = this.materials.materials.get('gold');

    // A modeled blue plaque carries the gold outlined brain from the reference.
    const plaque=new THREE.Mesh(new THREE.CylinderGeometry(3.05,3.05,4.7,6),mats.wall);
    plaque.rotation.x=Math.PI/2;brainGroup.add(plaque);
    const outlineMat=new THREE.MeshStandardMaterial({color:0xffd45b,
      emissive:0xe69b12,emissiveIntensity:.6,roughness:.35,metalness:.5});
    const lobe=[[0,1.68],[-.6,2.0],[-1.3,1.82],[-1.5,1.2],[-1.93,.77],
      [-1.85,.13],[-1.4,-.13],[-1.67,-.77],[-1.26,-1.43],[-.56,-1.45],
      [0,-.92],[0,1.68]];
    const folds=[[[0,.9],[-.65,.55],[-.96,.78]],
      [[0,-.15],[-.78,-.36],[-1.04,-.97]]];
    for(const face of [-1,1])for(const sign of [-1,1]){
      const paths=[lobe,...folds];
      for(const path of paths){
        const curve=new THREE.CatmullRomCurve3(path.map(([x,y])=>new THREE.Vector3(x*sign,y-.25,face*2.385)));
        brainGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve,48,.085,8,false),outlineMat));
      }
    }

    group.add(brainGroup);
    group.userData.landmark=brainGroup;
    brainGroup.name='rooftop_landmark';
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
      const blockMat = new THREE.MeshBasicMaterial({map:tex,toneMapped:false});
      const solid=new THREE.MeshStandardMaterial({color:blockHex,roughness:.8,metalness:0});
      return new THREE.Mesh(blockGeo,[solid,solid,solid,solid,blockMat,solid]);
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
    group.userData.landmark=blocksGroup;
    blocksGroup.name='rooftop_landmark';
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
    trophyGroup.position.set(0, 6.05, 0);
    trophyGroup.scale.set(.65,1.4,.65);
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
    group.userData.landmark=trophyGroup;
    trophyGroup.name='rooftop_landmark';
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
    chartGroup.position.set(0, 5.9, 0);
    chartGroup.scale.setScalar(.75);
    chartGroup.rotation.y = Math.PI / 4;

    const barHeights = [1.8, 3.4, 5.0];
    const housing=new THREE.Mesh(new THREE.BoxGeometry(6.2,3.4,3.4),new THREE.MeshStandardMaterial({color:0x16354e,roughness:.8,metalness:.08}));
    housing.position.set(0,1.7,-.6);chartGroup.add(housing);
    const barMat = new THREE.MeshStandardMaterial({
      color: 0xe5f9ff,
      roughness: .48,
      metalness: .15,
      emissive: 0x81c6ee,
      emissiveIntensity: .32,
    });
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffdf72, toneMapped:false });

    barHeights.forEach((bh, idx) => {
      const barGeo = new THREE.BoxGeometry(1.4, bh, 1.4);
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(-2.0 + idx * 2.0, bh / 2, 1.4);
      chartGroup.add(bar);

      // Glowing cap on top of bar
      const capGeo = new THREE.BoxGeometry(1.45, 0.18, 1.45);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(-2.0 + idx * 2.0, bh + 0.09, 1.4);
      chartGroup.add(cap);
    });

    group.add(chartGroup);
    group.userData.landmark=chartGroup;
    chartGroup.name='rooftop_landmark';
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
    cbGroup.position.set(-1.7, 7.2, -.8);
    cbGroup.rotation.y = Math.PI / 4;
    cbGroup.rotation.x = -Math.PI/3;
    cbGroup.scale.setScalar(.8);

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

    const caseMat=new THREE.MeshStandardMaterial({color:0x542c9c,roughness:.82,metalness:.05});
    const toolCase=new THREE.Mesh(new THREE.BoxGeometry(1.8,1.4,1.3),caseMat);toolCase.position.set(2.6,6.3,-1.8);group.add(toolCase);
    const caseHandle=new THREE.Mesh(new THREE.TorusGeometry(.38,.08,8,16,Math.PI),caseMat);caseHandle.position.set(2.6,7.0,-1.8);group.add(caseHandle);
    group.add(cbGroup);
    group.userData.landmark=cbGroup;
    cbGroup.name='rooftop_landmark';
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
    tvGroup.position.set(0, 7.9, 0);
    tvGroup.rotation.y = Math.PI / 4;

    // Monitor cabinet in ruby red
    const cabGeo = new THREE.BoxGeometry(5.2, 5.0, 1.4);
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
    const screenGeo = new THREE.PlaneGeometry(4.4, 4.1);
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

    // Carrying handle and physical transport keys match the reference player.
    const dark=this.materials.materials.get('dark_metal');
    for(const x of [-1.05,1.05]){
      const side=new THREE.Mesh(new THREE.BoxGeometry(.23,.65,.3),dark);
      side.position.set(x,2.8,0);tvGroup.add(side);
    }
    const handle=new THREE.Mesh(new THREE.BoxGeometry(2.3,.23,.3),dark);
    handle.position.set(0,3.2,0);tvGroup.add(handle);
    for(let i=0;i<3;i++){
      const key=new THREE.Mesh(new THREE.BoxGeometry(.38,.16,.38),mats.trim);
      key.position.set(-1.55+i*.65,2.59,.4);tvGroup.add(key);
    }

    group.add(tvGroup);
    group.userData.landmark=tvGroup;
    tvGroup.name='rooftop_landmark';
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
    groupSym.position.set(0, 5.55, 0);
    groupSym.scale.y=1.5;
    groupSym.rotation.y = Math.PI / 4;

    const figMat = new THREE.MeshStandardMaterial({
      color: 0xffedc2,
      roughness: .55,
      metalness: .12,
      emissive: 0xffe6a8,
      emissiveIntensity: .28,
    });

    // Helper to create a stylized figure bust (head + torso)
    const makeFigure = (scale, yOffset, xOffset) => {
      const f = new THREE.Group();
      f.position.set(xOffset, yOffset, 0);

      // Head
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.75*scale,.75*scale,.55*scale,24),figMat);
      head.rotation.x=Math.PI/2;
      head.position.set(0,2.2*scale,.25*scale);
      f.add(head);

      // Torso / shoulders
      const shoulders=new THREE.Shape();
      shoulders.moveTo(-1.05*scale,-.75*scale);
      shoulders.lineTo(1.05*scale,-.75*scale);
      shoulders.lineTo(1.05*scale,.25*scale);
      shoulders.quadraticCurveTo(1.0*scale,.9*scale,0,.9*scale);
      shoulders.quadraticCurveTo(-1.0*scale,.9*scale,-1.05*scale,.25*scale);
      shoulders.closePath();
      const torso = new THREE.Mesh(new THREE.ExtrudeGeometry(shoulders,{depth:.5*scale,bevelEnabled:true,bevelSize:.06*scale,bevelThickness:.06*scale,bevelSegments:2,steps:1}),figMat);
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
    group.userData.landmark=groupSym;
    groupSym.name='rooftop_landmark';
    return group;
  }

  // =========================================================================
  // 14. DECORATIVE ELEMENTS: TREES, STREETLIGHTS, BENCHES
  // =========================================================================
  /** Architectural lighting on all visible facades.
   * The approved reference uses glowing vertical window bays and lit roof
   * edges; rear/side faces must remain modeled during a real 360° orbit.
   * Roof symbols and each module's established palette are unchanged. */
  addFacadeIllumination(group,config) {
    const dimensions={reading:[9.5,8.5,4.8],listening:[9.6,8.6,3.4],writing:[8.8,7.8,4.4],
      speaking:[8.6,7.8,4],grammar:[8.8,8.2,3.6],vocabulary:[10.8,9.8,1.4],
      progress:[8.2,7.8,4.4],mocks:[8.6,7.8,4.6],assignments:[8.6,7.8,4.8],
      live_classes:[9.6,8.2,3.9],video_lessons:[8.6,7.8,4.4]};
    const [width,depth,height]=dimensions[config.id];
    const mats=this.materials.getBuildingMaterials(config);
    for(const child of [...group.children])if(child.material===mats.window)group.remove(child);
    const frame=new THREE.MeshStandardMaterial({color:0x102542,roughness:.84,metalness:.05});
    const glass=mats.window.clone();glass.emissiveIntensity=.85;glass.roughness=.65;glass.metalness=0;
    const facade=new THREE.Group();facade.name='window_panes_and_mullions';
    let panes=0;
    const addWindow=(x,y,z,w,h,rotation=0)=>{
      const window=new THREE.Group();window.position.set(x,y,z);window.rotation.y=rotation;
      const pane=new THREE.Mesh(new THREE.BoxGeometry(w,h,.065),glass);window.add(pane);
      for(const dy of [-h/2,0,h/2]){
        const rail=new THREE.Mesh(new THREE.BoxGeometry(w+.12,.075,.12),frame);rail.position.z=.045;rail.position.y=dy;window.add(rail);
      }
      for(const dx of [-w/2,0,w/2]){
        const mullion=new THREE.Mesh(new THREE.BoxGeometry(.075,h+.1,.12),frame);mullion.position.set(dx,0,.045);window.add(mullion);
      }
      facade.add(window);panes++;
    };
    const rows=config.id==='assignments'||config.id==='mocks'||config.id==='listening'?2:1;
    const windowH=config.id==='reading'?2.7:config.id==='vocabulary'?.72:rows===2?1.12:2.15;
    for(const side of [-1,1]){
      for(let row=0;row<rows;row++)for(let col=0;col<3;col++){
        const y=config.id==='vocabulary'?.77:rows===2?1.6+row*1.6:2.6;
        addWindow((col-1)*(width-1.8)/3,y,side*(depth/2+.12),(width-2)/3-.18,windowH,side===1?0:Math.PI);
      }
      for(let col=0;col<3;col++)addWindow(side*(width/2+.12),config.id==='vocabulary'?.77:2.5,(col-1)*(depth-1.8)/3,(depth-2)/3-.18,windowH,side*Math.PI/2);
    }
    if(config.id==='listening')for(const side of [-1,1])for(let col=0;col<3;col++)addWindow((col-1)*1.85,5.35,side*3.13,1.6,1.65,side===1?0:Math.PI);
    if(config.id==='live_classes')facade.position.y=.2;
    group.add(facade);group.userData.windowCount=panes;
    // A round conduit wraps all four sides outside the opaque foundation.
    const plinth=group.children[0].geometry.parameters;
    const halfW=plinth.width/2+.4,halfD=plinth.depth/2+.4;
    const loop=[[-halfW,.24,-halfD],[halfW,.24,-halfD],[halfW,.24,halfD],[-halfW,.24,halfD],[-halfW,.24,-halfD]];
    for(let i=1;i<loop.length;i++)group.add(neonTube(loop[i-1],loop[i],config.color,.075));
    group.userData.foundationLoop=loop;
    group.userData.facadeIllumination=true;
  }

  createSystemComponents(kind='processor'){
    const group=new THREE.Group();group.name='campus_system_components';group.userData.kind=kind;
    const shell=new THREE.MeshStandardMaterial({color:0x294d85,roughness:.7,metalness:.18,emissive:0x122d57,emissiveIntensity:.28});
    const lid=new THREE.MeshStandardMaterial({color:0x3b69a0,roughness:.66,metalness:.12});
    const recess=new THREE.MeshStandardMaterial({color:0x10233d,roughness:.8,metalness:.12});
    const glow=new THREE.MeshBasicMaterial({color:new THREE.Color(0x47cfff).multiplyScalar(2.7),toneMapped:false});
    const steel=new THREE.MeshStandardMaterial({color:0x7aa8c9,roughness:.65,metalness:.2});
    const box=(name,w,h,d,x,y,z,material)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.name=name;
      mesh.position.set(x,y,z);group.add(mesh);return mesh;
    };
    if(kind==='power'){
      // Low stepped electrical housing with a luminous collar, as in the sample.
      box('power_base',5.3,.55,4.6,0,.275,0,shell);
      box('power_lower_tier',4.45,.65,3.8,0,.875,0,lid);
      box('power_dark_spacer',3.7,.25,3.15,0,1.325,0,recess);
      box('power_cyan_collar',3.72,.13,3.17,0,1.515,0,glow);
      box('power_stack',3.65,1.05,3.1,0,2.1,0,shell);
      box('power_top_lid',3.85,.24,3.3,0,2.745,0,lid);
      box('power_top_recess',1.15,.055,1.1,0,2.9,0,recess);
      box('power_top_contact',.64,.07,.6,0,2.96,0,shell);
      for(const sign of [-1,1])for(let i=0;i<4;i++){
        box('component_vent',.34,.13,.065,-.78+i*.52,1.0,sign*1.93,recess);
      }
    }else{
      // A shallow exposed processor/control panel, without any desktop equipment.
      box('processor_base',6.4,.48,4.6,0,.24,0,shell);
      box('processor_recess',5.7,.1,3.9,0,.53,0,recess);
      box('processor_socket',3.05,.2,2.25,-.55,.66,.25,lid);
      box('processor_chip',2.3,.14,1.65,-.55,.84,.25,glow);
      box('component_connector',1.85,.3,.75,.15,.76,-1.35,shell);
      for(let i=0;i<5;i++){
        box('component_heatsink_fin',.15,.32,.75,1.8+i*.2,.78,-.4,lid);
        box('component_contact',.16,.06,.28,-1.65+i*.55,.65,1.55,steel);
      }
      for(const x of [-2.45,2.45]){
        const light=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),glow);
        light.name='component_signal_light';light.position.set(x,.3,2.34);group.add(light);
      }
      for(const sign of [-1,1])for(let i=0;i<4;i++){
        box('component_vent',.055,.16,.48,sign*3.23,.27,-1.15+i*.67,recess);
      }
    }
    return group;
  }

  createPineTree(scale = 1.0) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * scale, 0.35 * scale, 1.5 * scale, 8), this.materials.materials.get('wood'));
    trunk.position.y = 0.75 * scale;
    tree.add(trunk);

    const foliageMat = this.materials.materials.get('tree_pine');
    // 3 stacked cones
    for (let i = 0; i < 3; i++) {
      const coneR = (1.25 - i * 0.26) * scale;
      const coneH = (3.1 - i * 0.3) * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 7), foliageMat);
      cone.position.y = (1.9 + i * 1.6) * scale;
      tree.add(cone);
    }
    return tree;
  }

  createStreetLamp(scale = 1.0, phase = 0) {
    const lamp = new THREE.Group();
    const postMat = this.materials.materials.get('dark_metal');
    const glowMat = this.materials.materials.get('lamp_glow').clone();
    this.materials.animatedMaterials.push({mat:glowMat,type:'breathe',base:2.2,amp:.3,freq:1.8,phase});

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
    lamp.userData.light=pl;
    lamp.userData.phase=phase;

    return lamp;
  }

  createBench(scale = 1.0) {
    const bench = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({color:0x344d79,roughness:.78,metalness:.15});
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
