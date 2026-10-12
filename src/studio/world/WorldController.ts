import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { WebGPURenderer } from "three/webgpu";
import type { StudioCondition, StudioSpec } from "../scene";
import { buildItem, type BuiltItem } from "./assets";
import { CHAPTERS, ChapterNav, RAKING_THETA, SHOTS, buildAtelier, buildChamber, buildRack, transitMids, type ChapterBuild, type ChapterId, type ChapterShot } from "./chapters";
import { disposeObject } from "./materials";
import { MarkerLayer } from "./markers";
import { createPostFX, type PostFX } from "./postfx";
import { clampLampTheta, lampSide } from "../ux";

type StudioRenderer = THREE.WebGLRenderer | WebGPURenderer;
type RendererBackend = "webgpu" | "webgl2" | "webgl";

const KEY_INTENSITY = 70;

export class WorldController {
  private renderer: StudioRenderer;
  private backend: RendererBackend;
  private splat: THREE.Mesh | null = null;
  private postFX: PostFX | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private nav: ChapterNav;
  private item: BuiltItem;
  private chapterBuilds: Record<ChapterId, ChapterBuild>;
  private markerLayer = new MarkerLayer();
  private hover: "lamp" | "item" | null = null;
  private raycaster = new THREE.Raycaster();
  private camFrom = new THREE.Vector3();
  private lookFrom = new THREE.Vector3();
  private itemFrom = new THREE.Vector3();
  private rotFrom = 0;
  private curves: { cam: THREE.CatmullRomCurve3; item: THREE.CatmullRomCurve3 } | null = null;
  private lookTarget = new THREE.Vector3();
  private currentChapter = 0;
  private container: HTMLElement;
  private disposed = false;
  private reducedMotion: boolean;
  private lastEvidenceIdx = -1;
  private evidenceWorld = new THREE.Vector3();
  private key!: THREE.SpotLight;
  private ndc = new THREE.Vector2();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private floorHit = new THREE.Vector3();
  private lampFocus = new THREE.Vector3();
  private lampUserTheta: number | null = null;
  private lampTheta: number = RAKING_THETA.right;
  private lampTween: { from: number; delta: number; t0: number; dur: number } | null = null;
  private editT0 = -Infinity;
  private impulseT0 = -Infinity;
  private baseFov = 50;
  private lastLightSide: StudioSpec["lightSide"] | null = null;
  private pendingDrag: "lamp" | "item" | null = null;
  private dragMode: "lamp" | "item" | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private itemVel = 0;
  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();
  private headWorld = new THREE.Vector3();
  private keyGain = 1;
  private keyGainTarget = 1;
  private lampRevealArmed = false;
  private lampHasRevealed = false;

  onLampSettled?: (side: "left" | "right") => void;
  onDrag?: (kind: "lamp" | "item") => void;
  onGavel?: () => void;

  static async create(
    container: HTMLElement,
    spec: StudioSpec,
    condition: StudioCondition,
    reducedMotion: boolean,
    opts: { forceWebGL?: boolean; legacy?: boolean; postFx?: boolean } = {},
  ): Promise<WorldController> {
    let renderer: StudioRenderer;
    let envTexture!: THREE.Texture;
    if (!opts.legacy) {
      try {
        const { WebGPURenderer, PMREMGenerator } = await import("three/webgpu");
        const r = new WebGPURenderer({ antialias: true, forceWebGL: opts.forceWebGL ?? false });
        await Promise.race([
          r.init(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("gpu init timeout")), 5000)),
        ]);
        renderer = r;
        const pmrem = new PMREMGenerator(r);
        envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      } catch {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      }
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    }
    if (!(renderer as WebGPURenderer).isWebGPURenderer) {
      const pmrem = new THREE.PMREMGenerator(renderer as THREE.WebGLRenderer);
      envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    const gpuBackend = (renderer as WebGPURenderer).isWebGPURenderer
      ? ((renderer as WebGPURenderer).backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend === true
      : false;
    const backend: RendererBackend = (renderer as WebGPURenderer).isWebGPURenderer
      ? gpuBackend
        ? "webgpu"
        : "webgl2"
      : "webgl";
    const world = new WorldController(container, spec, condition, reducedMotion, renderer, envTexture, backend);
    if (!opts.legacy && opts.postFx !== false && backend !== "webgl") {
      await world.enablePostFX();
    }
    return world;
  }

  constructor(
    container: HTMLElement,
    spec: StudioSpec,
    condition: StudioCondition,
    reducedMotion: boolean,
    renderer: StudioRenderer,
    envTexture: THREE.Texture,
    backend: RendererBackend,
  ) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    this.renderer = renderer;
    this.backend = backend;
    const isMobile = container.clientWidth < 860;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // Node-material shadow system doesn't support PCFSoft; legacy WebGL does.
    this.renderer.shadowMap.type = backend === "webgl" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    // Lets touch drags reach the lamp and item instead of scrolling the page.
    this.renderer.domElement.style.touchAction = "none";

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
    this.baseFov = 44;
    const s0 = SHOTS[CHAPTERS[0]];
    this.camera.position.copy(s0.pos);
    this.lookTarget.copy(s0.look);
    this.camera.lookAt(this.lookTarget);

    this.scene.environment = envTexture;
    this.scene.environmentIntensity = 0.3;

    const ground = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshStandardMaterial({ color: 0x151215, roughness: 0.96 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.07;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.chapterBuilds = {
      discover: buildRack(),
      inspect: buildAtelier(),
      auction: buildChamber(),
    };
    for (const id of CHAPTERS) this.scene.add(this.chapterBuilds[id].group);
    this.chapterBuilds.auction.onGavel = () => {
      this.impulseT0 = performance.now();
      this.onGavel?.();
    };

    const key = new THREE.SpotLight(0xffc27a, KEY_INTENSITY, 0, Math.PI / 6, 0.45, 1.7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    key.name = "rakingKey";
    this.key = key;
    this.scene.add(key);
    this.scene.add(key.target);
    this.scene.add(new THREE.AmbientLight(0x554a3a, 0.15));
    this.lampFocus.set(SHOTS.inspect.item.x, 0, SHOTS.inspect.item.z);

    this.item = buildItem(spec, condition);
    this.item.group.position.copy(s0.item);
    this.item.group.rotation.y = s0.itemRotY;
    this.scene.add(this.item.group);
    key.target = this.item.group;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !reducedMotion;
    this.controls.enabled = false;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.nav = new ChapterNav(900, reducedMotion);

    const dom = this.renderer.domElement;
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("pointercancel", this.onPointerUp);
    dom.addEventListener("pointerleave", this.onPointerLeave);

    window.addEventListener("resize", this.resize);
    this.resize();
    this.placeKey(spec);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private setLampNow(theta: number) {
    this.lampTween = null;
    this.lampTheta = theta;
    this.chapterBuilds.inspect.setLampTheta?.(theta);
  }

  private placeKey(spec: StudioSpec, animate = false) {
    const keep = this.lampUserTheta != null && spec.lightSide === this.lastLightSide;
    const target = keep ? this.lampUserTheta ?? this.lampTheta : RAKING_THETA[spec.lightSide];
    if (!keep) this.lampUserTheta = null;
    const delta = Math.atan2(Math.sin(target - this.lampTheta), Math.cos(target - this.lampTheta));
    if (animate && !this.reducedMotion && Math.abs(delta) > 0.01) {
      this.lampTween = { from: this.lampTheta, delta, t0: performance.now(), dur: 550 };
    } else {
      this.setLampNow(target);
    }
    this.lastLightSide = spec.lightSide;
  }

  private pointerNdc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.disposed || this.chapter() !== "inspect" || !this.controls.enabled || !this.nav.done(performance.now())) return;
    this.pointerNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastX = e.clientX;
    const lampTarget = this.chapterBuilds.inspect.lampDragTarget;
    if (lampTarget && this.raycaster.intersectObject(lampTarget, true).length > 0) {
      this.pendingDrag = "lamp";
      return;
    }
    this.pendingDrag = this.raycaster.intersectObject(this.item.group, true).length > 0 ? "item" : null;
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointerNdc(e);
    this.parallaxTarget.set(this.ndc.x, this.ndc.y);
    if (!this.dragMode) {
      if (!this.pendingDrag) {
        this.updateHover();
        return;
      }
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) <= 6) return;
      this.dragMode = this.pendingDrag;
      this.controls.enabled = false;
      this.lastX = e.clientX;
      this.itemVel = 0;
      this.onDrag?.(this.dragMode);
      this.setCursor("grabbing");
    }
    if (this.dragMode === "lamp") {
      this.revealLamp();
      this.raycaster.setFromCamera(this.ndc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit)) {
        const theta = clampLampTheta(Math.atan2(this.floorHit.z - this.lampFocus.z, this.floorHit.x - this.lampFocus.x));
        this.setLampNow(theta);
        this.lampUserTheta = theta;
      }
    } else {
      const d = (e.clientX - this.lastX) * 0.008;
      this.item.group.rotation.y += d;
      this.itemVel = this.itemVel * 0.7 + d * 0.3;
      this.lastX = e.clientX;
    }
  };

  // Hover feedback: grab cursor and a halo over the lamp head or the item.
  private updateHover() {
    if (this.disposed || this.dragMode) return;
    let next: "lamp" | "item" | null = null;
    if (this.chapter() === "inspect" && this.controls.enabled && this.nav.done(performance.now())) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const lampTarget = this.chapterBuilds.inspect.lampDragTarget;
      if (lampTarget && this.raycaster.intersectObject(lampTarget, true).length > 0) next = "lamp";
      else if (this.raycaster.intersectObject(this.item.group, true).length > 0) next = "item";
    }
    if (next === this.hover) return;
    this.hover = next;
    this.chapterBuilds.inspect.setHover?.(next === "lamp");
    this.setCursor(next ? "grab" : "");
  }

  private clearHover() {
    this.hover = null;
    this.chapterBuilds.inspect.setHover?.(false);
    this.setCursor("");
  }

  private onPointerLeave = () => {
    if (!this.dragMode) this.clearHover();
  };

  private setCursor(cursor: string) {
    this.renderer.domElement.style.cursor = cursor;
  }

  private onPointerUp = (e: PointerEvent) => {
    const wasDrag = this.dragMode !== null;
    if (this.dragMode === "lamp" && this.lampUserTheta != null) {
      const side = Math.cos(this.lampUserTheta) < 0 ? ("left" as const) : ("right" as const);
      this.lastLightSide = side;
      this.onLampSettled?.(side);
    }
    this.dragMode = null;
    this.pendingDrag = null;
    this.controls.enabled = this.chapter() === "inspect" && this.nav.done(performance.now());
    this.pointerNdc(e);
    this.updateHover();
    if (!wasDrag && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) <= 6) {
      this.pointerNdc(e);
      this.handleTap();
    }
  };

  // Click (no drag) in the Atelier: plates align the splat to that photo's view;
  // clicking the captured surface pins evidence to the nearest real point.
  private handleTap() {
    if (this.chapter() !== "inspect" || !this.nav.done(performance.now())) return;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const plates = this.chapterBuilds.inspect.plateTargets ?? [];
    if (plates.length) {
      const hit = this.raycaster.intersectObjects(plates, false)[0];
      if (hit) {
        this.alignSplatToPlate(plates.indexOf(hit.object));
        return;
      }
    }
    if (this.splat) this.pinEvidence();
  }

  private splatYaw: { from: number; to: number; t0: number } | null = null;

  // Re-orients the captured skin to match a provenance plate's viewpoint —
  // the "same angle as the seller's photo" move.
  onPlateAlign?: (idx: number) => void;

  alignSplatToPlate(idx: number) {
    if (!this.splat) return;
    const from = this.splat.rotation.y;
    const target = idx === 0 ? 0 : Math.PI;
    const to = from + Math.atan2(Math.sin(target - from), Math.cos(target - from));
    this.splatYaw = { from, to, t0: performance.now() };
    this.onPlateAlign?.(idx);
  }

  private pinEvidence() {
    const splat = this.splat;
    if (!splat) return;
    const hit = this.raycaster.intersectObject(this.item.group, true)[0];
    if (!hit) return;
    const geo = (splat as THREE.Mesh & { splatGeometry?: THREE.BufferGeometry }).splatGeometry;
    const pos = geo?.getAttribute("position");
    if (!pos || pos.count === 0) return;
    const local = splat.worldToLocal(hit.point.clone());
    const stride = Math.max(1, Math.floor(pos.count / 60000));
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < pos.count; i += stride) {
      const dx = pos.getX(i) - local.x;
      const dy = pos.getY(i) - local.y;
      const dz = pos.getZ(i) - local.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    const p = new THREE.Vector3(pos.getX(best), pos.getY(best), pos.getZ(best));
    splat.localToWorld(p);
    this.item.group.worldToLocal(p);
    this.item.anchors[0] = p;
    // The marker must follow the new anchor, not the replaced vector.
    this.rebindMarkerAnchors();
    this.onEvidencePinned?.();
  }

  private resize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private shotPosScratch = new THREE.Vector3();

  private pulledShotPos(shot: ChapterShot) {
    const aspect = this.camera.aspect || 1;
    const pull = aspect < 1 ? Math.min(1 + (1 - aspect) * 0.9, 1.65) : 1;
    return this.shotPosScratch.copy(shot.pos).sub(shot.look).multiplyScalar(pull).add(shot.look);
  }

  setChapter(idx: number, nowMs = performance.now()) {
    this.clearHover();
    this.markerLayer.invalidate();
    this.camFrom.copy(this.camera.position);
    this.lookFrom.copy(this.lookTarget);
    this.itemFrom.copy(this.item.group.position);
    this.rotFrom = this.item.group.rotation.y;
    const shot = SHOTS[CHAPTERS[idx]];
    const mids = transitMids(CHAPTERS[this.currentChapter], CHAPTERS[idx]);
    if (mids.item.length > 0) {
      this.curves = {
        cam: new THREE.CatmullRomCurve3([this.camFrom.clone(), ...mids.cam, this.pulledShotPos(shot).clone()]),
        item: new THREE.CatmullRomCurve3([this.itemFrom.clone(), ...mids.item, shot.item]),
      };
      this.nav.setDuration(mids.item.length > 1 ? 2200 : 1500);
    } else {
      this.curves = null;
      this.nav.setDuration(900);
    }
    this.nav.request(idx, nowMs);
    this.currentChapter = idx;
    this.controls.enabled = false;
    if (CHAPTERS[idx] === "auction") this.chapterBuilds.auction.playIntro?.(nowMs, this.reducedMotion);
    if (CHAPTERS[idx] === "inspect") this.armLampReveal();
  }

  // First Atelier visit: the item sits in low light — dragging the lamp is
  // literally the reveal. Once revealed the room stays lit on later visits.
  private armLampReveal() {
    if (this.reducedMotion || this.lampHasRevealed || this.lampRevealArmed) return;
    this.lampRevealArmed = true;
    this.keyGain = 0.34;
    this.keyGainTarget = 0.34;
  }

  revealLamp() {
    this.lampHasRevealed = true;
    this.keyGainTarget = 1;
  }

  // Keyboard lamp control: same clamp, side settle and reveal as a drag.
  nudgeLampBy(delta: number) {
    if (this.chapter() !== "inspect" || !this.nav.done(performance.now())) return;
    const theta = clampLampTheta(this.lampTheta + delta);
    this.lampUserTheta = theta;
    this.nudgeLamp(theta, 260);
    const side = lampSide(theta);
    this.lastLightSide = side;
    this.onLampSettled?.(side);
  }

  rotateItemBy(delta: number) {
    if (this.chapter() !== "inspect" || !this.nav.done(performance.now())) return;
    this.setItemRotation(this.item.group.rotation.y + delta);
    this.onDrag?.("item");
  }

  // Scripted lamp sweep for the demo autopilot — counts as a reveal.
  nudgeLamp(theta: number, dur = 900) {
    const delta = Math.atan2(Math.sin(theta - this.lampTheta), Math.cos(theta - this.lampTheta));
    this.lampTween = { from: this.lampTheta, delta, t0: performance.now(), dur };
    this.revealLamp();
    this.onDrag?.("lamp");
  }

  chapter() {
    return CHAPTERS[this.currentChapter];
  }

  setMarkers(bindings: { el: HTMLElement; gated?: boolean }[]) {
    this.markerLayer.set(bindings, this.item.anchors, this.item.anchorLabels);
  }

  // Fog-of-war lift: first evidence interaction reveals the full marker layer.
  unlockEvidence() {
    this.markerLayer.unlock();
  }

  applySpec(spec: StudioSpec, condition: StudioCondition) {
    this.lastEvidenceIdx = -1;
    if (this.item.kind !== spec.object) {
      this.scene.remove(this.item.group);
      this.item.dispose();
      this.item = buildItem(spec, condition);
      const shot = SHOTS[this.chapter()];
      this.item.group.position.copy(shot.item);
      this.item.group.rotation.y = shot.itemRotY;
      this.scene.add(this.item.group);
      this.rebindMarkerAnchors();
      const key = this.scene.getObjectByName("rakingKey") as THREE.SpotLight;
      key.target = this.item.group;
    }
    this.item.refresh(spec, condition);
    this.rebindMarkerAnchors();
    this.editT0 = performance.now();
    this.placeKey(spec, true);
  }

  setCondition(spec: StudioSpec, cond: StudioCondition) {
    this.item.refresh(spec, cond);
    this.editT0 = performance.now();
  }

  setSignal(on: boolean) {
    this.chapterBuilds.auction.setSignal?.(on);
  }

  setPodPop(cb: (i: number) => void) {
    this.chapterBuilds.auction.onPodPop = cb;
  }

  setMaraStep(cb: () => void) {
    this.chapterBuilds.auction.onMaraStep = cb;
  }

  setSourcePhotos(photos: string[]) {
    this.chapterBuilds.inspect.setPlates?.(photos);
  }

  onEvidencePinned?: () => void;

  setRationale(text: string | null) {
    this.chapterBuilds.auction.setRationale?.(text);
  }

  get splatActive() {
    return this.splat !== null;
  }

  get backendName() {
    return this.backend;
  }

  get itemRotation() {
    return this.item.group.rotation.y;
  }

  setItemRotation(y: number) {
    this.item.group.rotation.y = y;
    this.itemVel = 0;
  }

  // Mounts a Gaussian-splat reconstruction as the item's visual skin.
  // The procedural proxy stays in the graph (invisible) so anchors, raycast
  // occlusion, and drag keep working. Node-material renderers only.
  async attachSplat(url: string): Promise<boolean> {
    if (this.backend === "webgl") return false;
    const { loadSplat, fitSplatToObject } = await import("./splat");
    const splat = await loadSplat(url);
    if (!splat || this.disposed) return false;
    if (!fitSplatToObject(splat, this.item.group)) return false;
    this.item.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    this.item.group.add(splat);
    this.splat = splat;
    if (!this.reducedMotion) {
      const target = splat.scale.x;
      splat.scale.setScalar(0.001);
      this.splatPop = { t0: performance.now(), target };
    }
    return true;
  }

  private splatPop: { t0: number; target: number } | null = null;

  private envSplat: THREE.Mesh | null = null;

  get envSplatActive() {
    return this.envSplat !== null;
  }

  // Mounts a photographed room as a chapter backdrop — the hybrid world where
  // authored logic runs inside captured space. Replaces the Rack's authored
  // visuals; item, pods, and logic stay authored.
  async attachEnvSplat(url: string): Promise<boolean> {
    if (this.backend === "webgl") return false;
    const { loadSplat, fitSplatToBox } = await import("./splat");
    const splat = await loadSplat(url);
    if (!splat || this.disposed) return false;
    const build = this.chapterBuilds.discover;
    const tbox = new THREE.Box3().setFromObject(build.group);
    if (tbox.isEmpty() || !fitSplatToBox(splat, tbox)) return false;
    build.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    this.scene.add(splat);
    this.envSplat = splat;
    return true;
  }

  diagnostics() {
    const i = this.renderer.info as {
      render: { calls?: number; drawCalls?: number; triangles: number };
      memory: { geometries: number; textures: number; programs?: number };
      programs?: unknown[];
    };
    return {
      backend: this.backend,
      calls: i.render.drawCalls ?? i.render.calls ?? 0,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? i.memory.programs ?? 0,
      dpr: this.renderer.getPixelRatio(),
      postFx: !!this.postFX,
    };
  }

  setEvidenceFocus(idx: number | null) {
    if (idx != null && idx >= 0) this.lastEvidenceIdx = idx;
  }

  private updateEvidenceArc() {
    const build = this.chapterBuilds.auction;
    const anchor = this.lastEvidenceIdx >= 0 ? this.item.anchors[this.lastEvidenceIdx] : undefined;
    if (CHAPTERS[this.nav.target()] === "auction" && anchor) {
      this.evidenceWorld.copy(anchor).applyMatrix4(this.item.group.matrixWorld);
      build.setEvidenceArc?.(this.evidenceWorld);
    } else {
      build.setEvidenceArc?.(null);
    }
  }

  private rebindMarkerAnchors() {
    this.markerLayer.rebind(this.item.anchors, this.item.anchorLabels);
  }

  private frame() {
    if (this.disposed) return;
    const now = performance.now();
    const shot = SHOTS[CHAPTERS[this.nav.target()]];
    const a = this.nav.alpha(now);
    const endPos = this.pulledShotPos(shot);
    if (a < 1) {
      if (this.curves) {
        this.curves.cam.points[this.curves.cam.points.length - 1].copy(endPos);
        this.curves.cam.getPoint(a, this.camera.position);
        this.curves.item.getPoint(a, this.item.group.position);
        this.lookTarget.lerpVectors(this.lookFrom, shot.look, a);
        this.lookTarget.lerp(this.item.group.position, Math.sin(Math.PI * a) * 0.5);
      } else {
        this.camera.position.lerpVectors(this.camFrom, endPos, a);
        this.lookTarget.lerpVectors(this.lookFrom, shot.look, a);
        this.item.group.position.lerpVectors(this.itemFrom, shot.item, a);
      }
      this.camera.lookAt(this.lookTarget);
      this.item.group.rotation.y = this.rotFrom + (shot.itemRotY - this.rotFrom) * a;
    } else if (!this.controls.enabled && !this.dragMode) {
      this.camera.position.copy(endPos);
      this.lookTarget.copy(shot.look);
      this.camera.lookAt(this.lookTarget);
      this.item.group.position.copy(shot.item);
      this.item.group.rotation.y = shot.itemRotY;
      if (this.chapter() === "inspect") {
        this.controls.target.copy(shot.look);
        this.controls.enabled = true;
      }
    }
    if (this.controls.enabled) {
      this.controls.update();
      if (this.camera.fov !== this.baseFov) {
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
      }
    } else {
      const fovPush = a < 1 ? Math.sin(Math.PI * a) * 2.5 : 0;
      const fov = this.baseFov + fovPush;
      if (this.camera.fov !== fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      if (!this.reducedMotion && !this.dragMode) {
        const breathe = a >= 1 ? 1 : 0.4;
        this.parallax.lerp(this.parallaxTarget, 0.06);
        const parallaxAmt = a >= 1 ? 1 : 0;
        this.camera.position.x += Math.sin(now * 0.00043) * 0.014 * breathe + this.parallax.x * 0.07 * parallaxAmt;
        this.camera.position.y += Math.sin(now * 0.00061 + 1.7) * 0.009 * breathe + this.parallax.y * 0.04 * parallaxAmt;
        const ip = (now - this.impulseT0) / 320;
        if (ip >= 0 && ip < 1) {
          const kick = Math.sin(ip * Math.PI * 4) * (1 - ip) * 0.03;
          this.camera.position.x += kick;
          this.camera.position.y += kick * 0.6;
        }
        this.camera.lookAt(this.lookTarget);
      }
    }
    if (this.lampTween) {
      const t = this.lampTween;
      const p = Math.min(1, (now - t.t0) / t.dur);
      this.lampTheta = t.from + t.delta * (p * p * (3 - 2 * p));
      this.chapterBuilds.inspect.setLampTheta?.(this.lampTheta);
      if (p >= 1) this.lampTween = null;
    }
    if (!this.dragMode && this.itemVel !== 0 && this.chapter() === "inspect" && this.nav.done(now)) {
      this.item.group.rotation.y += this.itemVel;
      this.itemVel *= this.reducedMotion ? 0 : 0.94;
      if (Math.abs(this.itemVel) < 0.0002) this.itemVel = 0;
    }
    const ep = (now - this.editT0) / 450;
    this.item.group.scale.setScalar(ep >= 0 && ep < 1 ? 1 + 0.055 * Math.sin(Math.PI * ep) : 1);
    const lampHead = this.chapterBuilds.inspect.lampHead;
    if (lampHead) {
      lampHead.getWorldPosition(this.headWorld);
      this.key.position.copy(this.headWorld);
    }
    if (this.splatYaw && this.splat) {
      const st = (now - this.splatYaw.t0) / 650;
      if (st >= 1) {
        this.splat.rotation.y = this.splatYaw.to;
        this.splatYaw = null;
      } else {
        const k = st * st * (3 - 2 * st);
        this.splat.rotation.y = this.splatYaw.from + (this.splatYaw.to - this.splatYaw.from) * k;
      }
    }
    if (this.splatPop && this.splat) {
      const p = Math.min(1, (now - this.splatPop.t0) / 700);
      if (p >= 1) {
        this.splat.scale.setScalar(this.splatPop.target);
        this.splatPop = null;
      } else {
        const k = 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
        this.splat.scale.setScalar(Math.max(0.001, this.splatPop.target * k));
      }
    }
    if (this.keyGain !== this.keyGainTarget) {
      this.keyGain += (this.keyGainTarget - this.keyGain) * 0.055;
      if (Math.abs(this.keyGainTarget - this.keyGain) < 0.01) this.keyGain = this.keyGainTarget;
      this.key.intensity = KEY_INTENSITY * this.keyGain;
    }
    this.chapterBuilds.auction.update?.(now);
    this.chapterBuilds.inspect.update?.(now);
    this.chapterBuilds.auction.setWatchTarget?.(this.item.group.position);
    this.updateEvidenceArc();
    this.markerLayer.update(this.camera, this.item.group, this.container.clientWidth, this.container.clientHeight, this.chapter() === "inspect" && this.nav.done(now));
    if (this.postFX) this.postFX.render();
    else this.renderer.render(this.scene, this.camera);
  }

  async enablePostFX(): Promise<boolean> {
    this.postFX = await createPostFX(this.renderer as WebGPURenderer, this.scene, this.camera);
    return this.postFX !== null;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointermove", this.onPointerMove);
    dom.removeEventListener("pointerup", this.onPointerUp);
    dom.removeEventListener("pointercancel", this.onPointerUp);
    dom.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("resize", this.resize);
    for (const id of CHAPTERS) disposeObject(this.chapterBuilds[id].group);
    this.item.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
