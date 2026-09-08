import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The one place a `.glb` may be loaded, and the only place `GLTFLoader` is imported.
 *
 * `AGENTS.md` bans mesh files from the playable path absolutely, and `ASSET_PIPELINE.md` section 1
 * draws the line mechanically: **if removing the asset would change a simulation result, it is
 * playable.** A clubhouse wall behind a menu turntable is collided with by nothing, replicated to
 * nobody and read by no code under `src/sim/**`, so it is decorative and may ship as an authored
 * mesh. That test is the reason this module exists as its own file rather than as an import
 * inside a screen -- there is exactly one door, and it is easy to audit.
 *
 * Section 6 step 5 sets the contract: **a decorative asset that fails to load must degrade to
 * nothing, never throw.** It is decoration; the game must run without it. So this resolves to
 * `null` on every failure path and logs a warning rather than rejecting, and every caller treats
 * a null as "no backdrop today".
 */

export interface Decor {
  readonly object: THREE.Object3D;
  dispose(): void;
}

/**
 * Loads a decorative GLB. Never rejects.
 *
 * Callers should not await this before their first render: section 6 step 7 requires decoration
 * not to block first paint, so the intended use is to fire it off and add the result to the scene
 * whenever it arrives -- possibly never.
 */
export async function loadDecor(url: string): Promise<Decor | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const object = gltf.scene;
    if (!object) return null;

    // Decoration never casts or receives the showroom's shadows: it sits well outside the key
    // light's shadow camera, and including it would spend the whole shadow map's resolution on
    // walls instead of on the cart the screen is actually about.
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return {
      object,
      dispose(): void {
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((m) => disposeMaterial(m));
          else disposeMaterial(material);
        });
        object.removeFromParent();
      },
    };
  } catch (error) {
    console.warn(`decorative asset "${url}" did not load; continuing without it`, error);
    return null;
  }
}

/** Frees a material and any textures it holds -- `Material.dispose()` does not free those. */
function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}
