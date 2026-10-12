import * as THREE from "three";

export function disposeObject(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      mats.add(mm);
      for (const key of ["map", "emissiveMap", "roughnessMap"] as const) {
        const t = (mm as THREE.MeshStandardMaterial)[key];
        if (t) texs.add(t);
      }
    }
  });
  geos.forEach((g) => g.dispose());
  texs.forEach((t) => t.dispose());
  mats.forEach((m) => m.dispose());
}

const std = (color: number, roughness: number, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

export const palette = {
  porcelain: 0xd9cfba,
  charcoal: 0x17141a,
  charcoalHi: 0x2b2630,
  timber: 0x4a3524,
  timberDark: 0x2e2016,
  steel: 0x8d9096,
  amber: 0xe8a34c,
  amberHi: 0xf5c987,
  tungsten: 0xffb45e,
  paper: 0xe9dfc4,
  ink: 0x20190f,
  red: 0xc04a32,
  ok: 0x8fb98a,
  plaster: 0xcabfa8,
  plasterDark: 0xa89a80,
  brass: 0x9c7b3f,
  coolSpill: 0x9fb4c8,
};

let grainTex: THREE.CanvasTexture | null = null;

export function woodGrain(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#4a3524";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 46; i++) {
      const y = (i * 37) % 256;
      g.strokeStyle = `rgba(${30 + (i % 4) * 8}, ${20 + (i % 3) * 6}, 12, ${0.25 + (i % 3) * 0.12})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + ((i % 5) - 2) * 3, 170, y + ((i % 7) - 3) * 2, 256, y + ((i % 4) - 2) * 4);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 36;
      g.strokeStyle = "rgba(25, 16, 9, 0.35)";
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 2, 256);
      g.stroke();
    }
  }
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  return grainTex;
}

let wearTex: THREE.CanvasTexture | null = null;

export function wearRoughness(): THREE.CanvasTexture {
  if (wearTex) return wearTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#9a9a9a";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) {
      const x = (i * 97) % 256;
      const y = (i * 61) % 256;
      const gr = g.createRadialGradient(x, y, 2, x, y, 26 + (i % 4) * 10);
      gr.addColorStop(0, `rgba(225,225,225,${0.22 + (i % 3) * 0.1})`);
      gr.addColorStop(1, "rgba(225,225,225,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, 26 + (i % 4) * 10, 12 + (i % 3) * 8, (i * 1.3) % 3.14, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = "rgba(55,55,55,0.35)";
      g.lineWidth = 8 + (i % 2) * 5;
      g.beginPath();
      g.moveTo(30 + i * 40, 190);
      g.lineTo(50 + i * 40, 256);
      g.stroke();
    }
  }
  wearTex = new THREE.CanvasTexture(c);
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping;
  return wearTex;
}

let scuffTex: THREE.CanvasTexture | null = null;

export function scuffAlpha(): THREE.CanvasTexture {
  if (scuffTex) return scuffTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 9; i++) {
      const x = 12 + ((i * 41) % 100);
      const y = 14 + ((i * 29) % 96);
      g.strokeStyle = `rgba(235,230,215,${0.35 + (i % 3) * 0.2})`;
      g.lineWidth = 1 + (i % 2) * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 14 + (i % 3) * 8, y - 4 + (i % 2) * 9, x + 30 + (i % 4) * 10, y + 2 + (i % 3) * 6);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = "rgba(240,235,220,0.5)";
      g.beginPath();
      g.arc(20 + ((i * 53) % 90), 20 + ((i * 37) % 90), 1.5 + (i % 2), 0, 7);
      g.fill();
    }
  }
  scuffTex = new THREE.CanvasTexture(c);
  return scuffTex;
}

let dialTex: THREE.CanvasTexture | null = null;

export function etchedDial(): THREE.CanvasTexture {
  if (dialTex) return dialTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(40,32,20,0.55)";
    g.lineWidth = 1.5;
    for (const r of [118, 96, 52]) {
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const long = i % 6 === 0;
      const r0 = long ? 88 : 96;
      g.lineWidth = long ? 2 : 1;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
      g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
      g.stroke();
    }
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(128, 118);
    g.lineTo(128, 138);
    g.moveTo(118, 128);
    g.lineTo(138, 128);
    g.stroke();
  }
  dialTex = new THREE.CanvasTexture(c);
  return dialTex;
}

let dustTex: THREE.CanvasTexture | null = null;

export function dustSprite(): THREE.CanvasTexture {
  if (dustTex) return dustTex;
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d");
  if (g) {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,244,220,0.9)");
    gr.addColorStop(0.4, "rgba(255,240,210,0.35)");
    gr.addColorStop(1, "rgba(255,240,210,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
  }
  dustTex = new THREE.CanvasTexture(c);
  return dustTex;
}

let coneTex: THREE.CanvasTexture | null = null;

export function coneGradient(): THREE.CanvasTexture {
  if (coneTex) return coneTex;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, "rgba(255,214,150,0.5)");
    gr.addColorStop(0.55, "rgba(255,200,130,0.12)");
    gr.addColorStop(1, "rgba(255,190,120,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 64);
  }
  coneTex = new THREE.CanvasTexture(c);
  return coneTex;
}

export const mats = {
  porcelain: () => std(palette.porcelain, 0.35),
  charcoal: () => std(palette.charcoal, 0.9),
  charcoalHi: () => std(palette.charcoalHi, 0.7),
  timber: () => std(palette.timber, 0.8),
  timberDark: () => std(palette.timberDark, 0.85),
  steel: () => std(palette.steel, 0.4, 0.7),
  paper: () => std(palette.paper, 0.9),
  timberGrain: () => new THREE.MeshStandardMaterial({ map: woodGrain(), roughness: 0.8 }),
  plaster: () => std(palette.plaster, 0.95),
  plasterDark: () => std(palette.plasterDark, 0.95),
  brass: () => std(palette.brass, 0.35, 0.6),
  coolSpill: () => new THREE.MeshStandardMaterial({ color: palette.coolSpill, emissive: 0x5f7d9e, emissiveIntensity: 0.55, roughness: 0.7 }),
  amberGlow: () => new THREE.MeshStandardMaterial({ color: palette.amber, emissive: palette.amber, emissiveIntensity: 1.2, roughness: 0.5 }),
  signalOn: () => new THREE.MeshStandardMaterial({ color: palette.amberHi, emissive: palette.amber, emissiveIntensity: 2.2, roughness: 0.4 }),
  signalOff: () => new THREE.MeshStandardMaterial({ color: 0x3a3438, emissive: 0x000000, roughness: 0.8 }),
};
