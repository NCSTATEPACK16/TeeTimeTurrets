import * as THREE from "three";
import { GolfClub } from "../entities/GolfClub";
import { loadDecor } from "./decor";
import type { Decor } from "./decor";
import type { ClubType } from "../physics/Ballistics";
import type { SlotColors } from "../entities/primitiveGraph";

/**
 * The lit turntable from image 11.
 *
 * `ASSET_PIPELINE.md` section 2.1 settles the art-direction question this screen would otherwise
 * reopen: image 11 is glossy and 15-30k triangles, image 03 is flat-shaded and 1.5-3k, and the
 * decision is **one mesh at gameplay fidelity, with the premium look coming from lighting and
 * presentation**. So the cart here is the same `GolfClub` the round uses -- not a second, nicer
 * model -- and everything below is presentation: three-point lighting, a shadow-catching floor,
 * a glowing podium ring, and a slow turn.
 *
 * That is also what makes paint swaps work at all. Two meshes would mean every cosmetic had to be
 * authored twice and could drift; one mesh means a swatch click is a material colour write.
 */

/** Radians per second. Slow enough to inspect the cart, fast enough to look alive. */
const TURN_RATE = 0.42;
const PODIUM_RADIUS = 2.4;

export interface Showroom {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Repaint the cart in place. This is what a swatch click calls. */
  setSlotColors(colors: SlotColors): void;
  setClub(club: ClubType): void;
  update(seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * The authored clubhouse interior (ASSET_PIPELINE.md section 6). Decorative: nothing collides with
 * it, nothing replicates it, and no code under src/sim/** reads it -- the section 1 test for what
 * may ship as a mesh file.
 */
const BACKDROP_URL = "models/clubhouse.glb";

export function createShowroom(initialClub: ClubType, initialColors: SlotColors = {}): Showroom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1f26);

  const cart = new GolfClub(initialClub, initialColors);
  const turntable = new THREE.Group();
  turntable.add(cart);
  scene.add(turntable);

  // --- Three-point rig. The whole "premium" of the menu is here rather than in the mesh. -----
  const key = new THREE.DirectionalLight(0xfff2e0, 3.1);
  key.position.set(4.2, 5.6, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -5;
  shadowCam.right = 5;
  shadowCam.top = 5;
  shadowCam.bottom = -5;
  scene.add(key);

  // Cool and dim, opposite the key: stops the shadow side going to flat black.
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.85);
  fill.position.set(-5.0, 2.4, 2.0);
  scene.add(fill);

  // Behind and above, to pick the roofline and the turret out of the background.
  const rim = new THREE.DirectionalLight(0xffd9a8, 2.0);
  rim.position.set(-1.6, 3.2, -5.4);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x6f7d92, 0.65));

  // --- Podium ---------------------------------------------------------------------------------
  const podiumGeo = new THREE.CylinderGeometry(PODIUM_RADIUS, PODIUM_RADIUS * 1.04, 0.18, 48);
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x2b323b, roughness: 0.55, metalness: 0.2 });
  const podium = new THREE.Mesh(podiumGeo, podiumMat);
  podium.position.y = -0.09;
  podium.receiveShadow = true;
  scene.add(podium);

  // The lit rim in image 11. Unlit material so it reads as emissive without a bloom pass.
  const ringGeo = new THREE.TorusGeometry(PODIUM_RADIUS * 1.01, 0.035, 8, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xef8a2b });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.012;
  scene.add(ring);

  // Catches the key light's shadow so the cart is planted rather than floating.
  const floorGeo = new THREE.CircleGeometry(9, 48);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x141920, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.18;
  floor.receiveShadow = true;
  scene.add(floor);

  cart.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true;
  });

  // Fired off, never awaited: section 6 step 7 says decoration must not block first render, so
  // the screen is fully usable before this arrives -- and equally usable if it never does.
  let decor: Decor | null = null;
  let disposed = false;
  void loadDecor(BACKDROP_URL).then((loaded) => {
    if (!loaded) return;
    if (disposed) {
      // The player left the clubhouse while this was in flight. Free it rather than adding it to
      // a scene nobody will render -- otherwise a fast BACK leaks one backdrop per visit.
      loaded.dispose();
      return;
    }
    decor = loaded;
    scene.add(loaded.object);
  });

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  const target = new THREE.Vector3(0, 1.05, 0);
  // Slightly above the cart's waist and off to one side: image 11's three-quarter hero angle.
  camera.position.set(5.1, 3.0, 5.9);
  camera.lookAt(target);

  return {
    scene,
    camera,
    setSlotColors(colors) {
      cart.setSlotColors(colors);
    },
    setClub(club) {
      cart.setClub(club);
    },
    update(seconds) {
      turntable.rotation.y += TURN_RATE * seconds;
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      decor?.dispose();
      decor = null;
      cart.dispose();
      podiumGeo.dispose();
      podiumMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      scene.clear();
    },
  };
}
