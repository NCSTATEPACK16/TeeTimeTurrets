import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { QualityPreset } from "./quality";

/**
 * Post-processing, High only. Low and Medium draw straight to the canvas (Medium with MSAA), so
 * they pay for no extra render targets at all.
 *
 * On High the scene draws into a half-float target, ambient occlusion and a light bloom work in
 * linear light, `OutputPass` applies the renderer's tone mapping and sRGB conversion, and SMAA
 * antialiases last, on the display-referred image it was designed for.
 */

export type PostPass = "render" | "ao" | "bloom" | "output" | "smaa";

/** Bloom stays a glint on the sun-lit flag and muzzle flash, never a haze over the course. */
const BLOOM = { strength: 0.18, radius: 0.35, threshold: 0.9 } as const;

export function postPassesFor(preset: QualityPreset): PostPass[] {
  if (!preset.ao && !preset.bloom && !preset.smaa) return [];
  const passes: PostPass[] = ["render"];
  if (preset.ao) passes.push("ao");
  if (preset.bloom) passes.push("bloom");
  passes.push("output");
  if (preset.smaa) passes.push("smaa");
  return passes;
}

export interface Post {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** The composer for `preset`, or null when the preset draws straight to the canvas. */
export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  preset: QualityPreset,
): Post | null {
  const names = postPassesFor(preset);
  if (names.length === 0) return null;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  for (const name of names) {
    switch (name) {
      case "render":
        composer.addPass(new RenderPass(scene, camera));
        break;
      case "ao":
        composer.addPass(new GTAOPass(scene, camera, size.x, size.y));
        break;
      case "bloom":
        composer.addPass(new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
        break;
      case "output":
        composer.addPass(new OutputPass());
        break;
      case "smaa":
        composer.addPass(new SMAAPass());
        break;
    }
  }

  return {
    render(): void {
      composer.render();
    },
    setSize(width: number, height: number): void {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    dispose(): void {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
