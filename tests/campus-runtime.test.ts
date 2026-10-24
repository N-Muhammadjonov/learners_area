import assert from "node:assert/strict";
import test from "node:test";

const src=new URL("../public/campus/v2/src/",import.meta.url);
const THREE=await import(new URL("../vendor/three-runtime.js",src).href);
const {CampusGeometry}=await import(new URL("campus-geometry.js",src).href);
const {CampusMaterials}=await import(new URL("campus-materials.js",src).href);
const {CAMPUS_CONFIG}=await import(new URL("campus-config.js",src).href);
const {orbitFacingAnchor}=await import(new URL("campus-label-anchors.js",src).href);
const {CampusCameraController}=await import(new URL("campus-camera.js",src).href);
const {campusRoadPath,CampusCircuits}=await import(new URL("campus-circuits.js",src).href);

const {LearnersAreaCampusScene}=await import(new URL("campus-scene.js",src).href);
const {NeonCurrent,NeonDashLoop,platformEdgeLoops}=await import(new URL("campus-neon.js",src).href);
const {setBuildingHover,updateCampusObjects,resolveReducedMotion}=await import(new URL("campus-motion.js",src).href);
test("explicit campus animation remains active even when the system automatic mode reduces motion",()=>{
  assert.equal(resolveReducedMotion("on",true),false);
  assert.equal(resolveReducedMotion("auto",true),true);
  assert.equal(resolveReducedMotion(undefined,false),false);
  assert.equal(resolveReducedMotion("off",false),true);
});
function buildWorld(){
  const load=THREE.TextureLoader.prototype.load,doc=globalThis.document;
  THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
  globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({fillRect(){},strokeRect(){},fillText(){}})})} as unknown as Document;
  try{
    const w=Object.create(LearnersAreaCampusScene.prototype);
    w.scene=new THREE.Scene();w.materials=new CampusMaterials();w.geometry=new CampusGeometry(w.materials);w.buildingMeshes=new Map();
    w.buildWorld();w.scene.updateMatrixWorld(true);return w;
  }finally{THREE.TextureLoader.prototype.load=load;globalThis.document=doc;}
}
const world=buildWorld();
function initialCamera(){
  const c=CAMPUS_CONFIG.camera,h=Math.max(c.orthoHeight,c.minWorldWidth/(1678/873));
  const camera=new THREE.OrthographicCamera(-h*1678/873/2,h*1678/873/2,h/2,-h/2,c.near,c.far);
  camera.position.set(c.position.x,c.position.y,c.position.z);camera.lookAt(c.target.x,c.target.y,c.target.z);camera.updateMatrixWorld();return camera;
}
function projectedBounds(group:typeof THREE.Group,camera:typeof THREE.Camera){
  const bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};group.updateMatrixWorld(true);
  group.traverse((mesh:{isMesh:boolean;geometry:{attributes:{position:{count:number}}};matrixWorld:unknown})=>{
    if(!mesh.isMesh)return;const a=mesh.geometry.attributes.position;
    for(let i=0;i<a.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).project(camera);
      const x=(p.x+1)*839,y=(1-p.y)*873/2;
      bounds.left=Math.min(bounds.left,x);bounds.right=Math.max(bounds.right,x);bounds.top=Math.min(bounds.top,y);bounds.bottom=Math.max(bounds.bottom,y);
    }
  });return bounds;
}
test("every pavilion has a continuous raised electrical route and Live classes bypasses Assignments",()=>{
  for(const m of CAMPUS_CONFIG.modules.filter((m:{isCenter?:boolean})=>!m.isCenter)){
    const {points}=campusRoadPath(m);assert.equal(points.at(-1)[0],m.pos.x);assert.equal(points.at(-1)[2],m.pos.z);
    for(let i=1;i<points.length;i++){
      const [a,b]=[points[i-1],points[i]];assert.ok(a[1]>.2);assert.ok(a[0]===b[0]||a[2]===b[2]);
      if(m.id==="live_classes"){
        const box=new THREE.Box3().setFromObject(world.buildingMeshes.get("assignments"));
        const x=Math.max(a[0],b[0])>box.min.x&&Math.min(a[0],b[0])<box.max.x;
        const z=Math.max(a[2],b[2])>box.min.z&&Math.min(a[2],b[2])<box.max.z;assert.ok(!(x&&z));
      }
    }
  }
});
test("all separate pavilion footprints fit within the rectangular slab, without a Live support extension",()=>{
  const polygon=CAMPUS_CONFIG.platform.polygon;assert.equal(polygon.length,4);
  const xs=polygon.map((p:number[])=>p[0]),zs=polygon.map((p:number[])=>p[1]);assert.equal(new Set(xs).size,2);assert.equal(new Set(zs).size,2);
  const previous:{id:string;box:typeof THREE.Box3}[]=[];
  for(const m of CAMPUS_CONFIG.modules.filter((m:{isCenter?:boolean})=>!m.isCenter)){
    const box=new THREE.Box3().setFromObject(world.buildingMeshes.get(m.id));
    assert.ok(box.min.x>Math.min(...xs)&&box.max.x<Math.max(...xs)&&box.min.z>Math.min(...zs)&&box.max.z<Math.max(...zs),m.id);
    for(const p of previous){const dx=Math.max(0,box.min.x-p.box.max.x,p.box.min.x-box.max.x),dz=Math.max(0,box.min.z-p.box.max.z,p.box.min.z-box.max.z);assert.ok(Math.hypot(dx,dz)>2,`${m.id} too close to ${p.id}`);}
    previous.push({id:m.id,box});
  }
  assert.equal(world.scene.getObjectByName("live_classes_support_dock"),undefined);
});
// Rasterize actual opaque triangle silhouettes; a bounding rectangle includes
// empty space around an isometric roof and can falsely report an occlusion.
function projectedSilhouette(group:typeof THREE.Group,camera:typeof THREE.Camera){
  const width=1678,height=873,mask=new Uint8Array(width*height);
  type P={x:number;y:number};
  const cross=(a:P,b:P,x:number,y:number)=>(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
  group.updateMatrixWorld(true);
  group.traverse((mesh:typeof THREE.Mesh)=>{
    if(!mesh.isMesh)return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(materials.every((m:typeof THREE.Material)=>m.transparent&&m.opacity<.5))return;
    const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,vertices:P[]=[];
    for(let i=0;i<pos.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).project(camera);
      vertices.push({x:(p.x+1)*width/2,y:(1-p.y)*height/2});
    }
    for(let i=0;i<(index?index.count:pos.count);i+=3){
      const a=vertices[index?index.getX(i):i],b=vertices[index?index.getX(i+1):i+1],c=vertices[index?index.getX(i+2):i+2];
      assert.ok(a&&b&&c,'every triangle index resolves to a projected vertex');
      const area=cross(a,b,c.x,c.y);if(Math.abs(area)<1e-6)continue;
      const sign=Math.sign(area);
      const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
      const y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        if(cross(a,b,x+.5,y+.5)*sign>=0&&cross(b,c,x+.5,y+.5)*sign>=0&&cross(c,a,x+.5,y+.5)*sign>=0)mask[y*width+x]=1;
      }
    }
  });return mask;
}
test("the initial view contains every enlarged landmark and opaque building silhouettes never overlap",()=>{
  const camera=initialCamera(),owners=new Uint16Array(1678*873),ids:string[]=[];
  updateCampusObjects(world.buildingMeshes,camera,0,0);
  for(const m of CAMPUS_CONFIG.modules.filter((m:{isCenter?:boolean})=>!m.isCenter)){
    const building=world.buildingMeshes.get(m.id),b=projectedBounds(building,camera);
    assert.ok(b.left>=0&&b.right<=1678&&b.top>=0&&b.bottom<=873,`${m.id} clipped: ${JSON.stringify(b)}`);
    const mask=projectedSilhouette(building,camera),conflicts=new Set<string>();
    for(let i=0;i<mask.length;i++)if(mask[i]){
      const previous=owners[i]??0;
      ids.forEach((id,j)=>{if(previous&(1<<j))conflicts.add(id);});
      owners[i]=previous|(1<<ids.length);
    }
    assert.deepEqual([...conflicts],[],`${m.id} obscures another building`);ids.push(m.id);
  }
});
test("all eleven pavilions grow a further ten percent without changing proportions, with Assignments at the outer corner",()=>{
  for(const m of CAMPUS_CONFIG.modules.filter((m:{isCenter?:boolean})=>!m.isCenter)){
    const scale=world.buildingMeshes.get(m.id).userData.restingScale;
    const previousHorizontal=1.22*(m.id==='live_classes'?1.12:1.32);
    assert.ok(Math.abs(scale.x/previousHorizontal-1.11*1.1)<1e-10,m.id);
    assert.ok(Math.abs(scale.z/previousHorizontal-1.11*1.1)<1e-10,m.id);
    assert.ok(Math.abs(scale.y/(1.22*CAMPUS_CONFIG.architecture.heights[m.id])-1.11*1.1)<1e-10,m.id);
  }
  const a=world.buildingMeshes.get('assignments').position,l=world.buildingMeshes.get('live_classes').position;
  assert.ok(a.length()>75);assert.ok(a.distanceTo(l)<35);assert.ok(a.x>45&&a.z<-50);
  const rocket=world.buildingMeshes.get('dashboard').userData.rocket;
  assert.deepEqual(rocket.scale.toArray(),[1.1,1.1,1.1]);
});
test("Listening headphones and the enlarged assignment board clear their roofs, with a slightly upright white book",()=>{
  const hp=world.buildingMeshes.get('listening').userData.landmark;
  const box=new THREE.Box3().setFromObject(hp);
  assert.ok(box.min.y>7.1*world.buildingMeshes.get('listening').scale.y);
  const assignment=world.buildingMeshes.get('assignments'),board=assignment.userData.landmark;
  assert.ok(new THREE.Box3().setFromObject(board).min.y>5.8*assignment.scale.y);
  const book=world.buildingMeshes.get('reading').userData.landmark;
  assert.ok(book.rotation.x>.1&&book.rotation.x<.22);
  const paper=world.materials.materials.get('book_paper');assert.ok(paper.color.r>.98&&paper.color.g>.96&&paper.color.b>.94);assert.ok(paper.emissiveIntensity>=.2);
});
test("all genuine 3D landmarks face four camera azimuths and ABC never reverses",()=>{
  const camera=initialCamera();
  for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
    camera.position.set(Math.sin(angle)*140,90,Math.cos(angle)*140);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    updateCampusObjects(world.buildingMeshes,camera,0,0);world.scene.updateMatrixWorld(true);
    for(const [id,building] of world.buildingMeshes){
      if(id==='dashboard')continue;const landmark=building.userData.landmark;assert.ok(landmark,id);
      const front=new THREE.Vector3(0,0,1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(landmark.matrixWorld));front.y=0;front.normalize();
      const expected=camera.getWorldDirection(new THREE.Vector3()).negate();expected.y=0;expected.normalize();assert.ok(front.dot(expected)>.999,`${id} reversed`);
    }
    const blocks=world.buildingMeshes.get('vocabulary').userData.landmark;
    const b=blocks.children[1].getWorldPosition(new THREE.Vector3()).project(camera),c=blocks.children[2].getWorldPosition(new THREE.Vector3()).project(camera);assert.ok(b.x<c.x);
  }
});
test("the restored rocket rotates below the single official LA emblem",()=>{
  const dashboard=world.buildingMeshes.get('dashboard'),rocket=dashboard.userData.rocket,logo=dashboard.userData.logo,camera=initialCamera();assert.ok(rocket?.isGroup);
  updateCampusObjects(world.buildingMeshes,camera,0,0);const first=rocket.rotation.y;updateCampusObjects(world.buildingMeshes,camera,0,2);assert.ok(Math.abs(rocket.rotation.y-first)>.5);
  const box=new THREE.Box3().setFromObject(rocket);assert.ok((logo.position.y-logo.scale.y/2+logo.scale.y*(23/192))*dashboard.scale.y>box.max.y);
  let count=0;dashboard.traverse((o:{isSprite:boolean})=>{if(o.isSprite)count++;});assert.equal(count,1);
});
test("building hover smoothly grows the actual model and restores its original proportions",()=>{
  const b=world.buildingMeshes.get('speaking'),base=b.userData.restingScale.clone(),camera=initialCamera();setBuildingHover(world.buildingMeshes,'speaking',true);updateCampusObjects(world.buildingMeshes,camera,1,1);
  assert.ok(b.scale.x/base.x>1.06&&b.scale.x/base.x<1.07);setBuildingHover(world.buildingMeshes,'speaking',false);updateCampusObjects(world.buildingMeshes,camera,2,3);assert.ok(b.scale.distanceTo(base)<1e-7);
});
test("side neon clears the bevel and volumetric currents advance with finite instance geometry",()=>{
  const slab=world.scene.getObjectByName('platform_root').children[0].geometry;slab.computeBoundingBox();
  for(const loop of platformEdgeLoops(CAMPUS_CONFIG)){
    assert.ok(loop[0][0]<slab.boundingBox.min.x&&loop[1][0]>slab.boundingBox.max.x);assert.ok(loop[0][2]<slab.boundingBox.min.z&&loop[2][2]>slab.boundingBox.max.z);
    assert.ok(loop[0][1]<0&&loop[0][1]>-CAMPUS_CONFIG.platform.height);
    const current=new NeonCurrent(loop,0x00bbff,{speed:23,phase:.1,loop:true}),first=current.head.position.clone();current.update(2);assert.ok(current.head.position.distanceTo(first)>5);
    assert.equal(current.trail.geometry.type,'CylinderGeometry');assert.equal(current.trail.frustumCulled,false);assert.ok(current.trail.instanceMatrix.array.every(Number.isFinite));
  }
});

test("two independent LED chase rows retain their gaps above the steady bottom rim",()=>{
  const doc=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})} as unknown as Document;
  try{
    const scene=new THREE.Scene(),circuits=new CampusCircuits(scene,world.materials);
    circuits.buildPlatformNetwork(CAMPUS_CONFIG);
    assert.equal(circuits.sideLoops.length,2);
    assert.ok(circuits.sideLoops[0].speed>0&&circuits.sideLoops[1].speed<0);
    for(const leds of circuits.sideLoops){
      const fixed=leds.core.instanceMatrix.array.slice(),before=leds.strengths.slice();
      const matrix=new THREE.Matrix4();leds.core.getMatrixAt(0,matrix);
      const dashLength=new THREE.Vector3().setFromMatrixScale(matrix).y;
      assert.ok(leds.centers[1]-leds.centers[0]>dashLength,'real dark gaps between separate LEDs');
      leds.update(2);assert.notDeepEqual(leds.strengths,before);assert.deepEqual(leds.core.instanceMatrix.array,fixed);
    }
    const bottom=circuits.lowerRim.children.map((o:typeof THREE.Group)=>o.clone());
    circuits.update(.1,4);assert.equal(circuits.lowerRim.children.length,bottom.length);
  }finally{globalThis.document=doc;}
});
test("Dashboard radial dashes and ring bulbs both orbit instead of remaining fixed",()=>{
  const doc=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})} as unknown as Document;
  let circuits;
  try{circuits=new CampusCircuits(new THREE.Scene(),world.materials);circuits.createDashboardRingPulses();circuits.createGroundRingLights();}
  finally{globalThis.document=doc;}
  const camera=initialCamera(),dashboard=world.buildingMeshes.get('dashboard');
  updateCampusObjects(world.buildingMeshes,camera,0,0);circuits.update(0,0);
  const dash=dashboard.userData.dashes.children[0],bulb=circuits.ringBulbs[0].point;
  const a=dash.getWorldPosition(new THREE.Vector3()),b=bulb.getWorldPosition(new THREE.Vector3());
  updateCampusObjects(world.buildingMeshes,camera,2,2);circuits.update(2,2);
  assert.ok(dash.getWorldPosition(new THREE.Vector3()).distanceTo(a)>3);
  assert.ok(bulb.getWorldPosition(new THREE.Vector3()).distanceTo(b)>3);
  assert.ok(Math.abs(dashboard.userData.rings.rotation.y-circuits.dashboardRings.rotation.y)<1e-10);
});

function buildCircuits(){
  const doc=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})} as unknown as Document;
  try{
    const circuits=new CampusCircuits(new THREE.Scene(),world.materials);
    circuits.buildCircuitNetwork(CAMPUS_CONFIG.modules);circuits.buildPlatformNetwork(CAMPUS_CONFIG);return circuits;
  }finally{globalThis.document=doc;}
}
test("ground routes have identical guide brightness and each carries red, white and blue currents",()=>{
  const circuits=buildCircuits();assert.equal(circuits.branches.length,11);
  const writing=circuits.branches.find((b:{id:string})=>b.id==='writing').guide.children[0].children[0].material;
  for(const branch of circuits.branches){
    for(const tube of branch.guide.children){
      const core=tube.children[0];assert.ok(core.material.color.equals(writing.color));
      assert.equal(core.geometry.parameters.radiusTop,.115);
    }
    assert.deepEqual(branch.currents.map((c:typeof NeonCurrent)=>c.group.userData.color),[0xff405b,0xf4fbff,0x42bfff]);
    for(const current of branch.currents){const before=current.head.position.clone();current.update(1);assert.ok(current.head.position.distanceTo(before)>1);}
  }
});
test("road neon radiance is exactly five percent lower and remains independent of camera azimuth",()=>{
  const circuits=buildCircuits(),writing=circuits.branches.find((b:{id:string})=>b.id==='writing');
  const ratio=(actual:typeof THREE.Color,previous:typeof THREE.Color)=>{
    for(const channel of ['r','g','b'])assert.ok(Math.abs(actual[channel]/previous[channel]-.95)<1e-12);
  };
  ratio(writing.guide.children[0].children[0].material.color,new THREE.Color(0x32bfff).multiplyScalar(4.2));
  ratio(writing.guide.children[0].children[1].material.color,new THREE.Color(0x32bfff).multiplyScalar(1.5));
  for(const [i,power] of [6,2.6,4.5].entries()){
    const current=writing.currents[i],base=new THREE.Color(current.group.userData.color);
    ratio(current.trail.material.color,base.clone().multiplyScalar(power));
    ratio(current.head.material.color,base.clone().multiplyScalar(power*1.1));
  }
  const before=writing.guide.children[0].children[0].material.color.clone(),camera=initialCamera();
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
    camera.position.set(Math.sin(angle)*140,90,Math.cos(angle)*140);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    updateCampusObjects(world.buildingMeshes,camera,0,3);circuits.update(0,3);
    for(const branch of circuits.branches)for(const tube of branch.guide.children){
      assert.equal(tube.children[0].material.type,'MeshBasicMaterial');assert.ok(tube.children[0].material.color.equals(before));
      assert.equal(tube.children[0].geometry.parameters.radialSegments,16);
    }
  }
});
test("the bottom perimeter is continuous below both LED rows and never blinks with the chases",()=>{
  const circuits=buildCircuits(),rim=circuits.lowerRim;assert.equal(rim.name,'platform_lower_continuous_rim');assert.equal(rim.children.length,4);
  const box=new THREE.Box3();rim.children.forEach((tube:typeof THREE.Group)=>box.union(new THREE.Box3().setFromObject(tube.children[0])));
  assert.ok(box.max.y<-3.55&&box.min.y>-CAMPUS_CONFIG.platform.height);
  const colors=rim.children.map((tube:typeof THREE.Group)=>tube.children[0].material.color.clone());
  circuits.update(2,2);
  rim.children.forEach((tube:typeof THREE.Group,i:number)=>{assert.ok(tube.children[0].material.color.equals(colors[i]));assert.equal(tube.children[0].material.opacity,1);});
});
test("environment contains eight low processor panels and power components, without desktop computers",()=>{
  const components:typeof THREE.Group[]=[];world.scene.traverse((o:typeof THREE.Object3D)=>{if(o.name==='campus_system_components')components.push(o);});
  assert.equal(components.length,8);assert.equal(world.scene.getObjectByName('campus_computer_terminal'),undefined);
  assert.ok(components.some(c=>c.getObjectByName('processor_chip')));assert.ok(components.some(c=>c.getObjectByName('power_stack')));
  for(const component of components){
    const box=new THREE.Box3().setFromObject(component);assert.ok(box.max.y-box.min.y<4,'embedded low-profile equipment');
    assert.ok(box.min.x>-65&&box.max.x<65&&box.min.z>-73&&box.max.z<65,'every component stays on the slab');
    assert.ok(component.getObjectByName('component_vent'));
  }
});

test("platform top cannot bury the asphalt and its configured thickness is respected",()=>{
  const materials=new Map(["platform_slab","asphalt","platform_rim"].map(k=>[k,new THREE.MeshBasicMaterial()]));
  const platform=new CampusGeometry({materials}).createPlatform(CAMPUS_CONFIG);
  const slab=platform.children[0].geometry;
  slab.computeBoundingBox();
  assert.ok(Math.abs(slab.boundingBox.max.y)<1e-5);
  assert.ok(Math.abs(slab.boundingBox.min.y+CAMPUS_CONFIG.platform.height)<1e-5);
  platform.children[1].geometry.computeBoundingBox();
  assert.ok(platform.children[1].geometry.boundingBox.min.y>slab.boundingBox.max.y);
});

test("labels follow the visible facade on all four orthographic sides, including Dashboard",()=>{
  const pavilion={pos:{x:25,y:0,z:-42}};
  const anchor={x:27.5,y:4.7,z:-39.5};
  const footprint={halfWidth:8,halfDepth:6};
  for(const [x,z] of [[1,0],[0,-1],[-1,0],[0,1]]){
    const p=orbitFacingAnchor(anchor,pavilion,{x:93,z:93},{x,z},footprint);
    assert.equal(p.y,anchor.y);
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));
    if(x)assert.ok((p.x-pavilion.pos.x)*x>=footprint.halfWidth);
    if(z)assert.ok((p.z-pavilion.pos.z)*z>=footprint.halfDepth);
  }
  const dashboard={pos:{x:0,y:0,z:0},isCenter:true};
  const p=orbitFacingAnchor({x:5.8,y:1.6,z:6.9},dashboard,{x:93,z:93},{x:0,z:-1});
  assert.ok(p.z<0);
  assert.equal(p.y,1.6);
});

test("trackpad cross-axis noise cannot mix orbit and zoom within a gesture",()=>{
  const controller=Object.create(CampusCameraController.prototype);
  controller.camera=new THREE.OrthographicCamera(-50,50,30,-30,.1,1000);
  controller.camera.position.set(93,60,93);
  controller.domElement={clientHeight:600};
  controller.controls={target:new THREE.Vector3(),minZoom:.65,maxZoom:2.6,
    minPolarAngle:Math.PI/6,maxPolarAngle:Math.PI/2.3,enableDamping:true,
    update:()=>controller.camera.lookAt(0,0,0)};
  const wheel=(deltaX:number,deltaY:number,ctrlKey=false)=>controller.handleWheel({
    deltaX,deltaY,deltaMode:0,ctrlKey,preventDefault(){},stopImmediatePropagation(){}
  });
  try{
    const start=controller.camera.position.clone();
    wheel(30,.7);
    assert.equal(controller.camera.zoom,1);
    assert.ok(controller.camera.position.distanceTo(start)>.1);
    wheel(.2,2);
    assert.equal(controller.camera.zoom,1);
    controller.lastWheelTime=-Infinity;
    const beforeZoom=controller.camera.position.clone();
    wheel(.8,40);
    assert.ok(controller.camera.zoom<1);
    assert.ok(controller.camera.position.distanceTo(beforeZoom)<1e-8);
    wheel(30,.1);
    assert.ok(controller.camera.position.distanceTo(beforeZoom)<1e-8);
  }finally{clearTimeout(controller.pendingSave);}
});


