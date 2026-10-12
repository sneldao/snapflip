import * as THREE from "three";

export interface MarkerBinding {
  el: HTMLElement;
  anchor: THREE.Vector3;
  label: string;
  gated?: boolean;
}

// Occlusion is a raycast against the whole item, so it is refreshed on a
// cadence (or when marked dirty) instead of every frame. Projection is cheap
// and runs every frame.
const OCCLUSION_EVERY = 3;

export class MarkerLayer {
  private bindings: MarkerBinding[] = [];
  private occluded: boolean[] = [];
  private raycaster = new THREE.Raycaster();
  private world = new THREE.Vector3();
  private proj = new THREE.Vector3();
  private camDir = new THREE.Vector3();
  private frame = 0;
  private dirty = true;

  set(bindings: { el: HTMLElement; gated?: boolean }[], anchors: THREE.Vector3[], labels: string[]) {
    this.bindings = bindings.map((b, i) => {
      const label = labels[i] ?? "";
      const labelEl = b.el.querySelector("span:last-child");
      if (labelEl) labelEl.textContent = label;
      return { el: b.el, anchor: anchors[i] ?? new THREE.Vector3(), label, gated: b.gated ?? false };
    });
    this.occluded = this.bindings.map(() => false);
    this.dirty = true;
  }

  // Re-reads anchors and labels after the item was rebuilt or an anchor moved.
  rebind(anchors: THREE.Vector3[], labels: string[]) {
    this.bindings.forEach((mk, i) => {
      mk.anchor = anchors[i] ?? mk.anchor;
      mk.label = labels[i] ?? mk.label;
      const labelEl = mk.el.querySelector("span:last-child");
      if (labelEl) labelEl.textContent = mk.label;
    });
    this.dirty = true;
  }

  // Fog-of-war lift: first evidence interaction reveals the full marker layer.
  unlock() {
    for (const mk of this.bindings) mk.gated = false;
  }

  invalidate() {
    this.dirty = true;
  }

  update(camera: THREE.Camera, item: THREE.Object3D, width: number, height: number, show: boolean) {
    const tick = this.frame++ % OCCLUSION_EVERY === 0;
    const refresh = this.dirty || tick;
    this.dirty = false;
    this.bindings.forEach((mk, i) => {
      if (!show || mk.gated) {
        mk.el.style.display = "none";
        return;
      }
      this.world.copy(mk.anchor).applyMatrix4(item.matrixWorld);
      this.proj.copy(this.world).project(camera);
      if (refresh) this.occluded[i] = this.isOccluded(camera, item, this.world, this.proj.z);
      mk.el.style.left = `${(this.proj.x * 0.5 + 0.5) * width}px`;
      mk.el.style.top = `${(-this.proj.y * 0.5 + 0.5) * height}px`;
      mk.el.style.display = this.occluded[i] ? "none" : "";
    });
  }

  private isOccluded(camera: THREE.Camera, item: THREE.Object3D, world: THREE.Vector3, projZ: number): boolean {
    if (projZ > 1) return true;
    const dist = world.distanceTo(camera.position);
    this.camDir.copy(world).sub(camera.position).normalize();
    this.raycaster.set(camera.position, this.camDir);
    return this.raycaster.intersectObject(item, true).some((hit) => hit.distance < dist - 0.06);
  }
}
