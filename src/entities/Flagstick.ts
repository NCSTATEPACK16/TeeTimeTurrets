import * as THREE from "three";
import { PIN_SHAPE } from "../sim/entities/Pin";
import { CUP_RADIUS } from "../sim/terrain";
import type { Terrain } from "../sim/terrain";

/**
 * The pin at the cup: a tapered pole, a ferrule band, the cup itself, and a pennant.
 *
 * **Procedural TypeScript rather than a Blender graph, unlike the other seven course props.**
 * `ASSET_PIPELINE.md` §2.2's route rule asks who owns the shape: for the rider it is Blender,
 * because he never moves; for a ragdoll it is the code that builds the bodies. The pin has a
 * collider and a sim-owned felled state, so it is a ragdoll-shaped asset -- and the graph format
 * (§4.1: six static primitive kinds, static transforms) cannot express the vertex-animated pennant
 * the §2 manifest asks for either way.
 *
 * Every number that the physics also needs comes from `PIN_SHAPE`. Nothing here re-declares the
 * pole's radius or the cup's, because a drawn pole fatter than the collider is exactly the kind of
 * disagreement that ships behind two green tests.
 *
 * Render-facing only: it owns no Rapier body and no authoritative state. `Sim` publishes
 * `pinStanding` and this poses itself to match.
 */

/** Radial segments on the pole. Eight is enough for a 5 cm-wide cylinder and puts vertices on the
 *  cardinal axes, so the drawn silhouette is exactly `PIN_SHAPE.radius` wide. */
const POLE_SEGMENTS = 8;
/** The pole tapers toward the top, as a real one does. Base radius is `PIN_SHAPE.radius`. */
const POLE_TOP_SCALE = 0.72;

/** The white band above the cup. Deliberately no wider than the collider: a bulge here would be
 *  geometry a ball can visibly pass through, since nothing outside `PIN_SHAPE.radius` deflects. */
const FERRULE_HEIGHT = 0.08;
const FERRULE_CENTRE_Y = 0.14;

/** The cup, drawn at the sim's own radius. `ground.ts` is untouched -- there is no hole in the
 *  green mesh, by design; this is what makes an arcade-sized cup legible instead of invisible. */
const CUP_RING_WIDTH = 0.07;
const CUP_FLOOR_Y = 0.008;
const CUP_RING_Y = 0.014;
const CUP_SEGMENTS = 24;

/** The pennant hangs from the top third of the pole, per the reference sheet's flag cell. */
const PENNANT_WIDTH = 0.62;
const PENNANT_HEIGHT = 0.42;
const PENNANT_TOP_Y = 2.05;
const PENNANT_SEGMENTS_X = 8;
const PENNANT_SEGMENTS_Y = 4;

/**
 * The pennant's fixed animation cycle. There is no wind system in this project and this does not
 * add one: the displacement is a function of elapsed time alone, so it is deterministic, needs no
 * state and cannot be asked what the weather is.
 */
const PENNANT_WAVE_AMPLITUDE = 0.09;
const PENNANT_WAVES = 1.4;
const PENNANT_WAVE_RATE = 3.4;

const POLE_COLOUR = 0xf2f4f0;
const FERRULE_COLOUR = 0x2b3138;
const PENNANT_COLOUR = 0xd8352a;
const CUP_RING_COLOUR = 0xf6f7f2;
const CUP_FLOOR_COLOUR = 0x14181b;

export class Flagstick extends THREE.Group {
  /**
   * Everything that falls over. The cup is deliberately outside it: knocking the pin down does not
   * move the hole, and a `setFelled` that took the cup with it would be a bug no numeric test in
   * `Flagstick.test.ts` would see.
   */
  private readonly mast: THREE.Group;
  private readonly pennant: THREE.Mesh;
  private readonly pennantPosition: THREE.BufferAttribute;
  /** The undisplaced plane, kept so `update` is a function of the clock rather than of the last
   *  frame. Reused every frame; the render loop is covered by the no-allocation rule. */
  private readonly pennantRest: Float32Array;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor() {
    super();

    this.mast = new THREE.Group();
    this.mast.name = "pin_mast";
    this.add(this.mast);

    // Base-anchored, not centre-anchored: `placeFlagstick` hands this the cup position untouched,
    // and a centre-anchored pole would need a half-height offset that the collider does need --
    // two different offsets on two sides of the same object is the shape of the 0.26 m muzzle bug.
    const pole = new THREE.CylinderGeometry(
      PIN_SHAPE.radius * POLE_TOP_SCALE,
      PIN_SHAPE.radius,
      PIN_SHAPE.height,
      POLE_SEGMENTS,
    );
    pole.translate(0, PIN_SHAPE.height / 2, 0);
    this.mast.add(this.mesh("pin_pole", pole, POLE_COLOUR, 0.55));

    const ferrule = new THREE.CylinderGeometry(
      PIN_SHAPE.radius,
      PIN_SHAPE.radius,
      FERRULE_HEIGHT,
      POLE_SEGMENTS,
    );
    ferrule.translate(0, FERRULE_CENTRE_Y, 0);
    this.mast.add(this.mesh("pin_ferrule", ferrule, FERRULE_COLOUR, 0.7));

    const pennantGeometry = new THREE.PlaneGeometry(
      PENNANT_WIDTH,
      PENNANT_HEIGHT,
      PENNANT_SEGMENTS_X,
      PENNANT_SEGMENTS_Y,
    );
    // Hung by its left edge off the pole, so the anchored edge is at x = PIN_SHAPE.radius.
    pennantGeometry.translate(
      PENNANT_WIDTH / 2 + PIN_SHAPE.radius,
      PENNANT_TOP_Y - PENNANT_HEIGHT / 2,
      0,
    );
    this.pennant = this.mesh("pin_pennant", pennantGeometry, PENNANT_COLOUR, 0.85, THREE.DoubleSide);
    this.mast.add(this.pennant);

    this.pennantPosition = pennantGeometry.getAttribute("position") as THREE.BufferAttribute;
    this.pennantRest = Float32Array.from(this.pennantPosition.array as Float32Array);
    // The rest plane's bounds, widened once by the wave rather than recomputed per frame. Culling
    // wants a volume that contains every pose, not the pose it happened to be built in.
    pennantGeometry.computeBoundingSphere();
    if (pennantGeometry.boundingSphere) {
      pennantGeometry.boundingSphere.radius += PENNANT_WAVE_AMPLITUDE;
    }

    const floor = new THREE.CircleGeometry(CUP_RADIUS - CUP_RING_WIDTH, CUP_SEGMENTS);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, CUP_FLOOR_Y, 0);
    this.add(this.mesh("pin_cup_floor", floor, CUP_FLOOR_COLOUR, 0.95));

    const ring = new THREE.RingGeometry(CUP_RADIUS - CUP_RING_WIDTH, CUP_RADIUS, CUP_SEGMENTS);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, CUP_RING_Y, 0);
    this.add(this.mesh("pin_cup_ring", ring, CUP_RING_COLOUR, 0.8));

    this.update(0);
  }

  /**
   * Advance the pennant to `elapsedSeconds`. Absolute time, not a delta: a pose that is a pure
   * function of the clock cannot drift out of step with anything, and the same second always
   * produces the same flag.
   */
  update(elapsedSeconds: number): void {
    const rest = this.pennantRest;
    const array = this.pennantPosition.array as Float32Array;
    const phase = elapsedSeconds * PENNANT_WAVE_RATE;
    for (let i = 0; i < array.length; i += 3) {
      // Distance from the pole as a fraction of the flag, so the hoist edge never leaves the pole
      // and the free edge travels furthest -- a flag pivots about where it is tied on.
      const along = (rest[i]! - PIN_SHAPE.radius) / PENNANT_WIDTH;
      array[i + 2] =
        PENNANT_WAVE_AMPLITUDE * along * Math.sin(along * PENNANT_WAVES * Math.PI * 2 - phase);
    }
    this.pennantPosition.needsUpdate = true;
  }

  /**
   * Lays the pin down, or stands it back up. Down rather than hidden, on purpose: a felled pin is
   * lying on the green and the player has to be able to see that it is -- that is the whole read
   * on why the putting line is suddenly clear.
   *
   * The cloth ends up on its edge rather than draped, which a real one would not. Left as it is:
   * righting it needs a second pivot whose only effect is on a 0.4 m flag lying on a 160 m field.
   */
  setFelled(felled: boolean): void {
    this.mast.rotation.z = felled ? -Math.PI / 2 : 0;
    // Lifted by the pole's own radius when down, so it lies *on* the green rather than half in it.
    this.mast.position.y = felled ? PIN_SHAPE.radius : 0;
  }

  /** Call once before this instance is discarded: frees geometries/materials, per AGENTS.md. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.clear();
  }

  private mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    colour: number,
    roughness: number,
    side: THREE.Side = THREE.FrontSide,
  ): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness, side, flatShading: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    this.geometries.push(geometry);
    this.materials.push(material);
    return mesh;
  }
}

/**
 * Puts the drawn pin where the simulation says the hole is.
 *
 * Exported rather than inlined into `RenderScene` for the same reason `placeCart` is: this is one
 * half of an agreement, and the other half is the collider `world.ts` builds from `PIN_SHAPE` at
 * `terrain.cupPosition`. A test that copied this line would agree with its own copy. It is also
 * what lets `backdrop.ts` place the pin identically without a `Sim` in sight.
 */
export function placeFlagstick(flagstick: Flagstick, terrain: Terrain): void {
  const cup = terrain.cupPosition;
  flagstick.position.set(cup.x, cup.y, cup.z);
}
