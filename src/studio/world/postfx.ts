import type { PerspectiveCamera, Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";

export interface PostFX {
  render(): void;
}

// WebGPU node-material chain: scene pass → bloom → vignette → film grain.
// Returns null when the node pipeline cannot be built; callers fall back to a
// plain render.
export async function createPostFX(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): Promise<PostFX | null> {
  try {
    const [{ PostProcessing }, tsl, { bloom }, { film }] = await Promise.all([
      import("three/webgpu"),
      import("three/tsl"),
      import("three/examples/jsm/tsl/display/BloomNode.js"),
      import("three/examples/jsm/tsl/display/FilmNode.js"),
    ]);
    const pipeline = new PostProcessing(renderer as never);
    const scenePass = tsl.pass(scene, camera);
    const color = scenePass.getTextureNode();
    const graded = color
      .add(bloom(color, 0.30, 0.22, 0.82))
      .mul(tsl.smoothstep(0.88, 0.52, tsl.length(tsl.uv().sub(tsl.vec2(0.5)))));
    pipeline.outputNode = film(graded, tsl.float(0.09));
    return pipeline;
  } catch {
    return null;
  }
}
