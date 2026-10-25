import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
const base=new URL('../public/campus/v2/',import.meta.url);
const THREE=await import(new URL('vendor/three-runtime.js',base).href);
const {CampusLabels,moduleLabelScale}=await import(new URL('src/campus-labels.js',base).href);
const {orbitFacingAnchor}=await import(new URL('src/campus-label-anchors.js',base).href);
const {createManagementArea}=await import(new URL('src/campus-management.js',base).href);
const {waveCampusFlag}=await import(new URL('src/campus-motion.js',base).href);

test('badge anchors stay at their world projection instead of scattering to avoid neighbours',()=>{
 const dom=new JSDOM('<div id="map"></div>');const prior=globalThis.document;globalThis.document=dom.window.document;
 try{
  const camera=new THREE.OrthographicCamera(-20,20,20,-20,.1,100);camera.position.set(0,8,25);camera.lookAt(0,2,0);camera.updateMatrixWorld();
  const labels=new CampusLabels(document.querySelector('#map'),camera,()=>{});
  const modules=['reading','listening'].map(id=>({id,name:id,icon:'book',accentHex:'#fff',pos:{x:0,y:0,z:0},labelPos:{x:0,y:3,z:4.6}}));
  labels.initLabels(modules,{});labels.update(600,500);
  const first=labels.labels[0],last=labels.labels[1];
  assert.equal(first.el.style.left,last.el.style.left);assert.equal(first.el.style.top,last.el.style.top);
  const anchor=orbitFacingAnchor(first.anchorPos,first.module,camera.position,new THREE.Vector3(0,0,1));
  const point=new THREE.Vector3(anchor.x,anchor.y,anchor.z).project(camera);
  assert.ok(Math.abs(parseFloat(first.el.style.left)-(point.x*.5+.5)*600)<.01);
 }finally{globalThis.document=prior;dom.window.close();}
});

test('foreground building geometry hides a rear badge and moving it clear restores the badge',()=>{
 const dom=new JSDOM('<div id="map"></div>');const prior=globalThis.document;globalThis.document=dom.window.document;
 try{
  const camera=new THREE.OrthographicCamera(-20,20,20,-20,.1,100);camera.position.set(0,8,25);camera.lookAt(0,3,0);camera.updateMatrixWorld();
  const blocker=new THREE.Mesh(new THREE.BoxGeometry(10,12,4),new THREE.MeshBasicMaterial());blocker.position.set(0,6,12);
  const labels=new CampusLabels(document.querySelector('#map'),camera,()=>{},new Map([['front',blocker]]));
  labels.initLabels([{id:'reading',name:'Reading',accentHex:'#fff',pos:{x:0,y:0,z:0},labelPos:{x:0,y:3,z:0}}],{});
  labels.update(600,500);assert.equal(labels.labels[0].el.style.visibility,'hidden');assert.equal(labels.labels[0].el.tabIndex,-1);
  blocker.position.x=30;labels.nextOcclusion=0;labels.update(600,500);assert.equal(labels.labels[0].el.style.visibility,'visible');
 }finally{globalThis.document=prior;dom.window.close();}
});

test('TED pill shrinks by twenty percent and the other pills by ten percent from the deployed size',()=>{
 assert.ok(Math.abs(moduleLabelScale('video_lessons')/.864-.8)<1e-12);
 assert.ok(Math.abs(moduleLabelScale('reading')/.864-.9)<1e-12);
});

test('central roof is a light rounded cone and the doubled Uzbekistan flag waves while its hoist stays fixed',()=>{
 const {castle}=createManagementArea(),roof=castle.getObjectByName('castle_keep_pitched_roof'),flag=castle.userData.flag;
 assert.ok(roof.geometry.parameters.radialSegments>=32);
 assert.ok(roof.material.color.r>.2&&roof.material.color.b>.4);
 assert.deepEqual(flag.scale.toArray(),[2,2,2]);assert.equal(flag.userData.country,'UZ');
 assert.equal(flag.children.filter((m:typeof THREE.Mesh)=>m.name==='uzbekistan_star').length,12);
 const mesh=flag.children.find((m:typeof THREE.Mesh)=>m.name==='uzbekistan_blue');
 waveCampusFlag(flag,0);const before=mesh.geometry.attributes.position.array.slice();
 waveCampusFlag(flag,1);const after=mesh.geometry.attributes.position.array;
 assert.notDeepEqual(after,before);assert.ok(after.every(Number.isFinite));
 const rest=flag.userData.fabric.find((item:{mesh:typeof THREE.Mesh})=>item.mesh===mesh).rest;
 for(let i=0;i<mesh.geometry.attributes.position.count;i++)if(Math.abs(rest[i*3]+mesh.position.x)<1e-6)assert.equal(after[i*3+2],rest[i*3+2]);
});

test('a roof at a badge edge does not hide its unblocked world anchor',()=>{
 const dom=new JSDOM('<div id="map"></div>');const prior=globalThis.document;globalThis.document=dom.window.document;
 try{
  const camera=new THREE.OrthographicCamera(-20,20,20,-20,.1,100);camera.position.set(0,3,25);camera.lookAt(0,3,0);camera.updateMatrixWorld();
  const blocker=new THREE.Mesh(new THREE.BoxGeometry(1,10,2),new THREE.MeshBasicMaterial());blocker.position.set(2.5,3,12);
  const labels=new CampusLabels(document.querySelector('#map'),camera,()=>{},new Map([['neighbour',blocker]]));labels.initLabels([{id:'reading',name:'Reading',route:'/app/reading',accentHex:'#fff',pos:{x:0,y:0,z:0},labelPos:{x:0,y:3,z:0}}],{});
  labels.update(600,500);assert.equal(labels.labels[0].el.style.visibility,'visible');
  blocker.position.x=0;labels.nextOcclusion=0;labels.update(600,500);assert.equal(labels.labels[0].el.style.visibility,'hidden');
 }finally{globalThis.document=prior;dom.window.close();}
});
test('the taller central roof leaves a visible length of freestanding flagpole below the flag',()=>{
 const {castle}=createManagementArea(),roof=castle.getObjectByName('castle_keep_pitched_roof'),pole=castle.getObjectByName('castle_flagpole'),flag=castle.userData.flag;
 const apex=roof.position.y+roof.geometry.parameters.height/2;
 assert.ok(roof.geometry.parameters.height>12);assert.ok(pole.position.y-pole.geometry.parameters.height/2>=apex-.01);
 assert.ok(flag.position.y-2.5*flag.scale.y>apex+2);
});
