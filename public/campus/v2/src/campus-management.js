import * as THREE from '../vendor/three-runtime.js';
import { CAMPUS_CONFIG } from './campus-config.js';
import { neonTube } from './campus-neon.js';

// This destination never enters the learning modules or their circuit network.
// Its island is below the front edge, separated by open space on every side.
export const MANAGEMENT_CASTLE = {
  id: 'management', name: 'Management', icon: 'management',
  route: '/app/management', accentHex: '#d6b4ff', color: 0xb98aff,
  pos: { x: 86, y: -4, z: 100 },
  labelPos: { x: 86, y: 3, z: 114 },
};

export function campusSceneConfig(management) {
  if (!management) return CAMPUS_CONFIG;
  return {
    ...CAMPUS_CONFIG,
    camera: {
      ...CAMPUS_CONFIG.camera, orthoHeight: 175, minWorldWidth: 270,
      position: { x: 115, y: 85, z: 113 },
      target: { x: 22, y: -2.5, z: 24 },
    },
    // A staff view must not restore a student pose that crops the new island.
    storage: { ...CAMPUS_CONFIG.storage, cameraKey: `${CAMPUS_CONFIG.storage.cameraKey}_management_v1` },
  };
}

export function createManagementArea(config = MANAGEMENT_CASTLE) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f9db7, roughness: .82, metalness: .12 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xc6cedb, roughness: .7, metalness: .16 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x91a9cd, roughness: .7, metalness: .08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x172035, roughness: .92 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8aa55, roughness: .4, metalness: .7 });
  const windowGlow = new THREE.MeshStandardMaterial({ color: 0xffd786, emissive: 0xffba52, emissiveIntensity: 1.4 });
  const violet = new THREE.MeshStandardMaterial({ color: 0x9164d4, emissive: 0x653cb0, emissiveIntensity: .35, side: THREE.DoubleSide });
  const mesh = (parent, geometry, material, x, y, z, name) => {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z); item.name = name || '';
    item.castShadow = !material.transparent; item.receiveShadow = true;
    parent.add(item); return item;
  };
  const box = (parent, w, h, d, material, x, y, z, name) =>
    mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z, name);

  const island = new THREE.Group(); island.name = 'management_island';
  island.position.set(config.pos.x, config.pos.y, config.pos.z);
  const outline = new THREE.Shape();
  outline.moveTo(-25, -21); outline.lineTo(25, -21);
  outline.lineTo(25, 21); outline.lineTo(-25, 21); outline.closePath();
  const slab = new THREE.ExtrudeGeometry(outline, {
    depth: 3.6, steps: 1, bevelEnabled: true, bevelSize: .8, bevelThickness: .6, bevelSegments: 2,
  });
  slab.rotateX(Math.PI / 2); slab.translate(0, -.6, 0);
  mesh(island, slab, dark, 0, 0, 0, 'management_island_slab');
  box(island, 49.8, .12, 41.8, new THREE.MeshStandardMaterial({ color: 0x1e3438, roughness: 1 }), 0, .04, 0);
  box(island, 37, .14, 31, new THREE.MeshStandardMaterial({ color: 0x293248, roughness: .94 }), 0, .16, -1);
  const rim=[[-25.9,-1,-21.9],[25.9,-1,-21.9],[25.9,-1,21.9],[-25.9,-1,21.9],[-25.9,-1,-21.9]];
  for (let i=1;i<rim.length;i++) island.add(neonTube(rim[i-1],rim[i],config.color,.12));
  // Only an internal approach; no bridge, road or cable reaches the campus.
  box(island, 5, .18, 8, edge, 0, .19, 16.5, 'management_courtyard_path');
  for (const x of [-21, 21]) for (const z of [-15, -5, 6, 16]) {
    mesh(island, new THREE.CylinderGeometry(.28,.38,1.8,6), gold, x, 1, z);
    mesh(island, new THREE.ConeGeometry(2,4.7,7), new THREE.MeshStandardMaterial({ color: 0x28584f, roughness: 1 }), x, 3.4, z);
  }

  const castle = new THREE.Group(); castle.name = 'building_management';
  castle.position.set(config.pos.x, config.pos.y + .3, config.pos.z);
  castle.userData = { id: config.id, name: config.name, route: config.route };
  // Enclosed courtyard, four corner turrets and a taller central keep.
  box(castle, 31, .9, 26, edge, 0, .45, 0, 'castle_foundation');
  box(castle, 15, 12, 13, stone, 0, 6.8, -3, 'castle_keep');
  box(castle, 16, .8, 14, edge, 0, 13.2, -3);
  for (const x of [-13,13]) box(castle, 1.1, 6.7, 20, stone, x, 4.2, 0, 'castle_side_wall');
  box(castle, 26, 6.7, 1.1, stone, 0, 4.2, -10, 'castle_back_wall');
  for (const x of [-8,8]) box(castle, 10, 6.7, 1.2, stone, x, 4.2, 10, 'castle_gate_wall');
  box(castle, 6, 2.3, 1.4, edge, 0, 6.4, 10);
  for (let x=-11; x<=11; x+=2.2) {
    box(castle, 1.25, 1.35, 1.4, edge, x, 8.2, -10);
    box(castle, 1.25, 1.35, 1.4, edge, x, 8.2, 10);
  }
  for (const x of [-13,13]) for (let z=-7;z<=7;z+=2.3) box(castle,1.4,1.35,1.25,edge,x,8.2,z);
  // A tall rounded conical roof gives the central keep its castle silhouette.
  const keepRoof=new THREE.ConeGeometry(11.3,10.8,48);
  keepRoof.scale(1,1,.88);
  mesh(castle,keepRoof,roof,0,19,-3,'castle_keep_pitched_roof');
  for (const x of [-13,13]) for (const z of [-10,10]) {
    const tower = new THREE.Group(); tower.name = 'castle_turret'; tower.position.set(x,0,z); castle.add(tower);
    mesh(tower, new THREE.CylinderGeometry(2.6,3,13.4,10),stone,0,7.1,0);
    mesh(tower, new THREE.CylinderGeometry(3,3, .65,10),edge,0,13.6,0);
    mesh(tower, new THREE.ConeGeometry(3.6,5.6,32),roof,0,16.7,0);
    mesh(tower, new THREE.SphereGeometry(.36,8,6),gold,0,19.6,0);
    for (const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]) {
      const pane=box(tower,.65,1.8,.14,windowGlow,Math.sin(angle)*2.63,9,Math.cos(angle)*2.63);
      pane.rotation.y=angle;
    }
  }
  // A recessed, lit arch and portcullis make the entry visible at map scale.
  const arch = new THREE.Shape(); arch.moveTo(-2.35,0);arch.lineTo(-2.35,3.4);
  arch.absarc(0,3.4,2.35,Math.PI,0,true);arch.lineTo(2.35,0);arch.closePath();
  mesh(castle,new THREE.ExtrudeGeometry(arch,{depth:.25,bevelEnabled:false}),windowGlow,0,.9,10.65,'castle_gate');
  for (let x=-1.8;x<=1.8;x+=.6) box(castle,.13,4.4,.18,gold,x,3.1,11.05);
  for (const y of [2,3.4,4.8]) box(castle,4.1,.13,.18,gold,0,y,11.08);
  for (let i=0;i<3;i++) box(castle,6.6+i*.7,.3,1.1,edge,0,.65-i*.2,11.7+i*.9);
  for (const x of [-4.6,4.6]) {
    box(castle,1.1,2,.15,windowGlow,x,8.4,3.58);
    box(castle,1.3,3.1,.18,violet,x,11,3.65,'castle_banner');
  }
  mesh(castle,new THREE.CylinderGeometry(.12,.12,5.2,8),gold,0,27,-3,'castle_flagpole');
  // Geometry, rather than a platform-dependent emoji, keeps 🇺🇿 recognizable.
  const flag=new THREE.Group();flag.name='castle_flag';flag.position.set(.15,29.3,-3);flag.scale.setScalar(2);
  flag.userData.country='UZ';castle.add(flag);
  const flagColors={blue:0x0099b5,white:0xffffff,green:0x1eb53a,red:0xce1126};
  const flagMats=Object.fromEntries(Object.entries(flagColors).map(([key,color])=>[key,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide})]));
  const stripe=(name,y,height)=>mesh(flag,new THREE.PlaneGeometry(5,height,32,4),flagMats[name],2.5,y,0,'uzbekistan_'+name);
  stripe('blue',-.4,.8);stripe('red',-.825,.05);stripe('white',-1.25,.8);
  stripe('red',-1.675,.05);stripe('green',-2.1,.8);
  mesh(flag,new THREE.CircleGeometry(.29,32),flagMats.white,.62,-.4,.01,'uzbekistan_crescent');
  mesh(flag,new THREE.CircleGeometry(.25,32),flagMats.blue,.72,-.37,.02);
  for(let row=0;row<3;row++)for(let col=0;col<3+row;col++){
    const star=new THREE.Shape();
    for(let i=0;i<10;i++){
      const angle=Math.PI/2+i*Math.PI/5,r=i%2?.035:.08;
      const x=Math.cos(angle)*r,y=Math.sin(angle)*r;
      if(i===0)star.moveTo(x,y);else star.lineTo(x,y);
    }
    star.closePath();
    mesh(flag,new THREE.ShapeGeometry(star),flagMats.white,1.1+(2-row)*.2+col*.25,-.16-row*.24,.01,'uzbekistan_star');
  }
  flag.userData.fabric=flag.children.filter(item=>item.isMesh).map(item=>{
    item.castShadow=false;
    return {mesh:item,rest:item.geometry.attributes.position.array.slice()};
  });
  castle.userData.flag=flag;
  const light=new THREE.PointLight(0xffd484,2.6,28,1.7);light.position.set(0,5,12);castle.add(light);
  castle.userData.restingScale=castle.scale.clone();
  return { island, castle };
}


