import type RAPIER from '@dimforge/rapier3d-compat';
import type { Pose } from '@gcs/level-schema';
import { HeightSampler } from '../level/heightSampler';
import type { Level } from '../level/loadLevel';
import { PathSampler } from '../level/pathSampler';
import { SurfaceSampler } from '../level/surfaceSampler';
import { treeConfig, trunkFor } from '../level/treeConfig';
import { WaterSampler } from '../level/waterSampler';
import { MODES, type ModeConfig, type ModeName } from '../modes/modes';
import { createBoundaryColliders } from '../physics/boundaryColliders';
import { createHeightfieldCollider } from '../physics/heightfieldCollider';
import { FIXED_DT } from '../physics/physicsConfig';
import { createWorld, initRapier, type Rapier } from '../physics/world';
import type { CartTuning } from '../vehicle/cartTuning';
import { RapierCart } from '../vehicle/RapierCart';
import type { VehicleInput } from '../vehicle/VehicleModel';

/**
 * The physics side of the game: level colliders plus the cart, stepped at a fixed 60 Hz.
 * The browser loop and the headless tests drive this same object.
 */
export class Simulation {
  readonly heights: HeightSampler;
  readonly surfaces: SurfaceSampler;
  readonly water: WaterSampler;
  readonly paths: PathSampler;
  stepCount = 0;
  /** Wall-clock milliseconds spent in the most recent step. */
  lastStepMs = 0;
  /** Set on the step the Chill water respawn moved the cart. */
  respawned = false;
  private modeName: ModeName;

  private constructor(
    readonly level: Level,
    readonly world: RAPIER.World,
    readonly terrain: RAPIER.Collider,
    readonly trunks: number,
    readonly cart: RapierCart,
    samplers: { heights: HeightSampler; surfaces: SurfaceSampler; water: WaterSampler; paths: PathSampler },
    mode: ModeName,
  ) {
    this.heights = samplers.heights;
    this.surfaces = samplers.surfaces;
    this.water = samplers.water;
    this.paths = samplers.paths;
    this.modeName = mode;
  }

  static async create(level: Level, mode: ModeName = 'chill'): Promise<Simulation> {
    const R = await initRapier();
    const world = createWorld(R);
    const terrain = createHeightfieldCollider(R, world, level.grid, level.heights);
    createBoundaryColliders(R, world, level.grid, level.minHeight, level.maxHeight);
    const heights = new HeightSampler(level.grid, level.heights);
    const surfaces = new SurfaceSampler(level.grid, level.material);
    const water = new WaterSampler(level.course.water, heights);
    const paths = new PathSampler(level.paths.paths);
    const trunks = addTrunkColliders(R, world, level, heights);
    const cart = new RapierCart(R, world, heights, surfaces, MODES[mode].cart, water);
    const sim = new Simulation(level, world, terrain, trunks, cart, { heights, surfaces, water, paths }, mode);
    sim.reset();
    return sim;
  }

  get mode(): ModeConfig {
    return MODES[this.modeName];
  }

  /** Switch driving mode in place; the cart keeps its pose and speed. `tuning` overrides the preset (tuning panel). */
  setMode(name: ModeName, tuning: CartTuning = MODES[name].cart): void {
    this.modeName = name;
    this.cart.setTuning(tuning);
  }

  reset(pose: Pose = this.level.course.spawn): void {
    this.cart.reset(pose);
  }

  /** Reset at a pose, then roll forward at a set speed (headless tests). */
  launch(pose: Pose, speed: number): void {
    this.reset(pose);
    this.cart.setForwardSpeed(speed);
  }

  step(input: VehicleInput): void {
    const t0 = performance.now();
    this.respawned = false;
    this.cart.update(input, FIXED_DT);
    this.world.step();
    this.stepCount++;
    // Chill: a cart afloat too long goes back to the nearest cart path.
    const after = this.cart.tuning.water.respawnAfter;
    if (after !== null && this.cart.afloatSeconds() >= after) {
      const p = this.cart.position();
      this.reset(this.paths.nearestPose(p.x, p.z) ?? this.level.course.spawn);
      this.respawned = true;
    }
    this.lastStepMs = performance.now() - t0;
  }

  /** Run n steps with the same input (headless helper). */
  run(input: VehicleInput, steps: number, each?: (sim: Simulation) => void): void {
    for (let i = 0; i < steps; i++) {
      this.step(input);
      each?.(this);
    }
  }
}

/** Fixed cylinder colliders for every tree trunk in scatter.bin, matching env/trees.ts. Returns the count. */
function addTrunkColliders(R: Rapier, world: RAPIER.World, level: Level, heights: HeightSampler): number {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  let count = 0;
  for (const species of level.course.scatter.species) {
    const trunk = trunkFor(species.name);
    if (!trunk) continue;
    const first = species.byteOffset / 16;
    for (let i = 0; i < species.count; i++) {
      const k = (first + i) * 4;
      const x = level.scatter[k]!;
      const z = level.scatter[k + 1]!;
      const scale = level.scatter[k + 2]!;
      const half = (trunk.height * scale) / 2;
      // Trees render 0.1 m sunk into the ground (env/trees.ts).
      const y = heights.heightAt(x, z) - 0.1 + half;
      world.createCollider(
        R.ColliderDesc.cylinder(half, trunk.radius * scale)
          .setTranslation(x, y, z)
          .setRestitution(treeConfig.trunkRestitution)
          .setFriction(treeConfig.trunkFriction),
        body,
      );
      count++;
    }
  }
  return count;
}
