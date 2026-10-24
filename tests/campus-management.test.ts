import assert from "node:assert/strict";
import test from "node:test";

const base = new URL("../public/campus/v2/", import.meta.url);
const THREE = await import(new URL("vendor/three-runtime.js", base).href);
const { CAMPUS_CONFIG } = await import(new URL("src/campus-config.js", base).href);
const { MANAGEMENT_CASTLE, campusSceneConfig } = await import(new URL("src/campus-management.js", base).href);
const { LearnersAreaCampusScene } = await import(new URL("src/campus-scene.js", base).href);
const { CampusMaterials } = await import(new URL("src/campus-materials.js", base).href);
const { CampusGeometry } = await import(new URL("src/campus-geometry.js", base).href);

function world(management: unknown) {
  const init = LearnersAreaCampusScene.prototype.init;
  const load = THREE.TextureLoader.prototype.load;
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  LearnersAreaCampusScene.prototype.init = () => {};
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  globalThis.window = { matchMedia: () => ({ matches: false }) } as unknown as Window & typeof globalThis;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) }) } as unknown as Document;
  try {
    const instance = new LearnersAreaCampusScene({ clientWidth: 1440, clientHeight: 820 }, { management, managementName: "Boshqaruv" });
    instance.scene = new THREE.Scene(); instance.materials = new CampusMaterials(); instance.geometry = new CampusGeometry(instance.materials);
    instance.buildWorld(); instance.scene.updateMatrixWorld(true);
    return instance;
  } finally {
    LearnersAreaCampusScene.prototype.init = init; THREE.TextureLoader.prototype.load = load;
    globalThis.window = previousWindow; globalThis.document = previousDocument;
  }
}

test("the default and denied map contain no management island, castle, label target or changed camera", () => {
  for (const permission of [undefined, false, "true", "student"]) {
    const map = world(permission);
    assert.equal(map.scene.getObjectByName("management_island"), undefined);
    assert.equal(map.buildingMeshes.has("management"), false);
    assert.equal(map.navigationModules.length, 12);
    assert.equal(map.config, CAMPUS_CONFIG);
  }
});

test("the staff castle occupies its own lower island with an open gap and no learning-network entry", () => {
  const map = world(true), castle = map.buildingMeshes.get("management");
  const island = map.scene.getObjectByName("management_island");
  assert.ok(castle && island);
  assert.equal(map.navigationModules.length, 13);
  assert.equal(map.managementModule.name, "Boshqaruv");
  assert.equal(castle.userData.route, "/app/management");
  assert.ok(!CAMPUS_CONFIG.modules.some((m: { id: string }) => m.id === "management"));
  const ground = new THREE.Box3().setFromObject(island), building = new THREE.Box3().setFromObject(castle);
  assert.ok(ground.min.z > Math.max(...CAMPUS_CONFIG.platform.polygon.map((p: number[]) => p[1])) + 10);
  assert.ok(island.position.y < 0);
  assert.ok(building.min.x > ground.min.x && building.max.x < ground.max.x);
  assert.ok(building.min.z > ground.min.z && building.max.z < ground.max.z);
  let turrets = 0; castle.traverse((o: { name: string }) => { if (o.name === "castle_turret") turrets++; });
  assert.equal(turrets, 4);
  assert.ok(castle.getObjectByName("castle_gate"));
});

test("staff camera contains the detached castle and campus at desktop/mobile sizes and four orbit directions", () => {
  const map = world(true), c = campusSceneConfig(true).camera;
  const target = new THREE.Vector3(c.target.x,c.target.y,c.target.z);
  for (const [width,height] of [[1440,820],[390,760]] as const) for (const angle of [Math.PI/4,Math.PI*3/4,Math.PI*5/4,Math.PI*7/4]) {
    const h = Math.max(c.orthoHeight,c.minWorldWidth/(width/height));
    const camera = new THREE.OrthographicCamera(-h*width/height/2,h*width/height/2,h/2,-h/2,c.near,c.far);
    camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle)*130,87.5,Math.cos(angle)*130));
    camera.lookAt(target); camera.updateMatrixWorld();
    map.scene.traverse((mesh: typeof THREE.Mesh) => {
      if (!mesh.isMesh) return;
      const points=mesh.geometry.attributes.position;
      for (let i=0;i<points.count;i++) {
        const p=new THREE.Vector3().fromBufferAttribute(points,i).applyMatrix4(mesh.matrixWorld).project(camera);
        assert.ok(Math.abs(p.x)<1 && Math.abs(p.y)<1, `${mesh.name} clips at ${width} / ${angle}: ${p.toArray()}`);
      }
    });
  }
  assert.notEqual(campusSceneConfig(true).storage.cameraKey,CAMPUS_CONFIG.storage.cameraKey);
  assert.equal(MANAGEMENT_CASTLE.route,"/app/management");
});
