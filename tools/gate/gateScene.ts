import * as THREE from "three";
import { BALL_RADIUS, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS } from "../../src/entities/BallSwarm";
import { Flagstick } from "../../src/entities/Flagstick";
import { GolfClub } from "../../src/entities/GolfClub";
import { TargetRig } from "../../src/entities/TargetRig";
import { ClubType } from "../../src/physics/Ballistics";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "../../src/sim/entities/Target";
import { TRANSFORM_STRIDE } from "../../src/sim/world";

/**
 * One subject, one fixed rig. No Sim, no terrain, no input, no randomness -- AGENTS.md's Scene
 * Gate step 1 asks for a fixed camera and fixed lighting, and the game provides neither: its
 * camera chases the cart and its course is generated per seed.
 *
 * Every subject is built by the same code the game ships, so the gate measures shipped geometry
 * rather than a copy of it that could drift out of step with the real thing.
 */

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 360;

/** Matches tools/gateCompare.mjs. Duplicated because that module is plain JS with no types. */
const SIGNATURE_WIDTH = 64;
const SIGNATURE_HEIGHT = 36;

/** Fixed three-quarter view: shows a silhouette's depth as well as its profile. */
const CAMERA_DIRECTION = new THREE.Vector3(1, 0.55, 1.35).normalize();
/** Multiplier on the subject's bounding sphere radius, so every subject is framed identically. */
const CAMERA_DISTANCE_SCALE = 2.6;

interface GateSubject {
  object: THREE.Object3D;
  dispose(): void;
}

const SUBJECTS: Record<string, () => GateSubject> = {
  "cart-driver": () => clubSubject(ClubType.Driver),
  "cart-iron": () => clubSubject(ClubType.Iron),
  "cart-putter": () => clubSubject(ClubType.Putter),
  "cart-backswing": () => clubSubject(ClubType.Driver, 1, 1),
  "cart-empty": () => clubSubject(ClubType.Driver, 0, 1, false),
  "cart-followthrough": () => clubSubject(ClubType.Driver, 0, 0.09),
  ball: () => ballSubject(),
  target: () => targetSubject(),
  flagstick: () => flagstickSubject(false),
  "flagstick-felled": () => flagstickSubject(true),
};

/**
 * The three extra cart subjects are here because the three club subjects cannot see what they
 * are for. All three ship every club head and swap `visible`, so they already report identical
 * vertex counts (ASSET_PIPELINE.md section 9); they also all draw the cart at address with a
 * rider aboard. Nothing in the gate would notice a swing that had stopped moving, or a rider who
 * had silently vanished, without subjects that differ in exactly that.
 *
 * `cart-followthrough` is the pose that constrains the design: it is where the shaft comes
 * closest to the canopy and the rider. `GolfClub.test.ts` proves it clears them in geometry;
 * this proves it still looks right.
 */
function clubSubject(club: ClubType, charge01 = 0, reload01 = 1, rider = true): GateSubject {
  const cart = new GolfClub(club, {}, { rider });
  cart.setSwing(charge01, reload01);
  return { object: cart, dispose: () => cart.dispose() };
}

/** The same sphere render/scene.ts builds for the course ball: same radius and same segment
 *  counts, imported rather than copied, so a tesselation change there can't drift out from
 *  under what this subject measures. */
function ballSubject(): GateSubject {
  const geometry = new THREE.SphereGeometry(BALL_RADIUS, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * One target in its rest pose, posed from TARGET_PART_SHAPES' own rest offsets rather than from a
 * live Sim -- the gate must not need Rapier, a terrain or a seed to render a subject.
 */
function targetSubject(): GateSubject {
  const rig = new TargetRig(1);
  const transforms = new Float32Array(PARTS_PER_TARGET * TRANSFORM_STRIDE);
  for (let i = 0; i < TARGET_PART_SHAPES.length; i++) {
    const offset = TARGET_PART_SHAPES[i]!.restOffset;
    const flat = i * TRANSFORM_STRIDE;
    transforms[flat] = offset.x;
    transforms[flat + 1] = offset.y;
    transforms[flat + 2] = offset.z;
    transforms[flat + 6] = 1; // identity quaternion
  }
  rig.setFromTransforms(transforms, PARTS_PER_TARGET);
  return { object: rig, dispose: () => rig.dispose() };
}

/**
 * The pin, standing and felled.
 *
 * Two subjects because the poses are **indistinguishable in every numeric check** -- same meshes,
 * same triangles, same vertices, and a bounding box that only swaps its axes -- and obviously
 * different in the PNG. That is exactly what a gate picture is for, and the same reason
 * `cart-backswing` and `cart-followthrough` exist.
 *
 * Buildable with no Rapier, no terrain and no seed, which is what the gate requires: `Flagstick`
 * owns the geometry and `placeFlagstick` owns where it goes, so the two are separable. The pennant
 * is advanced to a fixed time rather than left at rest, so the gate measures the flag it ships with
 * -- and to a *constant*, so the signature does not depend on when the run happened.
 */
function flagstickSubject(felled: boolean): GateSubject {
  const pin = new Flagstick();
  pin.setFelled(felled);
  pin.update(GATE_PENNANT_SECONDS);
  return { object: pin, dispose: () => pin.dispose() };
}

/** Off the wave's zero crossing, so the flag in the picture is actually flying. */
const GATE_PENNANT_SECONDS = 0.35;

function countGeometry(root: THREE.Object3D): { vertices: number; triangles: number } {
  let vertices = 0;
  let triangles = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean; count?: number };
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    // An InstancedMesh draws its one geometry `count` times; counting it once would let a
    // change in instance count slip past the gate entirely.
    const instances = typeof mesh.count === "number" ? mesh.count : 1;
    vertices += position.count * instances;
    const index = mesh.geometry.getIndex();
    triangles += ((index ? index.count : position.count) / 3) * instances;
  });
  return { vertices, triangles };
}

function main(): void {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("subject") ?? "cart-driver";
  const build = SUBJECTS[name];
  if (!build) throw new Error(`unknown gate subject: ${name} (have ${Object.keys(SUBJECTS).join(", ")})`);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  // Pixel ratio is pinned to 1, never devicePixelRatio: the signature must not depend on the
  // display the gate happens to run against.
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW_WIDTH, VIEW_HEIGHT);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202428);

  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(12, 18, 8);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const subject = build();
  scene.add(subject.object);

  const box = new THREE.Box3().setFromObject(subject.object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;

  const camera = new THREE.PerspectiveCamera(45, VIEW_WIDTH / VIEW_HEIGHT, 0.01, radius * 100);
  camera.position.copy(centre).addScaledVector(CAMERA_DIRECTION, radius * CAMERA_DISTANCE_SCALE);
  camera.lookAt(centre);

  renderer.render(scene, camera);

  const counts = countGeometry(subject.object);

  // Read the pixels back through a 2D canvas rather than gl.readPixels: drawImage does the
  // downsample in one step, and the browser's own box filter is the averaging the signature
  // relies on to shrug off antialiasing noise.
  const scratch = document.createElement("canvas");
  scratch.width = SIGNATURE_WIDTH;
  scratch.height = SIGNATURE_HEIGHT;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("gate harness could not get a 2d context for the signature");

  (window as unknown as { __gate: unknown }).__gate = {
    ready: true,
    subject: name,
    subjects: Object.keys(SUBJECTS),
    metrics: () => ({
      vertices: counts.vertices,
      triangles: counts.triangles,
      bbox: { x: size.x, y: size.y, z: size.z },
    }),
    signature: () => {
      ctx.clearRect(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      ctx.drawImage(renderer.domElement, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      const data = ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
      const out: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        out.push(data[i]!, data[i + 1]!, data[i + 2]!);
      }
      return out;
    },
    dispose: () => subject.dispose(),
  };
}

main();
