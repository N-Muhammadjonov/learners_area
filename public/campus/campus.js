/**
 * Learners Area Campus. Real WebGL geometry, not a parallax PNG.
 * Vanilla JavaScript + Three.js. The rest of the Next.js app is untouched.
 *
 * The external ESM imports are pinned for the preview branch. If the CDN or
 * WebGL is unavailable, CampusWorld.tsx keeps accessible HTML navigation.
 */
import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/addons/controls/OrbitControls.js";

const NAV = [
  { id:"writing", href:"/app/writing", color:0x38e995, x:-8.2, z:-3.8, h:1.52, emblem:"✎" },
  { id:"listening", href:"/app/listening/lessons", color:0x2e9dff, x:-4.3, z:-6.4, h:1.95, emblem:"♫" },
  { id:"reading", href:"/app/reading/lessons", color:0xffc363, x:0, z:-8.3, h:2.15, emblem:"▤" },
  { id:"video", href:"/app/video-lessons", color:0xf75b98, x:4.7, z:-6.5, h:1.85, emblem:"▶" },
  { id:"live", href:"/app/live-classes", color:0x31d9ce, x:8.15, z:-3.7, h:1.65, emblem:"♟" },
  { id:"speaking", href:"/app/speaking", color:0xdb69fb, x:-8.3, z:1.7, h:1.7, emblem:"♬" },
  { id:"grammar", href:"/app/grammar/lessons", color:0x518cff, x:-5.5, z:6.4, h:1.78, emblem:"grammar" },
  { id:"vocabulary", href:"/app/vocabulary", color:0xfa5c8b, x:0, z:8.3, h:1.55, emblem:"ABC" },
  { id:"progress", href:"/app/progress", color:0xffbb5f, x:5, z:6.7, h:1.35, emblem:"▥" },
  { id:"mocks", href:"/app/mocks", color:0x70baf9, x:8.25, z:2.2, h:1.8, emblem:"▥" },
  { id:"assignments", href:"/app/assignments", color:0xb77cff, x:7.5, z:-0.9, h:1.68, emblem:"▣" }
];
const START = [19.5, 24.5, 25];
const TARGET = [0, 0.4, 0];
const STORE = "learners-campus-camera-v2";
const markerPlane = new THREE.PlaneGeometry(1.2, 1.2);
const glowMaterial = (color, opacity=1) => new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false});
const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const hex = n=>"#"+n.toString(16).padStart(6,"0");

function box(parent, w,h,d, color,x=0,y=0,z=0, material=null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material||new THREE.MeshStandardMaterial({
    color,roughness:.62,metalness:.16
  }));
  m.position.set(x,y,z); parent.add(m); return m;
}
function pointLight(parent,color,x,y,z,intensity=1.1,range=5) {
  const l=new THREE.PointLight(color,intensity,range,2);
  l.position.set(x,y,z); parent.add(l); return l;
}
function makeCanvasSymbol(text,color,brain=false) {
  const c=document.createElement("canvas");c.width=256;c.height=256;
  const ctx=c.getContext("2d"); if(!ctx) return null;
  ctx.clearRect(0,0,256,256);
  ctx.shadowBlur=18;ctx.shadowColor=color;ctx.strokeStyle=color;ctx.fillStyle=color;
  if(brain){
    ctx.lineWidth=9;ctx.lineJoin="round";ctx.lineCap="round";
    ctx.beginPath();
    ctx.moveTo(127,62);ctx.bezierCurveTo(109,36,77,45,70,72);
    ctx.bezierCurveTo(35,65,30,98,48,120);
    ctx.bezierCurveTo(26,150,44,177,72,178);
    ctx.bezierCurveTo(74,213,115,220,127,189);
    ctx.bezierCurveTo(139,220,180,213,182,178);
    ctx.bezierCurveTo(210,177,228,150,206,120);
    ctx.bezierCurveTo(224,98,219,65,184,72);
    ctx.bezierCurveTo(177,45,145,36,127,62);
    ctx.moveTo(127,62);ctx.lineTo(127,191);
    ctx.moveTo(74,96);ctx.bezierCurveTo(98,104,99,121,87,136);
    ctx.moveTo(180,96);ctx.bezierCurveTo(156,104,155,121,167,136);
    ctx.moveTo(68,158);ctx.bezierCurveTo(93,151,102,161,100,180);
    ctx.moveTo(186,158);ctx.bezierCurveTo(161,151,152,161,154,180);
    ctx.stroke();
  } else {
    ctx.font = text.length>2 ? "bold 75px Arial" : "bold 150px Arial";
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(text,128,130);
  }
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;
  return tex;
}
/** Procedural, additive, soft glow texture for LED bulbs and electric current. */
function makeGlowTexture(){
  const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext("2d");
  if(!ctx)return null;
  const gradient=ctx.createRadialGradient(64,64,2,64,64,63);
  gradient.addColorStop(0,"rgba(255,255,255,1)");
  gradient.addColorStop(.18,"rgba(255,255,255,.8)");
  gradient.addColorStop(.43,"rgba(255,255,255,.32)");
  gradient.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
function makeGroundGlow(scene,texture,color,opacity,size){
  if(!texture)return {position:new THREE.Vector3(),material:{opacity},visible:true};
  // Rotated plane remains *on the street*, unlike camera-facing floating bubbles.
  const material=new THREE.MeshBasicMaterial({color,map:texture,transparent:true,
    opacity,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(size,size),material);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=.165;scene.add(mesh);return mesh;
}

function makeBuilding(scene,entry,reduced) {
  const root=new THREE.Group();
  root.position.set(entry.x,0.15,entry.z);scene.add(root);
  const c=entry.color;
  const dark=new THREE.Color(c).multiplyScalar(.30);
  const buildingColor=new THREE.Color(c).multiplyScalar(.43);
  box(root,2.8,.24,2.8,0x0b2440,0,.12,0);
  box(root,2.65,.065,2.65,c,0,.267,0,glowMaterial(c,.68));
  box(root,2.15,entry.h,2.05,buildingColor,0,.34+entry.h/2,0);
  box(root,2.34,.23,2.24,dark,0,.36+entry.h,0);
  box(root,2.28,.048,2.18,c,0,.505+entry.h,0,glowMaterial(c,.75));
  // Window geometry is deliberately low-poly and remains real when orbiting.
  const winMat=new THREE.MeshBasicMaterial({color:0xffd4a2,transparent:true,opacity:.94,depthWrite:false});
  for(let row=0;row<2;row++){
    const y=.75+row*.62;
    if(y>entry.h+.19)continue;
    for(let col=-1;col<=1;col++){
      box(root,.28,.28,.015,c,col*.53,y,1.035,winMat);
      box(root,.28,.28,.015,c,col*.53,y,-1.035,winMat);
      box(root,.015,.28,.28,c,1.085,y,col*.5,winMat);
      box(root,.015,.28,.28,c,-1.085,y,col*.5,winMat);
    }
  }
  // Symbol panel faces upwards, just like the miniature buildings in the reference.
  if(entry.id==="grammar"){
    const cap=box(root,1.19,.18,1.19,dark,0,entry.h+.72,0);
    cap.rotation.y=Math.PI/4;
  }
  const symbol=entry.id==="grammar" ? makeCanvasSymbol(entry.emblem,"#f5bf49",true) : null;
  if(symbol){
    const sign=new THREE.Mesh(markerPlane,new THREE.MeshBasicMaterial({
      map:symbol,transparent:true,depthWrite:false,side:THREE.DoubleSide
    }));
    sign.rotation.x=-Math.PI/2; sign.position.set(0,entry.h+.826,0);
    root.add(sign);root.userData.symbolTexture=symbol;
  }

  // Distinct sculpted, rotatable roof landmarks match the original campus
  // concept instead of repeating identical rectangles on each building.
  // Anchor all real roof objects to the roof slab; the previous +1.0 left them floating.
  const roof=new THREE.Group();roof.position.y=entry.h+.32;root.add(roof);
  const solid=(color)=>new THREE.MeshStandardMaterial({color,metalness:.26,roughness:.32,emissive:color,emissiveIntensity:.18});
  const addShape=(geo,material,x,y,z,rx=0,ry=0,rz=0)=>{
    const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);
    m.rotation.set(rx,ry,rz);roof.add(m);return m;
  };
  const gold=solid(0xffc66b),neon=solid(c);
  const torus=(radius,tube,material,x,y,z,rx=0,ry=0,rz=0)=>
    addShape(new THREE.TorusGeometry(radius,tube,8,40),material,x,y,z,rx,ry,rz);
  const slab=(w,h,d,material,x,y,z,rx=0,ry=0,rz=0)=>
    addShape(new THREE.BoxGeometry(w,h,d),material,x,y,z,rx,ry,rz);
  const sphere=(radius,material,x,y,z)=>
    addShape(new THREE.SphereGeometry(radius,12,8),material,x,y,z);
  // Existing roof canvas plate is retained only for Grammar, whose mark has
  // the user's approved specific brain silhouette.
  if(entry.id==="listening"){
    torus(.48,.092,neon,0,.52,0,0,0,0);
    slab(.20,.47,.28,neon,-.47,.30,0);
    slab(.20,.47,.28,neon,.47,.30,0);
  } else if(entry.id==="reading"){
    for(const dir of [-1,1]){
      slab(.94,.09,.66,gold,dir*.48,.30,0,.18*dir,0,-.13*dir);
      slab(.96,.045,.62,solid(0xfff2ca),dir*.48,.39,0,.18*dir,0,-.13*dir);
    }
    slab(.11,.13,.82,gold,0,.18,0);
  } else if(entry.id==="video"){
    slab(.87,1.05,.22,neon,0,.48,0);
    const tri=new THREE.Shape();tri.moveTo(-.22,-.30);tri.lineTo(.35,0);tri.lineTo(-.22,.30);tri.closePath();
    addShape(new THREE.ShapeGeometry(tri),solid(0xff9dbc),0,.49,.14);
  } else if(entry.id==="live"){
    for(const [x,y,radius] of [[-.36,.56,.22],[.25,.69,.27],[.69,.50,.18]]){
      sphere(radius,neon,x,y,0);slab(radius*2.4,.43,.28,neon,x,y-.40,0);
    }
  } else if(entry.id==="writing"){
    slab(.15,.15,1.3,neon,0,.49,0,.16,.25,.48);
    addShape(new THREE.ConeGeometry(.14,.34,5),solid(0xb9ffe0),.48,.15,.29,Math.PI/2,0,.48);
  } else if(entry.id==="speaking"){
    const mic=sphere(.28,neon,0,.67,0);
    mic.scale.set(.78,1.45,.77);
    slab(.09,.56,.09,neon,0,.13,0);slab(.65,.085,.22,neon,0,-.10,0);
    torus(.47,.045,neon,0,.39,0,0,0,0);
  } else if(entry.id==="vocabulary"){
    const cubes=[[-.36,.16,"A"],[.34,.11,"B"],[0,.72,"C"]];
    for(const [x,y] of cubes){slab(.65,.65,.65,solid(0xff84ba),x,y,0);}
  } else if(entry.id==="assignments"){
    slab(.83,.94,.18,neon,0,.53,0);
    for(let i=0;i<3;i++)slab(.48,.045,.04,solid(0xffd6fe),0,.76-i*.19,.12);
    slab(.37,.11,.18,solid(0xffd6fe),0,1.03,0);
  } else if(entry.id==="mocks"){
    for(let i=0;i<3;i++)slab(.21,.39+i*.23,.24,neon,(i-1)*.32,.21+i*.12,0);
  } else if(entry.id==="progress"){
    sphere(.43,gold,0,.59,0);
    for(const dir of [-1,1])torus(.26,.07,gold,dir*.46,.59,0,0,0,0);
    slab(.13,.50,.13,gold,0,.16,0);slab(.74,.15,.38,gold,0,-.06,0);
  }
  // Extra horizontal warm strips resemble the illuminated windows from the reference.
  box(root,1.55,.055,.065,c,0,.84,1.069,glowMaterial(c,.85));
  box(root,1.55,.055,.065,c,0,1.43,1.069,glowMaterial(c,.85));

  // Light only the building's real corners and street-facing windows.
  const bodyOutline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.17,entry.h,2.07)),
    new THREE.LineBasicMaterial({color:c,transparent:true,opacity:.62}));
  bodyOutline.position.y=.34+entry.h/2;root.add(bodyOutline);
  for(const side of [-1,1]){
    box(root,.055,.055,2.19,c,side*1.14,entry.h+.52,0,glowMaterial(c,.82));
    box(root,2.30,.055,.055,c,0,entry.h+.52,side*1.09,glowMaterial(c,.82));
  }
  // A roof spotlight glows softly rather than emitting floating particles.
  if(!reduced) pointLight(root,c,0,entry.h+.76,0,.35,3.9);
  const hit=new THREE.Mesh(new THREE.BoxGeometry(2.7,entry.h+1.5,2.7),new THREE.MeshBasicMaterial({
    transparent:true,opacity:0,depthWrite:false
  }));
  hit.position.y=(entry.h+1.5)/2;hit.userData.href=entry.href;hit.userData.key=entry.id;
  root.add(hit);
  return {root, hit, entry, glow:box(root,2.7,.045,2.7,c,0,.29,0,glowMaterial(c,.16))};
}
function tree(scene,x,z,scale=1) {
  const g=new THREE.Group();g.position.set(x,.13,z);g.scale.setScalar(scale);
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.055,.07,.45,5),new THREE.MeshStandardMaterial({color:0x365354}));
  trunk.position.y=.22;g.add(trunk);
  for(let i=0;i<2;i++){
    const crown=new THREE.Mesh(new THREE.ConeGeometry(.28-i*.06,.75-i*.05,5),new THREE.MeshStandardMaterial({
      color:i?0x145955:0x0c444c,roughness:1
    }));
    crown.position.y=.76+i*.28;g.add(crown);
  }
  scene.add(g);
}
function lineTube(scene,points,color,radius=.025,opacity=1) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],p[2])),false,"centripetal");
  const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*15),radius,5,false),
    glowMaterial(color,opacity));
  scene.add(tube);return curve;
}
function addBillboardTexture(scene,uri,w,h,pos) {
  const loader=new THREE.TextureLoader();
  loader.load(uri,(texture)=>{
    texture.colorSpace=THREE.SRGBColorSpace;
    // A camera-facing sprite preserves the single approved LA mark when the world orbits.
    const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});
    const mesh=new THREE.Sprite(material);
    mesh.scale.set(w,h,1);
    mesh.position.set(...pos);
    mesh.userData.campusBrand=true; scene.add(mesh);
  },undefined,()=>{/* Label remains accessible if logo asset fails. */});
}

export function mountCampus(node) {
  if(!node || !node.isConnected) return ()=>{};
  const canvasParent=node.querySelector("[data-campus-canvas]");
  const fallback=node.querySelector("[data-campus-fallback]");
  const labelNodes=new Map([...node.querySelectorAll("[data-campus-label]")].map(el=>[el.dataset.campusLabel,el]));
  if(!canvasParent) return ()=>{};
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try {
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance",failIfMajorPerformanceCaveat:false});
  } catch (err) {
    node.dataset.campusStatus="unavailable";return ()=>{};
  }
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
  renderer.domElement.setAttribute("aria-hidden","true");
  renderer.domElement.style.touchAction="none";
  canvasParent.appendChild(renderer.domElement);
  node.dataset.campusStatus="ready";
  if(fallback)fallback.setAttribute("aria-hidden","true");

  const scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0x08172c,.014);
  const camera=new THREE.PerspectiveCamera(39,1,.1,160);
  camera.position.set(...START);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(...TARGET);
  controls.enableDamping=true; controls.dampingFactor=.065;
  controls.enablePan=false;
  controls.enableZoom=false; // Dedicated horizontal-trackpad orbit and vertical-trackpad zoom below.
  controls.minDistance=12;controls.maxDistance=43;
  controls.minPolarAngle=.32;controls.maxPolarAngle=1.39;
  controls.maxAzimuthAngle=Infinity;controls.minAzimuthAngle=-Infinity;
  controls.update();
  try {
    const value=JSON.parse(sessionStorage.getItem(STORE)||"null");
    if(Array.isArray(value?.position)&&Array.isArray(value?.target)&&value.position.every(Number.isFinite) && value.target.every(Number.isFinite) && value.position.length===3 && value.target.length===3){
      camera.position.fromArray(value.position);controls.target.fromArray(value.target);controls.update();
    }
  }catch{/* ignore corrupt stored camera */}
  scene.add(new THREE.HemisphereLight(0x91c8fe,0x041222,2.15));
  const mainLight=new THREE.DirectionalLight(0xb1baff,2.7);
  mainLight.position.set(-7,20,12);scene.add(mainLight);
  const warm=new THREE.DirectionalLight(0xffc888,1.15);warm.position.set(9,14,-6);scene.add(warm);

  // All street lights stay anchored in the asphalt. No orbiting or rising bubbles.
  const base=new THREE.Group();scene.add(base);
  box(base,23.7,.58,23.7,0x07162b,0,-.37,0);
  box(base,23.45,.16,23.45,0x101f35,0,-.055,0);
  for(let n=-11;n<=11;n+=1.5){
    const mat=new THREE.LineBasicMaterial({color:0x1b3652,transparent:true,opacity:.24});
    for(const vertical of [true,false]){
      const points=vertical?[
        new THREE.Vector3(n,.04,-11.5),new THREE.Vector3(n,.04,11.5)
      ]:[new THREE.Vector3(-11.5,.04,n),new THREE.Vector3(11.5,.04,n)];
      base.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),mat));
    }
  }
  for(const side of [-1,1]){
    box(base,.042,.05,23.65,0x00b5ef,side*11.82,-.075,0,glowMaterial(0x00b5ef,.85));
    box(base,23.65,.05,.042,0x00b5ef,0,-.075,side*11.82,glowMaterial(0x00b5ef,.85));
  }

  const circleSegments=96;
  const floorLeds=[];
  for(let ring=0;ring<3;ring++){
    const r=2.05+ring*.36;
    const points=[];
    for(let i=0;i<=circleSegments;i++){
      const a=i/circleSegments*Math.PI*2;
      points.push(new THREE.Vector3(Math.cos(a)*r,.105,Math.sin(a)*r));
    }
    const geo=new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.Line(geo,new THREE.LineBasicMaterial({
      color:ring===1?0xd6b36c:0x35caff,transparent:true,opacity:.75
    })));
    for(let i=0;i<20;i++){
      const a=i/20*Math.PI*2,px=Math.cos(a)*r,pz=Math.sin(a)*r;
      const led=new THREE.Mesh(new THREE.CircleGeometry(.062,12),
        new THREE.MeshBasicMaterial({color:ring===1?0xf7dba0:0x69faff,transparent:true,opacity:.3,side:THREE.DoubleSide}));
      led.rotation.x=-Math.PI/2;led.position.set(px,.116,pz);scene.add(led);
      const halo=makeGroundGlow(scene,makeGlowTexture(),ring===1?0xffcd74:0x1fdfff,.25,.55);
      halo.position.set(px,.154,pz);
      floorLeds.push({mesh:led,halo,angle:a,ring});
    }
  }
  box(scene,3.25,.22,3.25,0x0e3453,0,.17,0);
  const portal=new THREE.Mesh(new THREE.CylinderGeometry(1.50,1.58,.19,32),
    new THREE.MeshStandardMaterial({color:0x123253,emissive:0x064e7c,emissiveIntensity:.7,metalness:.55,roughness:.29}));
  portal.position.y=.34;scene.add(portal);
  addBillboardTexture(scene,"/brand/derived/owner-v11-night-192.png",2.35,1.75,[0,1.66,0]);
  // A grounded highlight behind the single official brand mark.
  pointLight(scene,0x10c2ff,0,.45,0,1.4,7);

  // Ground-level electrical paths: constantly moving emissive pulses.
  // This soft radial texture is a fixed, ground-oriented glow, not airborne particles.
  const circuits=[];
  const pulseMeshes=[];
  const pulseHaloTexture=makeGlowTexture();
  const entries=NAV.map(e=>makeBuilding(scene,e,reduced));

  for(const entry of NAV){
    const color=entry.color;
    const mx=entry.x*.56,mz=entry.z*.54;
    const path=lineTube(scene,[[0,.13,0],[mx,.132,0],[mx,.132,mz],[entry.x,.132,mz],[entry.x,.132,entry.z]],color,.028,.64);
    lineTube(scene,[[0,.148,0],[mx,.15,0],[mx,.15,mz],[entry.x,.15,mz],[entry.x,.15,entry.z]],color,.065,.24);
    circuits.push({curve:path,offset:(circuits.length*.167)%1});
    for(let i=0;i<3;i++){
      // Flat light streaks hug the asphalt; no floating spherical bubbles.
      const pulse=new THREE.Mesh(new THREE.BoxGeometry(i===0?.28:.17,.024,i===0?.095:.07),
        new THREE.MeshBasicMaterial({color:i===0?0xffffff:color,transparent:true,opacity:i===0?1:.64,depthWrite:false,blending:THREE.AdditiveBlending}));
      scene.add(pulse);
      const halo=makeGroundGlow(scene,pulseHaloTexture,color,i===0?.88:.59,.95);
      pulseMeshes.push({mesh:pulse,halo,curve:path,index:i,phase:circuits.length*.139});
    }
    // 2 road LED studs at fixed asphalt coordinates for each circuit.
    for(const dist of [.35,.76]){
      const pos=path.getPointAt(dist);
      const led=new THREE.Mesh(new THREE.CircleGeometry(.079,12),
        new THREE.MeshBasicMaterial({color,transparent:true,opacity:.3,side:THREE.DoubleSide}));
      led.rotation.x=-Math.PI/2;led.position.set(pos.x,.141,pos.z);
      scene.add(led);
      const halo=makeGroundGlow(scene,pulseHaloTexture,color,.20,.42);
      halo.position.set(pos.x,.154,pos.z);
      floorLeds.push({mesh:led,halo,angle:dist*11,ring:circuits.length});
    }
  }
  // 36 deterministic low-poly trees and several illuminated light poles.
  let seed=411;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<66;i++){
    const x=rand()*21-10.5,z=rand()*21-10.5;
    if(Math.hypot(x,z)<3.2 || NAV.some(e=>Math.hypot(x-e.x,z-e.z)<2.3))continue;
    tree(scene,x,z,.75+rand()*.52);
  }
  const poles=[];
  for(let i=0;i<20;i++){
    const a=i/20*Math.PI*2,r=6.2+(i%3)*1.15,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(NAV.some(e=>Math.hypot(x-e.x,z-e.z)<1.4))continue;
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.025,.037,.79,6),
      new THREE.MeshStandardMaterial({color:0x30546b}));
    pole.position.set(x,.49,z);scene.add(pole);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.087,8,6),
      new THREE.MeshBasicMaterial({color:0xffda86}));
    bulb.position.set(x,.91,z);scene.add(bulb);
    poles.push({bulb,index:i});
  }

  const pickables=entries.map(e=>e.hit);
  // Allow clicking the actual central portal too.
  const centerHit=new THREE.Mesh(new THREE.CylinderGeometry(1.60,1.60,1.1,24),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false}));
  centerHit.position.y=.65;centerHit.userData.href="/app/dashboard";centerHit.userData.key="dashboard";
  scene.add(centerHit);pickables.push(centerHit);
  const raycaster=new THREE.Raycaster();
  const mouse=new THREE.Vector2();
  let down=null, hovered=null,raf=0,disposed=false;
  const tmp=new THREE.Vector3();
  const centerLabel=labelNodes.get("dashboard");

  function hitAt(event){
    const rect=renderer.domElement.getBoundingClientRect();
    mouse.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(mouse,camera);
    return raycaster.intersectObjects(pickables,false)[0]?.object||null;
  }
  function onDown(e){
    if(e.button!==0)return;
    down={x:e.clientX,y:e.clientY,time:performance.now()};
  }
  function onMove(e){
    if(e.pointerType==="touch")return;
    const hit=hitAt(e);hovered=hit?.userData.key||null;
    renderer.domElement.style.cursor=hovered?"pointer":"grab";
    node.dataset.hoveredModule=hovered||"";
  }
  function onUp(e){
    if(!down||e.button!==0)return;
    const delta=Math.hypot(e.clientX-down.x,e.clientY-down.y);
    down=null;
    if(delta>7)return;
    const hit=hitAt(e);
    if(hit?.userData.href && hit.userData.href.startsWith("/app/")){
      remember();window.location.assign(hit.userData.href);
    }
  }
  function remember(){
    try{sessionStorage.setItem(STORE,JSON.stringify({
      position:camera.position.toArray(),target:controls.target.toArray()
    }));}catch{/* storage optional */}
  }
  function onReset(){
    camera.position.set(...START);controls.target.set(...TARGET);controls.update();
    try{sessionStorage.removeItem(STORE);}catch{}
  }
  node.querySelector("[data-campus-reset]")?.addEventListener("click",onReset);
  renderer.domElement.addEventListener("pointerdown",onDown);
  renderer.domElement.addEventListener("pointermove",onMove);
  renderer.domElement.addEventListener("pointerup",onUp);
  renderer.domElement.addEventListener("pointerleave",()=>{hovered=null;});
  controls.addEventListener("end",remember);
  // A two-finger vertical trackpad gesture zooms; horizontal gestures rotate
  // around the campus. OrbitControls' default wheel zoom incorrectly treats
  // both axes as dolly. Suppress it and handle the axes independently.
  let wheelSaveTimer;
  function onWheel(event){
    event.preventDefault();
    const dx=event.deltaX*(event.deltaMode===1?16:1);
    const dy=event.deltaY*(event.deltaMode===1?16:1);
    const offset=camera.position.clone().sub(controls.target);
    if(Math.abs(dx)>0.2){
      offset.applyAxisAngle(new THREE.Vector3(0,1,0),-dx*.0032);
    }
    if(Math.abs(dy)>0.2){
      offset.multiplyScalar(Math.exp(dy*.00115));
    }
    offset.setLength(clamp(offset.length(),controls.minDistance,controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
    clearTimeout(wheelSaveTimer);
    wheelSaveTimer=setTimeout(remember,130);
  }
  renderer.domElement.addEventListener("wheel",onWheel,{passive:false});
  // Browser back/forward and fast Next.js route transitions can unmount before
  // OrbitControls emits 'end'. Save every committed pose before page departure.
  function onPageHide(){remember();}
  window.addEventListener("pagehide",onPageHide);
  function resize(){
    const r=canvasParent.getBoundingClientRect();
    const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvasParent);resize();
  const clock=new THREE.Clock();
  let hidden=document.visibilityState!=="visible";
  let lastCameraSave=0;
  function onVisibility(){hidden=document.visibilityState!=="visible";if(!hidden){clock.start();schedule();}}
  document.addEventListener("visibilitychange",onVisibility);

  function labelPosition(element,point){
    if(!element)return;
    tmp.set(...point).project(camera);
    const visible=tmp.z<1 && tmp.z>-1;
    element.style.visibility=visible?"visible":"hidden";
    if(!visible)return;
    const w=canvasParent.clientWidth,h=canvasParent.clientHeight;
    element.style.left=((tmp.x*.5+.5)*w)+"px";
    element.style.top=((-tmp.y*.5+.5)*h)+"px";
  }
  function schedule(){
    if(!disposed&&!hidden && !raf)raf=requestAnimationFrame(frame);
  }
  function frame(){
    raf=0;if(disposed||hidden)return;
    const t=clock.getElapsedTime();
    controls.update();
    if(t-lastCameraSave>.35){lastCameraSave=t;remember();}
    // Lower-cost motion under reduced-motion. Everything stays on the ground.
    if(!reduced){
      pulseMeshes.forEach(({mesh,halo,curve,index,phase})=>{
        const progress=((t*.22+phase-index*.072)%1+1)%1;
        mesh.position.copy(curve.getPointAt(progress));mesh.position.y=.168+index*.005;
        const tangent=curve.getTangentAt(progress);
        mesh.rotation.y=-Math.atan2(tangent.z,tangent.x);
        halo.position.set(mesh.position.x,.161,mesh.position.z);
        halo.material.opacity=(index===0?.72:.36)*(0.75+.25*Math.sin(t*8-index));
        mesh.material.opacity=index===0?1:.75;
      });
      floorLeds.forEach(({mesh,halo,angle,ring})=>{
        const phase=t*2.0-angle-ring*.22;
        const strength=.12+.88*Math.pow(Math.max(0,Math.sin(phase)),2);
        mesh.material.opacity=strength;
        if(halo)halo.material.opacity=strength*.47;
      });
      poles.forEach(({bulb,index})=>{
        bulb.material.color.setHex(Math.sin(t*1.5+index*.4)>.2?0xffd080:0x665334);
      });
      entries.forEach(({entry,glow})=>{
        glow.material.opacity=hovered===entry.id?.78:(.14+.13*Math.sin(t*1.9+entry.x));
      });
    }else{
      pulseMeshes.forEach(({mesh,halo})=>{mesh.visible=false;halo.visible=false;});
      floorLeds.forEach(({mesh,halo})=>{mesh.material.opacity=.48;if(halo)halo.material.opacity=.20;});
    }
    for(const {entry} of entries)labelPosition(labelNodes.get(entry.id),[entry.x,entry.h*.72+.56,entry.z+1.12]);
    labelPosition(centerLabel,[0,.65,1.35]);
    renderer.render(scene,camera);
    schedule();
  }
  // Rendering loop runs only while the tab is visible.
  schedule();
  return function disposeCampus(){
    disposed=true;cancelAnimationFrame(raf);
    resizeObserver.disconnect();document.removeEventListener("visibilitychange",onVisibility);
    renderer.domElement.removeEventListener("pointerdown",onDown);
    renderer.domElement.removeEventListener("pointermove",onMove);
    renderer.domElement.removeEventListener("pointerup",onUp);
    controls.removeEventListener("end",remember);
    renderer.domElement.removeEventListener("wheel",onWheel);
    window.removeEventListener("pagehide",onPageHide);
    clearTimeout(wheelSaveTimer);
    node.querySelector("[data-campus-reset]")?.removeEventListener("click",onReset);
    remember();controls.dispose();
    scene.traverse(obj=>{
      if(obj.geometry)obj.geometry.dispose();
      const materials=obj.material?[].concat(obj.material):[];
      materials.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});
      if(obj.userData.symbolTexture)obj.userData.symbolTexture.dispose();
    });
    if(pulseHaloTexture)pulseHaloTexture.dispose();
    renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  };
}

// A module script can be evaluated once per browser session; React can remount
// the canvas many times without relying on script re-execution.
window.LearnersAreaCampusMount=mountCampus;
