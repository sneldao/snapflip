import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { coneGradient, dustSprite, etchedDial, mats, palette } from "./materials";
import { ChapterNav, easeInOutCubic } from "./nav";

export { ChapterNav, easeInOutCubic };

export type ChapterId = "discover" | "inspect" | "auction";
export const CHAPTERS: ChapterId[] = ["discover", "inspect", "auction"];

export interface ChapterShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  item: THREE.Vector3;
  itemRotY: number;
}

export const SHOTS: Record<ChapterId, ChapterShot> = {
  discover: {
    pos: new THREE.Vector3(-6.8, 1.95, 5.6),
    look: new THREE.Vector3(-7, 1.15, -0.4),
    item: new THREE.Vector3(-7, 0.94, 0.15),
    itemRotY: -0.3,
  },
  inspect: {
    pos: new THREE.Vector3(2.9, 2.15, 4.3),
    look: new THREE.Vector3(0, 1.0, 0),
    item: new THREE.Vector3(0, 1.45, 0),
    itemRotY: -0.35,
  },
  auction: {
    pos: new THREE.Vector3(9.6, 3.0, 5.6),
    look: new THREE.Vector3(7, 1.0, 0),
    item: new THREE.Vector3(7, 1.63, 0),
    itemRotY: -0.4,
  },
};

const TRANSIT: Partial<Record<`${ChapterId}>${ChapterId}`, { cam: THREE.Vector3[]; item: THREE.Vector3[] }>> = {
  "discover>inspect": {
    cam: [new THREE.Vector3(-3.2, 2.3, 4.6)],
    item: [new THREE.Vector3(-3.6, 1.35, 0.7)],
  },
  "inspect>auction": {
    cam: [new THREE.Vector3(4.6, 2.7, 5.2)],
    item: [new THREE.Vector3(3.5, 1.5, 1.0)],
  },
  "discover>auction": {
    cam: [new THREE.Vector3(-3.2, 2.3, 4.6), new THREE.Vector3(4.6, 2.7, 5.2)],
    item: [new THREE.Vector3(-3.6, 1.35, 0.7), new THREE.Vector3(3.5, 1.5, 1.0)],
  },
};

export function transitMids(from: ChapterId, to: ChapterId): { cam: THREE.Vector3[]; item: THREE.Vector3[] } {
  if (from === to) return { cam: [], item: [] };
  const fwd = TRANSIT[`${from}>${to}`];
  const pair = fwd ?? TRANSIT[`${to}>${from}`];
  if (!pair) return { cam: [], item: [] };
  const cam = pair.cam.map((v) => v.clone());
  const item = pair.item.map((v) => v.clone());
  if (!fwd) {
    cam.reverse();
    item.reverse();
  }
  return { cam, item };
}

function textPlate(text: string, w: number, h: number): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#e9dfc4";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#8a7a44";
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = "#20190f";
    g.font = "700 44px monospace";
    const fit = g.measureText(text).width;
    if (fit > 232) g.font = `700 ${Math.floor(44 * (232 / fit))}px monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 66);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.9 }));
  return mesh;
}

function provenanceCardTexture(front: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const g = c.getContext("2d");
  if (g) {
    g.textAlign = "center";
    if (front) {
      g.fillStyle = "#e9dfc4";
      g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "#8a7a44";
      g.lineWidth = 2;
      g.strokeRect(8, 8, 240, 304);
      g.fillStyle = "#20190f";
      g.font = "700 22px monospace";
      g.fillText("FRONT VIEW", 128, 44);
      g.font = "400 12px monospace";
      g.fillStyle = "#5a4a28";
      g.fillText("PROCEDURAL PROXY", 128, 66);
      g.fillText("NO SOURCE PHOTO", 128, 82);
      g.strokeStyle = "#20190f";
      g.lineWidth = 2;
      g.strokeRect(78, 106, 100, 176);
      g.strokeStyle = "#8a7a44";
      g.strokeRect(88, 120, 80, 88);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        g.moveTo(84, 228 + i * 12);
        g.lineTo(172, 228 + i * 12);
      }
      g.stroke();
    } else {
      g.fillStyle = "#2b2630";
      g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "#4a4152";
      g.lineWidth = 2;
      g.strokeRect(8, 8, 240, 304);
      g.fillStyle = "#a89a80";
      g.font = "700 20px monospace";
      g.fillText("REAR VIEW", 128, 44);
      g.font = "400 12px monospace";
      g.fillStyle = "#7a6f60";
      g.fillText("NOT CAPTURED", 128, 66);
      g.strokeStyle = "#5a5348";
      g.setLineDash([6, 5]);
      g.strokeRect(78, 106, 100, 176);
    }
  }
  return new THREE.CanvasTexture(c);
}

function photoCardTexture(title: string, url: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (img?: HTMLImageElement) => {
    if (!g) return;
    g.fillStyle = "#e9dfc4";
    g.fillRect(0, 0, 256, 320);
    g.strokeStyle = "#8a7a44";
    g.lineWidth = 2;
    g.strokeRect(8, 8, 240, 304);
    g.textAlign = "center";
    g.fillStyle = "#20190f";
    g.font = "700 20px monospace";
    g.fillText(title, 128, 40);
    g.fillStyle = "#5a4a28";
    g.font = "400 11px monospace";
    g.fillText("SOURCE PHOTO — UNVERIFIED", 128, 60);
    if (img) {
      const iw = 200;
      const ih = 216;
      const s = Math.max(iw / img.width, ih / img.height);
      const w = img.width * s;
      const h = img.height * s;
      g.save();
      g.beginPath();
      g.rect(28, 76, iw, ih);
      g.clip();
      g.drawImage(img, 28 + (iw - w) / 2, 76 + (ih - h) / 2, w, h);
      g.restore();
      g.strokeStyle = "#20190f";
      g.lineWidth = 2;
      g.strokeRect(28, 76, iw, ih);
    } else {
      g.fillStyle = "#d8cfae";
      g.fillRect(28, 76, 200, 216);
      g.fillStyle = "#8a7a44";
      g.font = "400 12px monospace";
      g.fillText("loading…", 128, 190);
    }
    tex.needsUpdate = true;
  };
  draw();
  const img = new Image();
  img.onload = () => draw(img);
  img.src = url;
  return tex;
}

function provenanceCard(front: boolean): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.62),
    new THREE.MeshStandardMaterial({ map: provenanceCardTexture(front), roughness: 0.9 }),
  );
}

function provenancePlate(front: boolean): THREE.Group {
  const plate = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.95, 0.03), mats.charcoal());
  post.position.y = -0.425;
  post.castShadow = true;
  plate.add(post);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.68, 0.035), mats.timberDark());
  back.position.y = 0.22;
  back.castShadow = true;
  plate.add(back);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.65), mats.brass());
  rim.position.set(0, 0.22, 0.019);
  plate.add(rim);
  const card = provenanceCard(front);
  card.name = "plate-card";
  card.position.set(0, 0.22, 0.021);
  plate.add(card);
  return plate;
}

export const RAKING_THETA = { left: Math.PI - 0.35, right: 0.35 } as const;

export interface ChapterBuild {
  group: THREE.Group;
  setSignal?(on: boolean): void;
  setRakingSide?(side: "left" | "right"): void;
  setLampTheta?(theta: number): void;
  lampDragTarget?: THREE.Object3D;
  lampHead?: THREE.Object3D;
  update?(nowMs: number): void;
  playIntro?(nowMs: number, reducedMotion?: boolean): void;
  setEvidenceArc?(anchorWorld: THREE.Vector3 | null): void;
  onPodPop?: (i: number) => void;
  setPlates?(photos: string[]): void;
  plateTargets?: THREE.Object3D[];
  setRationale?(text: string | null): void;
  onGavel?: () => void;
}

export function buildRack(): ChapterBuild {
  const g = new THREE.Group();
  g.position.x = -7;

  const floorMat = mats.timberDark();
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.08, 7), floorMat);
    plank.position.set(-3.2 + i * 1.28, -0.04, 0);
    plank.receiveShadow = true;
    g.add(plank);
  }
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.03, 0.14), mats.brass());
  threshold.position.set(0, 0.015, 3.28);
  g.add(threshold);

  const rearWall = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 0.18), mats.plaster());
  rearWall.position.set(-0.7, 1.7, -3.42);
  rearWall.receiveShadow = true;
  g.add(rearWall);
  const wainscot = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 0.2), mats.plasterDark());
  wainscot.position.set(-0.7, 0.35, -3.36);
  g.add(wainscot);
  const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.1), mats.timber());
  windowFrame.position.set(-1.9, 2.0, -3.3);
  g.add(windowFrame);
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.1), mats.coolSpill());
  windowGlow.position.set(-1.9, 2.0, -3.24);
  g.add(windowGlow);
  for (const off of [[0, 0.34], [0, -0.34], [0.4, 0], [-0.4, 0]] as const) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(off[0] === 0 ? 1.34 : 0.05, off[0] === 0 ? 0.05 : 1.14, 0.04), mats.timber());
    mullion.position.set(-1.9 + off[0], 2.0 + off[1], -3.22);
    g.add(mullion);
  }
  const coolSpill = new THREE.PointLight(palette.coolSpill, 7, 7);
  coolSpill.position.set(-1.9, 1.9, -2.8);
  g.add(coolSpill);

  const portal = new THREE.Group();
  portal.position.set(3.35, 0, -0.6);
  for (const pz of [-1.1, 1.1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.7, 0.28), mats.timberGrain());
    post.position.set(0, 1.35, pz);
    post.castShadow = true;
    portal.add(post);
  }
  const portalLintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.5), mats.timberGrain());
  portalLintel.position.set(0, 2.72, 0);
  portal.add(portalLintel);
  const portalInlay = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 2.3), mats.coolSpill());
  portalInlay.position.set(-0.16, 1.25, 0);
  portalInlay.rotation.y = -Math.PI / 2;
  portalInlay.scale.x = 8;
  portal.add(portalInlay);
  g.add(portal);

  const niche = new THREE.Group();
  niche.position.set(0, 0, 0.15);
  const nicheBack = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.85, 0.16), mats.plaster());
  nicheBack.position.set(0, 1.2, -0.72);
  nicheBack.receiveShadow = true;
  niche.add(nicheBack);
  for (const px of [-0.78, 0.78]) {
    const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.85, 0.34), mats.plasterDark());
    pilaster.position.set(px, 1.2, -0.62);
    pilaster.castShadow = true;
    niche.add(pilaster);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.42), mats.plasterDark());
    cap.position.set(px, 2.15, -0.62);
    niche.add(cap);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.26, 0.4), mats.plasterDark());
  header.position.set(0, 2.28, -0.6);
  header.castShadow = true;
  niche.add(header);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.26, 0.9), mats.plasterDark());
  plinth.position.set(0, 0.13, 0);
  plinth.castShadow = plinth.receiveShadow = true;
  niche.add(plinth);
  const plinthTrim = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.05, 0.96), mats.brass());
  plinthTrim.position.set(0, 0.265, 0);
  niche.add(plinthTrim);
  const sampleTag = textPlate("SAMPLE", 0.4, 0.18);
  sampleTag.position.set(-0.52, 0.13, 0.47);
  niche.add(sampleTag);
  g.add(niche);

  function shelvingUnit(x: number, boards: number[], width: number) {
    const u = new THREE.Group();
    u.position.x = x;
    const wood = mats.timberGrain();
    for (const px of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.55), wood);
      post.position.set(px, 1.25, -0.9);
      post.castShadow = true;
      u.add(post);
    }
    for (const by of boards) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.07, 0.55), wood);
      board.position.set(0, by, -0.9);
      board.castShadow = board.receiveShadow = true;
      u.add(board);
      for (const bx of [-width / 2 + 0.14, width / 2 - 0.14]) {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.4), mats.steel());
        bracket.position.set(bx, by - 0.11, -0.82);
        u.add(bracket);
      }
      const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.035, 0.06), mats.timberDark());
      trim.position.set(0, by + 0.05, -0.6);
      u.add(trim);
    }
    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.24, 0.1, 0.6), mats.timberDark());
    topTrim.position.set(0, 2.5, -0.9);
    u.add(topTrim);
    g.add(u);
    return u;
  }
  shelvingUnit(-2.75, [0.5, 1.15, 1.95], 2.3);
  shelvingUnit(2.75, [0.55, 1.35], 2.0);

  const slatGeo = new THREE.BoxGeometry(0.5, 0.035, 0.03);
  const slatMat = mats.timber();
  const slats = new THREE.InstancedMesh(slatGeo, slatMat, 36);
  slats.castShadow = true;
  const sm = new THREE.Matrix4();
  const slatRots = new THREE.Matrix4();
  let si = 0;
  const binSpots: [number, number, number, number][] = [
    [-3.1, 0.75, -0.62, 0.06], [-2.35, 0.75, -0.62, -0.05], [-2.9, 1.4, -0.62, 0.04], [-2.3, 1.4, -0.62, -0.08],
    [-2.8, 2.2, -0.62, 0.1], [2.35, 0.8, -0.62, -0.06], [3.15, 0.8, -0.62, 0.08], [2.85, 1.6, -0.62, -0.04],
  ];
  for (const [bx, by, bz, br] of binSpots) {
    for (let s = 0; s < 4 && si < 36; s++) {
      slatRots.makeRotationY(br);
      sm.copy(slatRots);
      sm.setPosition(bx, by + s * 0.11, bz);
      slats.setMatrixAt(si++, sm);
    }
  }
  slats.count = si;
  slats.instanceMatrix.needsUpdate = true;
  g.add(slats);
  const binFill = new THREE.MeshStandardMaterial({ color: 0x3d4a5e, roughness: 0.75 });
  for (const [bx, by, bz, br] of binSpots.slice(0, 5)) {
    const fill = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.34), binFill);
    fill.position.set(bx, by + 0.2, bz - 0.08);
    fill.rotation.y = br;
    fill.castShadow = true;
    g.add(fill);
  }
  const binBackMat = mats.timberDark();
  for (const [bx, by, bz, br] of binSpots) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.28), binBackMat);
    back.position.set(bx, by + 0.22, bz - 0.16);
    back.rotation.y = br;
    back.castShadow = back.receiveShadow = true;
    g.add(back);
  }

  const tagMounts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), mats.brass(), 6);
  const tm = new THREE.Matrix4();
  const tagSpots: [number, number, number][] = [
    [-3.1, 1.18, -0.58], [-2.3, 1.18, -0.58], [-2.8, 1.98, -0.58], [2.35, 0.58, -0.58], [3.15, 1.38, -0.58], [2.75, 1.38, -0.58],
  ];
  const lotTags = ["LOT 204", "LOT 209", "LOT 211", "LOT 213", "LOT 218", "LOT 221"];
  tagSpots.forEach(([x, y, z], i) => {
    tm.makeRotationX(Math.PI / 2);
    tm.setPosition(x, y + 0.045, z);
    tagMounts.setMatrixAt(i, tm);
    const tag = textPlate(lotTags[i % lotTags.length], 0.26, 0.13);
    tag.position.set(x, y + 0.14, z + 0.02);
    tag.rotation.x = -0.35;
    g.add(tag);
  });
  tagMounts.instanceMatrix.needsUpdate = true;
  g.add(tagMounts);

  const fastGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8);
  const fasteners = new THREE.InstancedMesh(fastGeo, mats.steel(), 20);
  const fm = new THREE.Matrix4();
  let fi = 0;
  for (const ux of [-2.75, 2.75]) {
    for (const px of [-0.9, 0.9]) {
      for (const fy of [0.5, 1.2, 1.9]) {
        if (fi >= 20) break;
        fm.makeRotationX(Math.PI / 2);
        fm.setPosition(ux + px, fy, -0.62);
        fasteners.setMatrixAt(fi++, fm);
      }
    }
  }
  fasteners.count = fi;
  fasteners.instanceMatrix.needsUpdate = true;
  g.add(fasteners);

  for (const bz of [-2.4, -0.6, 1.2, 3.0]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.14, 0.2), mats.timberDark());
    beam.position.set(0, 2.95, bz);
    beam.castShadow = true;
    g.add(beam);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.0, 10), mats.amberGlow());
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0, 2.78, 0.3);
  g.add(tube);
  const task = new THREE.PointLight(palette.tungsten, 8, 8);
  task.position.set(0, 2.4, 1.2);
  g.add(task);

  const fgCrate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.25, 0.7), mats.timberGrain());
  fgCrate.position.set(2.9, 0.62, 2.9);
  fgCrate.rotation.y = 0.45;
  fgCrate.castShadow = true;
  g.add(fgCrate);
  const fgRail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 1.6), mats.timberDark());
  fgRail.position.set(-2.9, 0.25, 2.9);
  fgRail.rotation.y = -0.2;
  fgRail.castShadow = true;
  g.add(fgRail);

  return { group: g };
}

export function buildAtelier(): ChapterBuild {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 7), mats.charcoalHi());
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  g.add(floor);

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.16, 48), mats.porcelain());
  platform.position.y = 0.72;
  platform.castShadow = platform.receiveShadow = true;
  g.add(platform);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.62, 24), mats.porcelain());
  column.position.y = 0.33;
  column.castShadow = true;
  g.add(column);

  const lamp = new THREE.Group();
  lamp.scale.setScalar(0.85);
  const steel = mats.steel();
  const brassM = mats.brass();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.045, 24), steel);
  base.position.y = 0.0225;
  base.castShadow = true;
  lamp.add(base);
  const baseCap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.03, 16), brassM);
  baseCap.position.y = 0.06;
  lamp.add(baseCap);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.5, 10), steel);
  post.position.set(-0.06, 0.31, 0);
  post.castShadow = true;
  lamp.add(post);
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.62, 10), steel);
  arm1.position.set(0.16, 0.66, 0);
  arm1.rotation.z = -0.62;
  arm1.castShadow = true;
  lamp.add(arm1);
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 12), brassM);
  knuckle.position.set(0.36, 0.84, 0);
  lamp.add(knuckle);
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 10), steel);
  arm2.position.set(0.5, 0.78, 0);
  arm2.rotation.z = 1.15;
  arm2.castShadow = true;
  lamp.add(arm2);
  const headG = new THREE.Group();
  headG.position.set(0.62, 0.64, 0);
  headG.rotation.z = -1.0;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.115, 0.17, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x232028, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
  );
  shade.castShadow = true;
  headG.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), mats.signalOn());
  bulb.position.y = -0.055;
  headG.add(bulb);
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10));
  headHit.visible = false;
  headG.add(headHit);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.15, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: coneGradient(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = -0.62;
  beam.renderOrder = 5;
  headG.add(beam);
  lamp.add(headG);
  g.add(lamp);

  const lampAnchor = new THREE.Group();
  lampAnchor.add(lamp);
  g.add(lampAnchor);
  const lampFocus = new THREE.Vector3(SHOTS.inspect.item.x, 0, SHOTS.inspect.item.z);
  const LAMP_RADIUS = 1.9;
  let lampTheta = 0.35;
  function placeLamp(theta: number) {
    lampTheta = theta;
    lampAnchor.position.set(lampFocus.x + LAMP_RADIUS * Math.cos(theta), 0, lampFocus.z + LAMP_RADIUS * Math.sin(theta));
    lampAnchor.rotation.y = Math.atan2(-(lampFocus.z - lampAnchor.position.z), lampFocus.x - lampAnchor.position.x);
  }
  placeLamp(lampTheta);

  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.4), mats.steel());
  tray.position.set(-1.4, 0.8, 0.5);
  tray.castShadow = true;
  g.add(tray);
  for (const lx of [-1.68, -1.12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.775, 0.03), mats.steel());
    leg.position.set(lx, 0.3875, 0.5);
    leg.castShadow = true;
    g.add(leg);
  }
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 10, 24), mats.steel());
  lensRing.position.set(-1.5, 0.86, 0.45);
  lensRing.rotation.x = -Math.PI / 2 + 0.3;
  g.add(lensRing);
  const lensHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), mats.timber());
  lensHandle.position.set(-1.4, 0.83, 0.56);
  lensHandle.rotation.z = 1.1;
  g.add(lensHandle);
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.3, 8), mats.steel());
  probe.position.set(-1.28, 0.84, 0.42);
  probe.rotation.z = Math.PI / 2 - 0.15;
  g.add(probe);

  const cycMat = mats.plasterDark();
  cycMat.side = THREE.BackSide;
  const cyc = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3.2, 48, 1, true, Math.PI * 0.55, Math.PI * 0.9), cycMat);
  cyc.position.set(0, 1.6, -2.8);
  cyc.receiveShadow = true;
  g.add(cyc);

  const fill = new THREE.PointLight(0xfff0dd, 8, 8);
  fill.position.set(-1.5, 2.4, 1.5);
  g.add(fill);

  const plateCards: THREE.Mesh[] = [];
  for (const [px, front] of [[-1.35, true], [1.35, false]] as const) {
    const plate = provenancePlate(front);
    plate.position.set(px, 0.9, -0.55);
    plate.rotation.y = -Math.sign(px) * 0.5;
    const card = plate.getObjectByName("plate-card");
    if (card instanceof THREE.Mesh) plateCards.push(card);
    g.add(plate);
  }

  const dial = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 48),
    new THREE.MeshStandardMaterial({ map: etchedDial(), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  dial.rotation.x = -Math.PI / 2;
  dial.position.y = 0.803;
  g.add(dial);

  const DUST_N = 140;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustBase = new Float32Array(DUST_N * 3);
  const dustPhase = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    const i3 = i * 3;
    dustBase[i3] = (Math.random() - 0.5) * 3.2;
    dustBase[i3 + 1] = 0.3 + Math.random() * 1.9;
    dustBase[i3 + 2] = (Math.random() - 0.5) * 2.4;
    dustPos[i3] = dustBase[i3];
    dustPos[i3 + 1] = dustBase[i3 + 1];
    dustPos[i3 + 2] = dustBase[i3 + 2];
    dustPhase[i] = Math.random() * Math.PI * 2;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ map: dustSprite(), size: 0.035, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
  );
  g.add(dust);

  return {
    group: g,
    lampDragTarget: headHit,
    lampHead: headG,
    plateTargets: plateCards,
    setLampTheta(theta) {
      placeLamp(theta);
    },
    setRakingSide(side) {
      placeLamp(RAKING_THETA[side]);
    },
    setPlates(photos) {
      const titles = ["FRONT VIEW", "REAR VIEW"];
      plateCards.forEach((card, i) => {
        const mat = card.material as THREE.MeshStandardMaterial;
        const url = photos[i];
        mat.map?.dispose();
        mat.map = url ? photoCardTexture(titles[i] ?? "VIEW", url) : provenanceCardTexture(i === 0);
        mat.needsUpdate = true;
      });
    },
    update(nowMs) {
      const attr = dustGeo.getAttribute("position") as THREE.BufferAttribute;
      const t = nowMs * 0.0004;
      for (let i = 0; i < DUST_N; i++) {
        const i3 = i * 3;
        attr.setXYZ(
          i,
          dustBase[i3] + Math.sin(t * 0.7 + dustPhase[i] * 1.3) * 0.08,
          dustBase[i3 + 1] + Math.sin(t + dustPhase[i]) * 0.06,
          dustBase[i3 + 2] + Math.cos(t * 0.5 + dustPhase[i] * 0.7) * 0.08,
        );
      }
      attr.needsUpdate = true;
    },
  };
}

export function buildChamber(): ChapterBuild {
  const g = new THREE.Group();
  g.position.x = 7;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 8), mats.charcoal());
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  g.add(floor);

  const stepMat = mats.charcoalHi();
  const trimMat = mats.brass();
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(3.4 + i * 0.9, 3.4 + i * 0.9, 0.22, 40, 1, false, Math.PI * 0.15, Math.PI * 0.7), stepMat);
    step.position.set(0, 0.11 + i * 0.22, -0.4);
    step.rotation.y = Math.PI * 0.075;
    step.receiveShadow = true;
    g.add(step);
    const trimGeo = new THREE.TorusGeometry(3.4 + i * 0.9, 0.018, 8, 64, Math.PI * 0.7);
    trimGeo.rotateX(-Math.PI / 2);
    trimGeo.rotateY(-Math.PI * 0.35);
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(0, 0.23 + i * 0.22, -0.4);
    trim.rotation.y = Math.PI * 0.075;
    g.add(trim);
  }
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 3.0, 40, 1, true, Math.PI * 0.1, Math.PI * 0.8), new THREE.MeshStandardMaterial({ color: 0x241f28, roughness: 0.85, side: THREE.BackSide }));
  wall.position.set(0, 1.5, -0.4);
  wall.rotation.y = Math.PI * 0.05;
  g.add(wall);

  const podNames = ["SIMULATED COLLECTOR", "DEALER", "SNIPE", "CURATOR", "BROKER"];
  const signalMat = mats.signalOn();
  const signalOffMat = mats.signalOff();
  const stationMat = mats.charcoalHi();
  const podGeo = new RoundedBoxGeometry(0.55, 0.9, 0.55, 3, 0.06);
  const postGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8);
  const lampGeo = new THREE.SphereGeometry(0.06, 14, 14);
  const lamps: THREE.Mesh[] = [];
  const lampMats: THREE.MeshStandardMaterial[] = [];
  let signalLight: THREE.PointLight | null = null;
  let collectorPos = { x: 0, y: 0.67, z: 0 };
  podNames.forEach((name, i) => {
    const a = Math.PI * (0.30 + i * 0.09);
    const r = 3.15;
    const px = Math.cos(a) * r;
    const pz = -0.4 - Math.sin(a) * r;
    const py = 0.67;
    const pod = new THREE.Mesh(podGeo, stationMat);
    pod.position.set(px, py, pz);
    pod.castShadow = pod.receiveShadow = true;
    g.add(pod);
    const post = new THREE.Mesh(postGeo, stationMat);
    post.position.set(px, py + 0.6, pz);
    g.add(post);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2c2622, emissive: palette.amber, emissiveIntensity: 0.12, roughness: 0.7 });
    lampMats.push(lampMat);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(px, py + 0.8, pz);
    lamps.push(lamp);
    g.add(lamp);
    const plate = textPlate(name, i === 0 ? 0.85 : 0.55, 0.15);
    plate.position.set(px, py + 0.05, pz + 0.281);
    g.add(plate);
    if (i === 0) {
      collectorPos = { x: px, y: py, z: pz };
      signalLight = new THREE.PointLight(palette.amber, 0, 4);
      signalLight.position.copy(lamp.position);
      g.add(signalLight);
    }
  });
  // Dropout basis card under the collector pod — replays the reason in-world.
  const rationaleCanvas = document.createElement("canvas");
  rationaleCanvas.width = 256;
  rationaleCanvas.height = 84;
  const rationaleTex = new THREE.CanvasTexture(rationaleCanvas);
  const rationaleMat = new THREE.MeshStandardMaterial({ map: rationaleTex, transparent: true, opacity: 0, roughness: 0.9 });
  const rationaleMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.3), rationaleMat);
  rationaleMesh.position.set(collectorPos.x, collectorPos.y - 0.23, collectorPos.z + 0.288);
  g.add(rationaleMesh);
  let rationaleText: string | null = null;

  for (let i = 0; i < 7; i++) {
    const phi = Math.PI * (0.15 + ((i + 0.5) / 7) * 0.8);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.9, 0.08), stationMat);
    rib.position.set(Math.sin(phi) * 4.78, 1.5, -0.4 + Math.cos(phi) * 4.78);
    rib.rotation.y = phi;
    g.add(rib);
  }

  const clock = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 12, 64), mats.steel());
  clock.position.set(0, 2.15, -2.1);
  g.add(clock);
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), mats.plasterDark());
  clockFace.position.set(0, 2.15, -2.08);
  g.add(clockFace);
  const tickMat = mats.timberDark();
  for (let i = 0; i < 12; i++) {
    const ta = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.035, i % 3 === 0 ? 0.15 : 0.09, 0.02), tickMat);
    tick.position.set(Math.sin(ta) * 0.96, 2.15 + Math.cos(ta) * 0.96, -2.07);
    tick.rotation.z = -ta;
    g.add(tick);
  }
  const clockPivot = new THREE.Group();
  clockPivot.position.set(0, 2.15, -2.05);
  const clockHand = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.78, 0.03), mats.amberGlow());
  clockHand.position.y = 0.32;
  clockPivot.add(clockHand);
  const clockHub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), mats.charcoal());
  clockPivot.add(clockHub);
  g.add(clockPivot);

  const gavelStand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.42, 14), mats.charcoalHi());
  gavelStand.position.set(-1.35, 0.99, -1.9);
  gavelStand.castShadow = true;
  g.add(gavelStand);
  const gavelBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.045, 18), mats.brass());
  gavelBlock.position.set(-1.35, 1.22, -1.9);
  g.add(gavelBlock);
  const gavelPivot = new THREE.Group();
  gavelPivot.position.set(-1.35, 1.26, -1.9);
  const gavelHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 8), mats.charcoal());
  gavelHandle.position.y = 0.17;
  gavelHandle.castShadow = true;
  gavelPivot.add(gavelHandle);
  const gavelHead = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), mats.brass());
  gavelHead.rotation.z = Math.PI / 2;
  gavelHead.position.y = 0.35;
  gavelHead.castShadow = true;
  gavelPivot.add(gavelHead);
  g.add(gavelPivot);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.18, 0.24), mats.timberDark());
  beam.position.set(0, 3.4, 0);
  beam.castShadow = true;
  g.add(beam);
  for (const bx of [-2.4, 0, 2.4]) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), mats.amberGlow());
    bulb.position.set(bx, 3.28, 0);
    g.add(bulb);
  }
  const warm = new THREE.PointLight(palette.amber, 10, 10);
  warm.position.set(0, 3.1, 0.5);
  g.add(warm);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.3, 40), mats.charcoalHi());
  plinth.position.set(0, 0.83, 0);
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);
  const spotDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.MeshStandardMaterial({ color: palette.amber, emissive: palette.amber, emissiveIntensity: 0.5, roughness: 0.9 }),
  );
  spotDisc.rotation.x = -Math.PI / 2;
  spotDisc.position.set(0, 0.985, 0);
  g.add(spotDisc);
  const spotCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.25, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  spotCone.position.set(0, 2.1, 0);
  g.add(spotCone);

  const lotPlacard = textPlate("LOT 07 · SCENARIO", 0.5, 0.14);
  lotPlacard.position.set(0, 0.86, 0.76);
  lotPlacard.rotation.x = -0.18;
  g.add(lotPlacard);

  for (const i of [1, 2, 4]) {
    const lamp = lamps[i];
    const paddle = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), mats.timber());
    stick.position.y = -0.07;
    paddle.add(stick);
    const card = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.17, 0.012, 2, 0.02), mats.paper());
    paddle.add(card);
    paddle.position.set(lamp.position.x + 0.18, lamp.position.y - 0.55, lamp.position.z + 0.1);
    paddle.rotation.set(0.15, 0, -0.5);
    g.add(paddle);
  }

  const strikeMat = new THREE.MeshBasicMaterial({ color: palette.amber, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const strikeRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 40), strikeMat);
  strikeRing.rotation.x = -Math.PI / 2;
  strikeRing.position.set(-1.35, 1.245, -1.9);
  strikeRing.visible = false;
  g.add(strikeRing);

  const BID_STEP_MS = 140;
  const INTRO_TAIL_MS = 140;
  const LAMP_WAIT = 0.04;
  const LAMP_IDLE = 0.12;
  const LAMP_POP = 2.4;
  const LAMP_POP_MS = 220;
  const ARC_FADE_MS = 400;
  const ARC_OPACITY = 0.7;
  const GAVEL_FALL_MS = 250;
  const GAVEL_UP = 0.55;
  const GAVEL_DROP = 0.7;
  const INTRO_MS = BID_STEP_MS * podNames.length + INTRO_TAIL_MS;

  let signalOn = false;
  let introActive = false;
  let introStart = -1;
  let introEndAt = -1;
  let poppedCount = 0;
  let introReduced = false;
  let gavelFallAt = -1;
  let arcAnchor: THREE.Vector3 | null = null;
  let arcDirty = false;
  let arcMesh: THREE.Mesh | null = null;
  let arcCurve: THREE.QuadraticBezierCurve3 | null = null;
  let strikeT0 = -1;
  const arcMat = new THREE.MeshBasicMaterial({ color: palette.amber, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const beadMat = new THREE.MeshBasicMaterial({ color: palette.amberHi, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const beadGeo = new THREE.SphereGeometry(0.022, 8, 8);
  const beads: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(beadGeo, beadMat);
    b.visible = false;
    beads.push(b);
    g.add(b);
  }
  const lampEndLocal = lamps[0].position.clone();

  function applySignal() {
    lamps[0].material = signalOn ? signalMat : signalOffMat;
    if (signalLight) signalLight.intensity = signalOn ? 5 : 0;
  }

  function finishIntro(atMs: number) {
    introActive = false;
    introEndAt = atMs;
    for (const m of lampMats) m.emissiveIntensity = LAMP_IDLE;
    applySignal();
    if (signalOn || introReduced) {
      gavelPivot.rotation.z = signalOn ? GAVEL_UP : GAVEL_UP - GAVEL_DROP;
      gavelFallAt = -1;
    } else {
      gavelFallAt = atMs;
    }
  }

  function rebuildArc() {
    if (!arcAnchor) return;
    const a = arcAnchor.clone().sub(g.position);
    const b = lampEndLocal.clone();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 1.2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    arcCurve = curve;
    const geo = new THREE.TubeGeometry(curve, 40, 0.008, 6, false);
    if (arcMesh) {
      arcMesh.geometry.dispose();
      arcMesh.geometry = geo;
    } else {
      arcMesh = new THREE.Mesh(geo, arcMat);
      arcMesh.visible = false;
      g.add(arcMesh);
    }
  }

  return {
    group: g,
    setSignal(on) {
      signalOn = on;
      if (!introActive) {
        applySignal();
        if (introEndAt >= 0) {
          gavelPivot.rotation.z = signalOn ? GAVEL_UP : GAVEL_UP - GAVEL_DROP;
          gavelFallAt = -1;
        }
      }
    },
    playIntro(nowMs, reducedMotion = false) {
      introStart = nowMs;
      introEndAt = -1;
      poppedCount = 0;
      introReduced = reducedMotion;
      introActive = !reducedMotion;
      gavelFallAt = -1;
      gavelPivot.rotation.z = GAVEL_UP;
      lamps.forEach((lamp, i) => {
        lamp.material = lampMats[i];
      });
      for (const m of lampMats) m.emissiveIntensity = LAMP_WAIT;
      if (signalLight) signalLight.intensity = 0;
      arcMat.opacity = 0;
      if (reducedMotion) finishIntro(nowMs);
    },
    setRationale(text) {
      rationaleText = text;
      const c2 = rationaleCanvas.getContext("2d");
      if (c2) {
        c2.fillStyle = "#e9dfc4";
        c2.fillRect(0, 0, 256, 84);
        c2.strokeStyle = "#8a7a44";
        c2.strokeRect(4, 4, 248, 76);
        c2.textAlign = "center";
        c2.fillStyle = "#20190f";
        c2.font = "700 15px monospace";
        c2.fillText("OUT — BASIS", 128, 20);
        c2.fillStyle = "#5a4a28";
        c2.font = "400 11px monospace";
        const words = (text ?? "").split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
          if ((line + " " + w).trim().length > 32 && line) {
            lines.push(line.trim());
            line = w;
          } else line = `${line} ${w}`;
        }
        if (line.trim()) lines.push(line.trim());
        lines.slice(0, 3).forEach((l, li) => c2.fillText(l, 128, 40 + li * 13));
      }
      rationaleTex.needsUpdate = true;
    },
    setEvidenceArc(anchorWorld) {
      if (!anchorWorld) {
        arcAnchor = null;
        return;
      }
      if (!arcAnchor) {
        arcAnchor = anchorWorld.clone();
      } else if (arcAnchor.distanceToSquared(anchorWorld) <= 1e-6) {
        return;
      } else {
        arcAnchor.copy(anchorWorld);
      }
      arcDirty = true;
    },
    update(nowMs) {
      if (introActive) {
        const t = nowMs - introStart;
        for (let i = 0; i < lampMats.length; i++) {
          const local = t - i * BID_STEP_MS;
          lampMats[i].emissiveIntensity = local < 0 ? LAMP_WAIT : LAMP_IDLE + LAMP_POP * Math.max(0, 1 - local / LAMP_POP_MS);
          if (local >= 0 && poppedCount <= i) {
            poppedCount = i + 1;
            this.onPodPop?.(i);
          }
        }
        if (t >= INTRO_MS) finishIntro(introStart + INTRO_MS);
      }
      if (gavelFallAt >= 0) {
        const gt = Math.min(1, Math.max(0, (nowMs - gavelFallAt) / GAVEL_FALL_MS));
        gavelPivot.rotation.z = GAVEL_UP - easeInOutCubic(gt) * GAVEL_DROP;
        if (gt >= 1) {
          gavelFallAt = -1;
          strikeT0 = nowMs;
          this.onGavel?.();
        }
      }
      if (strikeT0 >= 0) {
        const st = (nowMs - strikeT0) / 550;
        if (st >= 1) {
          strikeT0 = -1;
          strikeRing.visible = false;
        } else {
          strikeRing.visible = true;
          const s = 0.3 + st * 1.6;
          strikeRing.scale.set(s, s, s);
          strikeMat.opacity = 0.75 * (1 - st);
        }
      }
      if (arcDirty) {
        rebuildArc();
        arcDirty = false;
      }
      if (arcMesh) {
        const show = arcAnchor !== null && introEndAt >= 0;
        arcMesh.visible = show;
        if (show) {
          arcMat.opacity = ARC_OPACITY * (introReduced ? 1 : Math.min(1, Math.max(0, (nowMs - introEndAt) / ARC_FADE_MS)));
        }
      }
      rationaleMat.opacity = rationaleText && !signalOn && introEndAt >= 0 ? Math.min(1, (nowMs - introEndAt) / 900) : 0;
      const arcOn = arcMesh?.visible === true;
      beads.forEach((b, i) => {
        b.visible = arcOn;
        if (arcOn && arcCurve) {
          arcCurve.getPoint((nowMs * 0.00035 + i / beads.length) % 1, b.position);
        }
      });
    },
  };
}
