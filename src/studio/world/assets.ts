import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { StudioCondition, StudioSpec } from "../scene";
import { disposeObject, scuffAlpha, wearRoughness } from "./materials";

const SHELL_COLORS: Record<StudioSpec["shellColor"], number> = {
  oxblood: 0x5a2a22,
  charcoal: 0x35302f,
  stone: 0x8f887c,
};

export type ItemAssetSource = { kind: "procedural" } | { kind: "glb"; url: string };
export const ITEM_SOURCE: ItemAssetSource = { kind: "procedural" };
export const ITEM_SOURCE_LABEL = "procedural proxy · no source photos · not a reconstruction";

export interface BuiltItem {
  kind: StudioSpec["object"];
  group: THREE.Group;
  anchors: THREE.Vector3[];
  anchorLabels: string[];
  refresh(spec: StudioSpec, cond: StudioCondition): void;
  dispose(): void;
}

function labelTexture(spec: StudioSpec, cond: StudioCondition): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const g = c.getContext("2d");
  if (!g) return new THREE.CanvasTexture(c);
  g.fillStyle = "#dfd2a8";
  g.fillRect(0, 0, 512, 288);
  for (let i = 0; i < 240; i++) {
    const x = (i * 37) % 512;
    const y = (i * 53) % 288;
    g.fillStyle = `rgba(${i % 2 ? "120,100,60" : "255,250,230"},${0.05 + (i % 3) * 0.03})`;
    g.fillRect(x, y, 1 + (i % 3), 1);
  }
  const age = g.createRadialGradient(256, 144, 90, 256, 144, 330);
  age.addColorStop(0, "rgba(120,90,30,0)");
  age.addColorStop(1, "rgba(120,90,30,0.16)");
  g.fillStyle = age;
  g.fillRect(0, 0, 512, 288);
  g.fillStyle = "#b8903f";
  g.fillRect(0, 0, 512, 44);
  g.fillStyle = "#1c140a";
  g.font = "900 34px monospace";
  g.fillText(spec.title.slice(0, 30).toUpperCase(), 24, 92, 464);
  g.font = "400 20px monospace";
  g.fillStyle = "#3f3212";
  g.fillText("SAMPLE ITEM — SCENARIO, UNVERIFIED", 24, 132);
  g.strokeStyle = "#7a6230";
  g.lineWidth = 2;
  g.strokeRect(14, 14, 484, 260);
  g.beginPath();
  g.arc(452, 216, 30, 0, Math.PI * 2);
  g.fillStyle = "#efe6c8";
  g.fill();
  g.strokeStyle = "#a03428";
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#a03428";
  g.font = "700 20px monospace";
  g.textAlign = "center";
  g.fillText("LOT", 452, 212);
  g.font = "900 26px monospace";
  g.fillText("07", 452, 238);
  g.textAlign = "left";
  if (cond !== "clean") {
    g.strokeStyle = "rgba(90, 74, 30, 0.55)";
    for (let i = 0; i < (cond === "torn" ? 14 : 6); i++) {
      const x = 40 + ((i * 73) % 430);
      const y = 170 + ((i * 41) % 90);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 14 + (i % 3) * 10, y + 3 + (i % 2) * 7);
      g.stroke();
    }
    g.fillStyle = "rgba(60, 50, 20, 0.12)";
    g.fillRect(300, 150, 190, 110);
  }
  if (cond === "torn") {
    g.fillStyle = `#${SHELL_COLORS[spec.shellColor].toString(16).padStart(6, "0")}`;
    g.beginPath();
    g.moveTo(400, 10);
    g.lineTo(502, 10);
    g.lineTo(502, 100);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(60, 50, 20, 0.4)";
    g.beginPath();
    g.moveTo(400, 10);
    g.lineTo(502, 100);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function buildCartridge(spec: StudioSpec, cond: StudioCondition): BuiltItem {
  const group = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: SHELL_COLORS[spec.shellColor], roughness: 0.6, metalness: 0.05, roughnessMap: wearRoughness() });
  const recessMat = new THREE.MeshStandardMaterial({ color: SHELL_COLORS[spec.shellColor], roughness: 0.6, metalness: 0.05 });
  recessMat.color.multiplyScalar(0.75);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x161216, roughness: 0.9 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.15, 1.05, 0.16, 3, 0.03), shellMat);
  body.position.y = -0.125;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const shoulders = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.26, 0.16, 3, 0.03), shellMat);
  shoulders.position.y = 0.52;
  shoulders.castShadow = shoulders.receiveShadow = true;
  group.add(shoulders);
  const seamLo = new THREE.Mesh(new THREE.BoxGeometry(1.158, 1.05, 0.017), darkMat);
  seamLo.position.y = -0.125;
  group.add(seamLo);
  const seamHi = new THREE.Mesh(new THREE.BoxGeometry(0.868, 0.26, 0.017), darkMat);
  seamHi.position.y = 0.52;
  group.add(seamHi);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.68, 0.004), recessMat);
  recess.position.set(0, 0.06, 0.0805);
  group.add(recess);
  for (const ry of [0.06 + 0.355, 0.06 - 0.355]) {
    const rimStrip = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.035, 0.006), darkMat);
    rimStrip.position.set(0, ry, 0.0825);
    group.add(rimStrip);
  }
  for (const rx of [-0.525, 0.525]) {
    const rimStrip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.72, 0.006), darkMat);
    rimStrip.position.set(rx, 0.06, 0.0825);
    group.add(rimStrip);
  }
  let labelTex = labelTexture(spec, cond);
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.8 });
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.56, 0.012), labelMat);
  label.position.set(0, 0.06, 0.084);
  group.add(label);
  const gripBand = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.34, 0.006), darkMat);
  gripBand.position.set(0, -0.45, 0.0815);
  group.add(gripBand);
  const scuffMat = new THREE.MeshStandardMaterial({
    map: scuffAlpha(), transparent: true, roughness: 0.5, metalness: 0.1,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false,
  });
  const scuffFront = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.14), scuffMat);
  scuffFront.position.set(-0.34, 0.44, 0.0812);
  scuffFront.rotation.z = 0.25;
  group.add(scuffFront);
  const scuffSide = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.4), scuffMat);
  scuffSide.position.set(0.5795, -0.18, 0);
  scuffSide.rotation.y = Math.PI / 2;
  group.add(scuffSide);
  for (let i = 0; i < 5; i++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.04), shellMat);
    ridge.position.set(0, -0.3 - i * 0.075, 0.075);
    group.add(ridge);
  }
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.15), darkMat);
  slot.position.set(0, -0.622, 0);
  group.add(slot);
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 });
  for (let i = 0; i < 10; i++) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.12), fingerMat);
    finger.position.set(-0.315 + i * 0.07, -0.615, 0);
    group.add(finger);
  }
  const screwMat = new THREE.MeshStandardMaterial({ color: 0x6e6862, roughness: 0.35, metalness: 0.8 });
  for (const [x, y] of [[-0.42, -0.5], [0.42, -0.5], [0, 0.58]] as const) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), screwMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, y, -0.085);
    group.add(screw);
  }
  const peelGeo = new THREE.PlaneGeometry(0.16, 0.13, 6, 2);
  const pp = peelGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const t = (pp.getX(i) + 0.08) / 0.16;
    pp.setZ(i, 0.075 * t * t);
  }
  peelGeo.computeVertexNormals();
  const peel = new THREE.Mesh(peelGeo, new THREE.MeshStandardMaterial({ color: 0xe9dfae, roughness: 0.85, side: THREE.DoubleSide }));
  peel.position.set(0.39, 0.29, 0.088);
  peel.rotation.z = -0.95;
  peel.visible = cond === "torn";
  group.add(peel);
  const item: BuiltItem = {
    kind: "cartridge",
    group,
    anchors: [new THREE.Vector3(0.38, 0.3, 0.1), new THREE.Vector3(0.57, -0.1, 0.02)],
    anchorLabels: [spec.evidenceLabel, "shell edge"],
    refresh(s, c) {
      shellMat.color.setHex(SHELL_COLORS[s.shellColor]);
      recessMat.color.setHex(SHELL_COLORS[s.shellColor]).multiplyScalar(0.75);
      peel.visible = c === "torn";
      item.anchorLabels[0] = s.evidenceLabel;
      const next = labelTexture(s, c);
      labelMat.map = next;
      labelMat.needsUpdate = true;
      labelTex.dispose();
      labelTex = next;
    },
    dispose() {
      disposeObject(group);
    },
  };
  return item;
}

function buildVase(spec: StudioSpec, cond: StudioCondition): BuiltItem {
  const group = new THREE.Group();
  const profile: [number, number][] = [
    [0.0, 0.0], [0.34, 0.0], [0.4, 0.06], [0.3, 0.22], [0.22, 0.5],
    [0.2, 0.72], [0.26, 0.92], [0.24, 1.02], [0.3, 1.1], [0.28, 1.16],
  ];
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const vaseMat = new THREE.MeshStandardMaterial({ color: SHELL_COLORS[spec.shellColor], roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide });
  const vase = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), vaseMat);
  vase.castShadow = vase.receiveShadow = true;
  group.add(vase);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.215, 0.012, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0xe8a34c, roughness: 0.4, metalness: 0.4 }),
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.62;
  group.add(band);
  const chip = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.9 }),
  );
  chip.position.set(0.24, 1.1, 0.14);
  chip.visible = cond === "chipped";
  group.add(chip);
  const item: BuiltItem = {
    kind: "generic",
    group,
    anchors: [new THREE.Vector3(0.24, 1.1, 0.14), new THREE.Vector3(0.0, 0.62, 0.22)],
    anchorLabels: [spec.evidenceLabel, "glaze band"],
    refresh(s, c) {
      vaseMat.color.setHex(SHELL_COLORS[s.shellColor]);
      item.anchorLabels[0] = s.evidenceLabel;
      chip.visible = c === "chipped";
    },
    dispose() {
      disposeObject(group);
    },
  };
  return item;
}

export function buildItem(spec: StudioSpec, cond: StudioCondition, _source: ItemAssetSource = ITEM_SOURCE): BuiltItem {
  return spec.object === "cartridge" ? buildCartridge(spec, cond) : buildVase(spec, cond);
}
