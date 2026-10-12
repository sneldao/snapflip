import * as THREE from "three";

// Gaussian-splat hero overlay: loads .splat / .ksplat / .ply / .spz
// reconstructions as a visual skin over the procedural proxy (which stays in
// the graph for anchors, raycast occlusion, and drag). Requires a
// node-material-capable renderer (WebGPURenderer on either backend); callers
// must gate on backend support. .spz is Niantic/World Labs' compressed format.

export async function loadSplat(url: string): Promise<THREE.Mesh | null> {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  let geometry: THREE.BufferGeometry;
  try {
    if (ext === "spz") {
      const { SPZLoader } = await import("three/addons/loaders/SPZLoader.js");
      geometry = await new SPZLoader().loadAsync(url);
    } else if (ext === "splat") {
      const { SPLATLoader } = await import("three/addons/loaders/SPLATLoader.js");
      geometry = await new SPLATLoader().loadAsync(url);
    } else if (ext === "ksplat") {
      const { KSPLATLoader } = await import("three/addons/loaders/KSPLATLoader.js");
      geometry = await new KSPLATLoader().loadAsync(url);
    } else if (ext === "ply") {
      const { GaussianSplatPLYLoader } = await import("three/addons/loaders/GaussianSplatPLYLoader.js");
      geometry = await new GaussianSplatPLYLoader().loadAsync(url);
    } else {
      return null;
    }
    const { GaussianSplat } = await import("three/addons/objects/GaussianSplat.js");
    return new GaussianSplat(geometry);
  } catch {
    return null;
  }
}

// Fits a loaded splat to a target object's bounding box, in the parent's
// local space. Bounds come from the source splat geometry — the rendered
// mesh's own bounds are a flat billboard quad, not the capture volume.
// Returns false if bounds can't be computed.
export function fitSplatToObject(splat: THREE.Mesh, target: THREE.Object3D): boolean {
  const src = ((splat as { splatGeometry?: THREE.BufferGeometry }).splatGeometry ?? splat.geometry);
  src.computeBoundingBox();
  const sbox = src.boundingBox;
  if (!sbox || sbox.isEmpty()) return false;
  const tbox = new THREE.Box3().setFromObject(target);
  if (tbox.isEmpty()) return false;
  const ssize = sbox.getSize(new THREE.Vector3());
  const tsize = tbox.getSize(new THREE.Vector3());
  const ratios = [ssize.x, ssize.y, ssize.z].map((s, i) => (s > 0 ? tsize.getComponent(i) / s : Infinity));
  const scale = Math.min(...ratios);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  splat.scale.setScalar(scale);
  const scenter = sbox.getCenter(new THREE.Vector3());
  const tcenter = tbox.getCenter(new THREE.Vector3());
  target.worldToLocal(tcenter);
  splat.position.copy(tcenter).sub(scenter.multiplyScalar(scale));
  return true;
}

// Fits a loaded splat into an arbitrary world-space box (chapter-scale use:
// a photographed room standing in for authored backdrop geometry). The
// returned mesh is positioned in world coordinates — add it to the scene.
export function fitSplatToBox(splat: THREE.Mesh, tbox: THREE.Box3): boolean {
  const src = ((splat as { splatGeometry?: THREE.BufferGeometry }).splatGeometry ?? splat.geometry);
  src.computeBoundingBox();
  const sbox = src.boundingBox;
  if (!sbox || sbox.isEmpty() || tbox.isEmpty()) return false;
  const ssize = sbox.getSize(new THREE.Vector3());
  const tsize = tbox.getSize(new THREE.Vector3());
  const ratios = [ssize.x, ssize.y, ssize.z].map((s, i) => (s > 0 ? tsize.getComponent(i) / s : Infinity));
  const scale = Math.min(...ratios);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  splat.scale.setScalar(scale);
  const scenter = sbox.getCenter(new THREE.Vector3());
  const tcenter = tbox.getCenter(new THREE.Vector3());
  splat.position.copy(tcenter).sub(scenter.multiplyScalar(scale));
  return true;
}
