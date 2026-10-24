/**
 * Learners Area 3D Campus Master Scene Orchestrator - Calibrated High-Fidelity
 */

import * as THREE from '../vendor/three-runtime.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from '../vendor/three-runtime.js';
import { CAMPUS_CONFIG } from './campus-config.js';
import { CampusMaterials } from './campus-materials.js';
import { CampusGeometry } from './campus-geometry.js';
import { CampusCircuits } from './campus-circuits.js';
import {setBuildingHover,updateCampusObjects,resolveReducedMotion} from './campus-motion.js';
import { CampusLabels } from './campus-labels.js';
import { CampusCameraController } from './campus-camera.js';
import { MANAGEMENT_CASTLE, campusSceneConfig, createManagementArea } from './campus-management.js';

export class LearnersAreaCampusScene {
  constructor(canvasContainer, options = {}) {
    this.container = canvasContainer;
    this.options = options;
    this.onNavigate = options.onNavigate || (() => {});
    this.managementModule = options.management === true
      ? { ...MANAGEMENT_CASTLE, name: options.managementName || MANAGEMENT_CASTLE.name } : null;
    this.navigationModules = this.managementModule ? [...CAMPUS_CONFIG.modules, this.managementModule] : CAMPUS_CONFIG.modules;
    this.config = campusSceneConfig(Boolean(this.managementModule));

    this.width = this.container.clientWidth || 1024;
    this.height = this.container.clientHeight || 571;
    this.isPaused = false;
    const systemReducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    // An explicit campus motion choice wins over the automatic system default.
    this.reducedMotion=resolveReducedMotion(options.motion,systemReducedMotion);
    this.buildingMeshes = new Map();

    this.init();
  }

  init() {
    // 1. Scene with Exact Radial Vignette Background Texture
    this.scene = new THREE.Scene();
    this.setupBackgroundTexture();

    // 2. Camera (Exact Isometric composition matching reference view)
    const aspect = this.width / this.height;
    // Actual 3D island with reference-style isometric orthographic framing.
    const config = this.config;
    const viewH=Math.max(config.camera.orthoHeight,config.camera.minWorldWidth/aspect);
    const viewW=viewH*aspect;
    this.camera = new THREE.OrthographicCamera(
      -viewW/2, viewW/2, viewH/2, -viewH/2,
      config.camera.near, config.camera.far
    );
    this.camera.position.set(
      config.camera.position.x,
      config.camera.position.y,
      config.camera.position.z
    );

    // 3. WebGL Renderer with High-DPI & ACESFilmic Tone Mapping
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.shadowMap.needsUpdate=true;
    this.container.appendChild(this.renderer.domElement);
    // Canvas antialiasing does not reach offscreen postprocessing targets.
    // Multisample the scene before bloom so thin neon does not become stippled
    // at shallow or rotated camera angles.
    const target=new THREE.WebGLRenderTarget(this.width,this.height,{
      type:THREE.HalfFloatType,samples:Math.min(4,this.renderer.capabilities.maxSamples),
      depthBuffer:true,stencilBuffer:false,
    });
    this.composer=new EffectComposer(this.renderer,target);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.bloom=new UnrealBloomPass(new THREE.Vector2(this.width,this.height),.24,.18,1.25);
    this.composer.addPass(this.bloom);
    this.outputPass=new OutputPass();
    this.composer.addPass(this.outputPass);

    // 4. Materials & Geometry
    this.materials = new CampusMaterials();
    this.geometry = new CampusGeometry(this.materials);

    // 5. Lighting
    this.setupLighting();

    // 6. Build Platform & Architecture
    this.buildWorld();

    // 7. Circuits & Electrical Pathways
    this.circuits = new CampusCircuits(this.scene, this.materials);
    this.circuits.buildCircuitNetwork(CAMPUS_CONFIG.modules);
    this.circuits.buildPlatformNetwork(CAMPUS_CONFIG);
    for(const module of CAMPUS_CONFIG.modules)if(!module.isCenter)this.circuits.addFoundationCurrent(this.buildingMeshes.get(module.id),module);
    for(const lamp of this.streetLamps){
      const halo=this.circuits.addHalo(0xffdb78,4.8,.15);
      halo.position.set(lamp.position.x,.065,lamp.position.z);
      lamp.userData.halo=halo;
    }
    // Reference: each illuminated module sits on a soft, colored patch of
    // pavement. The glow is a flat decal on the actual street, not a particle.
    this.foundationGlows = [];
    for (const module of CAMPUS_CONFIG.modules) {
      if (module.isCenter) continue;
      const glow = this.circuits.addHalo(module.color, 19, 0.18);
      glow.position.set(module.pos.x, 0.061, module.pos.z);
      this.foundationGlows.push(glow);
    }
    const dashboardGlow=this.circuits.addHalo(0x16d9ff, 32, .16);
    dashboardGlow.position.set(0,.059,0);
    this.foundationGlows.push(dashboardGlow);

    // 8. Interactive Labels Overlay
    this.labels = new CampusLabels(this.container, this.camera, this.onNavigate);
    this.loadIconsAndInitLabels();
    for(const label of this.labels.labels){
      const building=this.buildingMeshes.get(label.module.id);
      if(!building)continue;
      const box=new THREE.Box3().setFromObject(building);
      label.footprint={halfWidth:(box.max.x-box.min.x)/2,halfDepth:(box.max.z-box.min.z)/2};
    }

    // 9. Camera Controls with state persistence
    this.cameraController = new CampusCameraController(this.camera, this.renderer.domElement, config);

    // 10. Raycasting for 3D clicks & hover
    this.setupRaycasting();

    // 11. Lifecycle & Listeners
    this.setupEventListeners();

    // 12. Clock & Start Loop
    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    this.animId = requestAnimationFrame(this.animate);
  }

  setupBackgroundTexture() {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 512;
    bgCanvas.height = 512;
    const ctx = bgCanvas.getContext('2d');

    const grad = ctx.createRadialGradient(256, 190, 20, 256, 256, 360);
    grad.addColorStop(0.0, '#122443');
    grad.addColorStop(0.35, '#0c1b34');
    grad.addColorStop(0.7, '#08152a');
    grad.addColorStop(1.0, '#061126');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const bgTexture = new THREE.CanvasTexture(bgCanvas);
    bgTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bgTexture;
  }

  setupLighting() {
    // Ambient Light (deep navy night sky fill)
    const ambientLight = new THREE.AmbientLight(0x1a2c4a, 1.4);
    this.scene.add(ambientLight);

    // Directional Isometric Sun (soft daylight from top-right)
    const dirLight = new THREE.DirectionalLight(0xfff8e7, 1.5);
    dirLight.position.set(65, 95, 65);
    dirLight.castShadow=true;
    dirLight.shadow.mapSize.set(2048,2048);
    const shadowExtent=this.managementModule?150:95;
    Object.assign(dirLight.shadow.camera,{left:-shadowExtent,right:shadowExtent,top:shadowExtent,bottom:-shadowExtent,near:1,far:this.managementModule?300:250});
    dirLight.shadow.camera.updateProjectionMatrix();
    dirLight.shadow.bias=-.00015;
    dirLight.shadow.normalBias=.04;
    this.scene.add(dirLight);

    // Back / Rim Light with vibrant cyan tint
    const rimLight = new THREE.DirectionalLight(0x00bfff, .55);
    rimLight.position.set(-60, 50, -60);
    this.scene.add(rimLight);
  }

  buildWorld() {
    // 1. Platform Slab
    const platform = this.geometry.createPlatform(CAMPUS_CONFIG);
    this.scene.add(platform);

    // 2. All 11 Buildings + Dashboard + Localized Foundation Lights
    for (const m of CAMPUS_CONFIG.modules) {
      let bldgGroup;
      switch (m.id) {
        case 'dashboard':
          bldgGroup = this.geometry.createDashboard(m);
          break;
        case 'reading':
          bldgGroup = this.geometry.createReading(m);
          break;
        case 'listening':
          bldgGroup = this.geometry.createListening(m);
          break;
        case 'writing':
          bldgGroup = this.geometry.createWriting(m);
          break;
        case 'speaking':
          bldgGroup = this.geometry.createSpeaking(m);
          break;
        case 'grammar':
          bldgGroup = this.geometry.createGrammar(m);
          break;
        case 'vocabulary':
          bldgGroup = this.geometry.createVocabulary(m);
          break;
        case 'progress':
          bldgGroup = this.geometry.createProgress(m);
          break;
        case 'mocks':
          bldgGroup = this.geometry.createMockTests(m);
          break;
        case 'assignments':
          bldgGroup = this.geometry.createAssignments(m);
          break;
        case 'live_classes':
          bldgGroup = this.geometry.createLiveClasses(m);
          break;
        case 'video_lessons':
          bldgGroup = this.geometry.createTedPodcast(m);
          break;
        default:
          break;
      }

      if (bldgGroup) {
        if(!m.isCenter)this.scene.add(this.geometry.createBuildingLot(m));
        if(!m.isCenter)this.geometry.addFacadeIllumination(bldgGroup,m);
        if(!m.isCenter){
          // Taller, wider real architecture while leaving more distance between modules.
          // More architectural presence relative to the asphalt, as in the approved map.
          const {scale,heights}=CAMPUS_CONFIG.architecture;
          const horizontal=(m.id==='live_classes'?1.12:1.32)*scale;
          bldgGroup.scale.set(horizontal,(heights[m.id]||1.4)*scale,horizontal);
        }
        bldgGroup.userData.restingScale=bldgGroup.scale.clone();
        this.geometry.finishArchitecture(bldgGroup);
        this.scene.add(bldgGroup);
        this.buildingMeshes.set(m.id, bldgGroup);

        // Localized point light casting colored glow onto nearby asphalt
        const fLight = new THREE.PointLight(m.color, m.isCenter ? 3.7 : 2.65, m.isCenter ? 40 : 25, 1.5);
        fLight.position.set(m.pos.x, 1.2, m.pos.z);
        this.scene.add(fLight);
      }
    }

    if (this.managementModule) {
      const { island, castle } = createManagementArea(this.managementModule);
      this.geometry.finishArchitecture(castle);
      this.scene.add(island, castle);
      this.buildingMeshes.set(this.managementModule.id, castle);
    }

    // 3. Environmental Objects (Trees, Benches, Streetlights)
    this.populateEnvironment();
  }

  populateEnvironment() {
    const envGroup = new THREE.Group();
    this.streetLamps=[];
    envGroup.name = 'environment_props';

    // Low-poly pine trees along perimeter and paths
    const treePositions = [
      [-38, -20], [-40, -14], [-38, -4], [-40, 6], [-38, 20], [-30, 28], [-22, 34],
      [-12, 38], [-3, 38], [12, 37], [20, 34], [30, 28],
      [38, 20], [40, 14], [39, -2], [40, -20], [34, -28], [26, -35],
      [-18, -36], [-10, -38], [5, -38], [12, -34],
      [-14, -8], [-9, 14], [14, 14], [9, -15],
    ];

    treePositions.forEach(([x, z], idx) => {
      // Never place foliage through one of the resized buildings.
      if(CAMPUS_CONFIG.modules.some(m=>!m.isCenter&&Math.hypot(m.pos.x-x,m.pos.z-z)<13))return;
      const tree = this.geometry.createPineTree(0.9 + (idx % 3) * 0.15);
      tree.position.set(x, 0.05, z);
      envGroup.add(tree);
    });

    // Street lamp posts with warm golden/white globes
    const lampPositions = [
      [-12, -13.5], [-20, -9.5], [-20, 0], [-16.5, 9.5], [4.0, 13.5],
      [16.0, 9.5], [24.0, 0], [22.0, -7.0], [17.5, -9.5], [17.5, -11.5], [-3.5, -13.5]
    ];

    lampPositions.forEach(([x, z],index) => {
      if(CAMPUS_CONFIG.modules.some(m=>!m.isCenter&&Math.hypot(m.pos.x-x,m.pos.z-z)<8.0))return;
      const lamp = this.geometry.createStreetLamp(0.9,index*.65);
      lamp.position.set(x, 0.05, z);
      envGroup.add(lamp);
      this.streetLamps.push(lamp);
    });

    // Modern park benches
    const benchPositions = [
      { pos: [-23.21, .62], rot: Math.PI / 4 },
      { pos: [13.98,31.58], rot: Math.PI / 4 },
      { pos: [20.36,12.91], rot: Math.PI / 4 },
      { pos: [6.1,-36.79], rot: Math.PI / 4 },
      { pos: [-6.7,48.91], rot: Math.PI / 4 },
    ];

    benchPositions.forEach(b => {
      const bench = this.geometry.createBench(0.95);
      bench.position.set(b.pos[0], 0.05, b.pos[1]);
      bench.rotation.y = b.rot;
      envGroup.add(bench);
    });

    for(const [index,[x,z]] of [[-57,52],[-30,-17],[27,16],[30,-32],[-5,62],[-38,-62],[-42,57],[55,18]].entries()){
      const components=this.geometry.createSystemComponents(index%2?'power':'processor');
      components.position.set(x,.05,z);components.scale.setScalar(1.15);
      this.geometry.finishArchitecture(components);envGroup.add(components);
    }

    this.scene.add(envGroup);
  }

  loadIconsAndInitLabels() {
    const iconSvgs = {
      dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      reading: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      listening: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
      writing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
      speaking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
      grammar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>`,
      vocabulary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 17l4-10 4 10"/><line x1="9.5" y1="13" x2="14.5" y2="13"/></svg>`,
      progress: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
      mock_tests: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
      assignments: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14h6M9 10h6M9 18h4"/></svg>`,
      ted_podcast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="4"/><polygon points="10 9 16 12 10 15 10 9" fill="currentColor"/></svg>`,
      live_classes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    };

    iconSvgs.management = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 21V4h4v4h3V3h4v5h3V4h4v17H3Z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/></svg>`;
    this.labels.initLabels(this.navigationModules || CAMPUS_CONFIG.modules, iconSvgs);
  }

  setupRaycasting() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    const getIntersectedModule = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects([...this.buildingMeshes.values()], true);

      for (const hit of intersects) {
        let cur = hit.object;
        while (cur && cur !== this.scene) {
          if (cur.userData && cur.userData.id) {
            return cur.userData;
          }
          cur = cur.parent;
        }
      }
      return null;
    };

    // Prevent OrbitControls dragging from accidentally opening a building.
    this.pointerStart=null;
    this.onPointerDown=(e)=>{this.pointerStart={x:e.clientX,y:e.clientY};};
    this.onClick=(e)=>{
      if(!this.pointerStart || Math.hypot(e.clientX-this.pointerStart.x,e.clientY-this.pointerStart.y)>7)return;
      this.pointerStart=null;
      const mod = getIntersectedModule(e);
      if (mod) {
        const fullMod = (this.navigationModules || CAMPUS_CONFIG.modules).find(m => m.id === mod.id);
        if (fullMod && this.onNavigate) {
          this.cameraController?.saveState();
          this.onNavigate(fullMod);
        }
      }
    };
    this.renderer.domElement.addEventListener('pointerdown',this.onPointerDown);
    this.renderer.domElement.addEventListener('click',this.onClick);

    // Hover on 3D building
    this.hoveredModuleId = null;
    this.onMouseMove=(e)=>{
      const mod = getIntersectedModule(e);
      const newId = mod ? mod.id : null;
      if (newId !== this.hoveredModuleId) {
        if (this.hoveredModuleId) {
          this.labels.setHighlight(this.hoveredModuleId, false);
          setBuildingHover(this.buildingMeshes,this.hoveredModuleId,false);
        }
        if (newId) {
          this.labels.setHighlight(newId, true);
          setBuildingHover(this.buildingMeshes,newId,true);
          this.renderer.domElement.style.cursor = 'pointer';
        } else {
          this.renderer.domElement.style.cursor = 'default';
        }
        this.hoveredModuleId = newId;
      }
    };
    this.renderer.domElement.addEventListener('mousemove',this.onMouseMove);

    this.onCanvasLeave=()=>{
      if(this.hoveredModuleId){this.labels.setHighlight(this.hoveredModuleId,false);setBuildingHover(this.buildingMeshes,this.hoveredModuleId,false);}
      this.hoveredModuleId=null;this.renderer.domElement.style.cursor='default';
    };
    this.renderer.domElement.addEventListener('pointerleave',this.onCanvasLeave);
    this.onModuleHover=(e)=>setBuildingHover(this.buildingMeshes,e.detail.id,e.detail.active);
    window.addEventListener('campus-module-hover',this.onModuleHover);
  }

  setupEventListeners() {
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.resizeObserver=new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.container);

    this.onVisibilityChange=()=>{
      this.isPaused = document.hidden;
      if (!this.isPaused) {
        this.clock.getDelta();
        cancelAnimationFrame(this.animId);
        this.animId = requestAnimationFrame(this.animate);
      }
    };
    document.addEventListener('visibilitychange',this.onVisibilityChange);
  }

  onResize() {
    this.width = this.container.clientWidth || 1024;
    this.height = this.container.clientHeight || 571;
    // Preserve current orbit and zoom while fitting a wide island on narrow screens.
    const aspect=this.width/this.height;
    const config=this.config || CAMPUS_CONFIG;
    const viewH=Math.max(config.camera.orthoHeight,config.camera.minWorldWidth/aspect);
    this.camera.left=-viewH*aspect/2;
    this.camera.right=viewH*aspect/2;
    this.camera.top=viewH/2;
    this.camera.bottom=-viewH/2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
    this.composer.setSize(this.width,this.height);
    this.labels.update(this.width, this.height);
  }

  animate() {
    if (this.isPaused) return;

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    this.cameraController.update();
    if(updateCampusObjects(this.buildingMeshes,this.camera,delta,elapsed,this.reducedMotion))this.renderer.shadowMap.needsUpdate=true;
    this.materials.update(this.reducedMotion ? 0 : delta, this.reducedMotion ? 0 : elapsed);
    this.circuits.update(this.reducedMotion ? 0 : delta, this.reducedMotion ? 0 : elapsed);
    for(const lamp of this.streetLamps){
      const strength=1+.12*Math.sin((this.reducedMotion?0:elapsed)*1.8+lamp.userData.phase);
      lamp.userData.light.intensity=1.2*strength;
      lamp.userData.halo.material.opacity=.15*strength;
    }
    this.labels.update(this.width, this.height);

    this.composer.render();
    this.animId = requestAnimationFrame(this.animate);
  }

  destroy() {
    this.isPaused=true;
    cancelAnimationFrame(this.animId);
    this.cameraController?.dispose();
    this.resizeObserver?.disconnect();
    this.bloom?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    window.removeEventListener('resize',this.onResize);
    window.removeEventListener('campus-module-hover',this.onModuleHover);
    document.removeEventListener('visibilitychange',this.onVisibilityChange);
    const canvas=this.renderer?.domElement;
    canvas?.removeEventListener('pointerdown',this.onPointerDown);
    canvas?.removeEventListener('click',this.onClick);
    canvas?.removeEventListener('mousemove',this.onMouseMove);
    canvas?.removeEventListener('pointerleave',this.onCanvasLeave);
    this.labels?.overlay?.remove();
    const textures=new Set();
    this.scene?.traverse(obj=>{
      obj.geometry?.dispose?.();
      if(obj.material){
        for(const material of Array.isArray(obj.material)?obj.material:[obj.material]){
          for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
          // Materials may be shared across meshes; dispose is idempotent.
          material.dispose?.();
        }
      }
    });
    for(const texture of textures)texture.dispose();
    this.scene?.background?.dispose?.();
    this.renderer?.dispose();
    canvas?.remove();
  }
}
