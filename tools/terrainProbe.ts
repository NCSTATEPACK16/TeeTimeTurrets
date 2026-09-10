/**
 * Does one Rapier heightfield hold the whole course, and what does it cost?
 *
 * Stage B of arena mode assembles the eighteen placed hole fields into a single contiguous
 * heightfield at 2 m cells. `docs/DECISIONS.md` § "Arena mode, and a course that is one place"
 * reasons that this is affordable and reasons a 4 m fallback if it is not -- but those numbers
 * were *reasoned, not measured*, which `docs/TEST-AND-SPEC-PITFALLS.md` §3 says is exactly the
 * situation to distrust. This probe measures it before the module that depends on it is written.
 *
 * It answers three questions and nothing else:
 *   1. How long does building the heights and the collider take?
 *   2. What does `world.step()` plus 24 KCC moves cost per tick against that collider?
 *   3. How much memory is resident afterwards?
 *
 * **The control is the point.** The same measurement runs against today's shipped stroke-play
 * hole -- 1 m cells, one 220 m field -- with the same 24 carts. A course-scale step cost that
 * comes back indistinguishable from the single-hole one is far more likely to mean the probe is
 * measuring nothing than that a 47x bigger collider is free, and the validity guards below exist
 * to catch precisely that: carts that never touch the ground, or never move, cost nothing to
 * simulate and would report a beautiful number.
 *
 * The 2 m answer it gave is recorded in `docs/DECISIONS.md`; re-run it after any change to the
 * assembly, because the sampling cost is the part that moves.
 *
 * DOM-free and Three-free like the other tools, which is what lets it import the real sim.
 *
 * Usage:  npm run probe:terrain [-- --steps=600 --carts=24 --only=<label>]
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { generateCourse } from "../src/sim/course";
import type { HoleSpec } from "../src/sim/course";
import { solveCourseLayout, toCourseFrame } from "../src/sim/courseLayout";
import type { Bounds, LayoutHole, PlacedField } from "../src/sim/courseLayout";
import { createCourseTerrain } from "../src/sim/courseTerrain";
import type { PlacedHole } from "../src/sim/courseTerrain";
import { mulberry32 } from "../src/sim/rng";
import { createTerrain } from "../src/sim/terrain";
import type { Terrain } from "../src/sim/terrain";
import { CART_COLLIDER, CART_TUNING } from "../src/sim/entities/Cart";
import {
  CART_AUTOSTEP_HEIGHT,
  CART_AUTOSTEP_MIN_WIDTH,
  CART_MAX_SLOPE_CLIMB_DEG,
  CART_MIN_SLOPE_SLIDE_DEG,
  CART_SNAP_TO_GROUND,
  CHARACTER_OFFSET,
  FIXED_DT,
  GRAVITY,
} from "../src/sim/world";

/** The course seed the committed plans are drawn from; `tools/coursePlan.ts` uses the same one. */
const COURSE_SEED = 0x7ee71e5;
const HOLE_COUNT = 18;

/** Ground material, matching `Sim.buildGround`. Friction is what the KCC slides against. */
const GROUND_FRICTION = 0.8;
const GROUND_RESTITUTION = 0.15;

/**
 * Thresholds. A frame is 16.67 ms and it has to hold a render too, so physics is budgeted a
 * quarter of it as a mean and half of it as a worst case. Construction is judged against a level
 * load, not a frame -- 3 s of loading is a loading screen, not a stutter.
 */
const MEAN_STEP_BUDGET_MS = 4.0;
const P95_STEP_BUDGET_MS = 8.0;
const BUILD_BUDGET_MS = 3000;
const RSS_BUDGET_MB = 512;

/** Below these the run is not evidence about anything: nothing was touching the ground, or
 *  nothing moved, and an idle world is cheap for reasons that have nothing to do with cell size. */
const MIN_GROUNDED_FRACTION = 0.9;
const MIN_TRAVEL_FRACTION = 0.4;

interface Scenario {
  readonly label: string;
  readonly note: string;
  readonly cellM: number;
  readonly bounds: Bounds;
  /** Height in the course frame, in metres. */
  height(x: number, z: number): number;
  /** Where the carts start, and which way they set off. */
  readonly spawns: readonly { x: number; z: number; dirX: number; dirZ: number }[];
}

interface Result {
  readonly label: string;
  readonly note: string;
  readonly cellM: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: number;
  readonly heightsMB: number;
  readonly sampleMs: number;
  readonly colliderMs: number;
  readonly meanStepMs: number;
  readonly p95StepMs: number;
  readonly maxStepMs: number;
  readonly rssMB: number;
  readonly rssDeltaMB: number;
  readonly groundedFraction: number;
  readonly travelFraction: number;
  readonly maxDropM: number;
}

function parseArg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit === undefined ? NaN : Number(hit.slice(name.length + 3));
  return Number.isFinite(value) ? value : fallback;
}

function parseString(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function ms(from: bigint, to: bigint): number {
  return Number(to - from) / 1e6;
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

/**
 * The course scenario: eighteen generated holes, placed, assembled by `createCourseTerrain`.
 *
 * The first run of this probe predated that module and stood in for it with a nearest-hole
 * sampler, because the measurement was meant to decide the cell size before anything was built on
 * it. It samples the real assembly now, which costs more per cell -- a point can be inside two or
 * three holes' influence and each one is a spline query -- so the build numbers below are the
 * honest ones and the earlier sampling times are not comparable.
 */
function courseScenario(cellM: number, holes: readonly HoleSpec[], terrains: readonly Terrain[]): Scenario {
  const layoutHoles: LayoutHole[] = holes.map((spec) => ({
    index: spec.index,
    tee: spec.tee,
    cup: spec.cup,
    control: spec.control,
  }));
  const layout = solveCourseLayout(layoutHoles);
  const placed: PlacedHole[] = layout.placements.map((placement) => ({
    placement,
    spec: holes[placement.index]!,
    terrain: terrains[placement.index]!,
  }));
  const assembled = createCourseTerrain(placed, { cellM, rough: mulberry32(COURSE_SEED) });
  const bounds = assembled.bounds;
  const height = (x: number, z: number): number => assembled.heightAt(x, z);

  // One cart per hole, on the tee, pointed at the cup: the traversal the mode is actually about.
  const tee = { x: 0, z: 0 };
  const cup = { x: 0, z: 0 };
  const spawns = layout.placements.map((placement) => {
    const spec = holes[placement.index]!;
    const field: PlacedField = {
      fieldSize: spec.fieldSize,
      offsetX: placement.offsetX,
      offsetZ: placement.offsetZ,
      rotation: placement.rotation,
    };
    toCourseFrame(field, spec.tee.x, spec.tee.z, tee);
    toCourseFrame(field, spec.cup.x, spec.cup.z, cup);
    const dx = cup.x - tee.x;
    const dz = cup.z - tee.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: tee.x, z: tee.z, dirX: dx / len, dirZ: dz / len };
  });

  return {
    label: `course@${cellM}m`,
    note: `18 holes, one heightfield, ${cellM} m cells`,
    cellM,
    bounds,
    height,
    spawns,
  };
}

/** The control: what ships today. One hole, its own 1 m cells, the same carts driving it. */
function holeScenario(spec: HoleSpec, terrain: Terrain): Scenario {
  const half = spec.fieldSize / 2;
  const dx = spec.cup.x - spec.tee.x;
  const dz = spec.cup.z - spec.tee.z;
  const len = Math.hypot(dx, dz) || 1;
  const spawns = [{ x: spec.tee.x, z: spec.tee.z, dirX: dx / len, dirZ: dz / len }];
  return {
    label: "hole@1m",
    note: `stroke-play hole ${spec.index + 1}, ${spec.fieldSize} m field, ${(spec.fieldSize / spec.cells).toFixed(2)} m cells`,
    cellM: spec.fieldSize / spec.cells,
    bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    height: (x, z) => terrain.heightAt(x, z),
    spawns,
  };
}

function run(scenario: Scenario, carts: number, steps: number): Result {
  const rssBefore = rssMB();
  const extentX = scenario.bounds.maxX - scenario.bounds.minX;
  const extentZ = scenario.bounds.maxZ - scenario.bounds.minZ;
  const centreX = (scenario.bounds.minX + scenario.bounds.maxX) / 2;
  const centreZ = (scenario.bounds.minZ + scenario.bounds.maxZ) / 2;
  const cols = Math.max(1, Math.round(extentX / scenario.cellM));
  const rows = Math.max(1, Math.round(extentZ / scenario.cellM));

  // Column-major, row -> world Z and col -> world X, as `Terrain.buildHeightfield` builds it.
  const sampleStart = process.hrtime.bigint();
  const heights = new Float32Array((rows + 1) * (cols + 1));
  let minH = Infinity;
  let maxH = -Infinity;
  for (let col = 0; col <= cols; col++) {
    const worldX = centreX + (col / cols - 0.5) * extentX;
    for (let row = 0; row <= rows; row++) {
      const worldZ = centreZ + (row / rows - 0.5) * extentZ;
      const h = scenario.height(worldX, worldZ);
      heights[row + col * (rows + 1)] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const sampleEnd = process.hrtime.bigint();

  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  const colliderStart = process.hrtime.bigint();
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(rows, cols, heights, { x: extentX, y: 1, z: extentZ })
      .setTranslation(centreX, 0, centreZ)
      .setFriction(GROUND_FRICTION)
      .setRestitution(GROUND_RESTITUTION),
  );
  const colliderEnd = process.hrtime.bigint();

  const controller = world.createCharacterController(CHARACTER_OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((CART_MIN_SLOPE_SLIDE_DEG * Math.PI) / 180);
  controller.enableAutostep(CART_AUTOSTEP_HEIGHT, CART_AUTOSTEP_MIN_WIDTH, true);
  controller.enableSnapToGround(CART_SNAP_TO_GROUND);
  controller.setApplyImpulsesToDynamicBodies(true);

  interface Rig {
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    x: number;
    y: number;
    z: number;
    dirX: number;
    dirZ: number;
    fallSpeed: number;
    travelled: number;
    grounded: number;
    startY: number;
    maxDrop: number;
  }
  // Ten metres in from the edge: where a cart is turned back, and where one may be spawned.
  const edgeX = extentX / 2 - 10;
  const edgeZ = extentZ / 2 - 10;

  const rigs: Rig[] = [];
  for (let i = 0; i < carts; i++) {
    const spawn = scenario.spawns[i % scenario.spawns.length]!;
    // Fan copies apart when there are more carts than spawns, so no two share a square metre --
    // as a grid rather than a ray, and clamped inside the field. A cart fanned off the edge falls
    // forever, touches nothing, and would make an empty world look like a cheap one.
    const copy = Math.floor(i / scenario.spawns.length);
    const x = clamp(spawn.x + ((copy % 5) - 2) * 4, centreX - edgeX, centreX + edgeX);
    const z = clamp(spawn.z + ((Math.floor(copy / 5) % 5) - 2) * 4, centreZ - edgeZ, centreZ + edgeZ);
    const y = scenario.height(x, z) + CART_COLLIDER.groundOffset;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius),
      body,
    );
    rigs.push({
      body,
      collider,
      x,
      y,
      z,
      dirX: spawn.dirX,
      dirZ: spawn.dirZ,
      fallSpeed: 0,
      travelled: 0,
      grounded: 0,
      startY: y,
      maxDrop: 0,
    });
  }

  const speed = CART_TUNING.topSpeed;
  const move = { x: 0, y: 0, z: 0 };

  const tick = (): void => {
    for (const rig of rigs) {
      rig.fallSpeed -= GRAVITY * FIXED_DT;
      move.x = rig.dirX * speed * FIXED_DT;
      move.y = rig.fallSpeed * FIXED_DT;
      move.z = rig.dirZ * speed * FIXED_DT;
      controller.computeColliderMovement(rig.collider, move);
      const corrected = controller.computedMovement();
      rig.x += corrected.x;
      rig.y += corrected.y;
      rig.z += corrected.z;
      rig.travelled += Math.hypot(corrected.x, corrected.z);
      if (controller.computedGrounded()) {
        rig.fallSpeed = 0;
        rig.grounded++;
      }
      // Turn back rather than leave the field: a cart that drives off the edge and falls forever
      // stops touching the collider, and an untouched collider is the cheap-for-the-wrong-reason
      // case this probe exists to avoid.
      if (Math.abs(rig.x - centreX) > edgeX) rig.dirX = -rig.dirX;
      if (Math.abs(rig.z - centreZ) > edgeZ) rig.dirZ = -rig.dirZ;
      const drop = rig.startY - rig.y;
      if (drop > rig.maxDrop) rig.maxDrop = drop;
      rig.body.setNextKinematicTranslation({ x: rig.x, y: rig.y, z: rig.z });
    }
    world.step();
  };

  // Warm-up: the first ticks settle each cart onto the ground and let the JIT see the loop.
  // Timing them would measure the drop, not the steady state.
  for (let i = 0; i < 60; i++) tick();
  for (const rig of rigs) {
    rig.travelled = 0;
    rig.grounded = 0;
    rig.startY = rig.y;
    rig.maxDrop = 0;
  }

  const samples: number[] = [];
  for (let i = 0; i < steps; i++) {
    const start = process.hrtime.bigint();
    tick();
    samples.push(ms(start, process.hrtime.bigint()));
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;

  const grounded = rigs.reduce((sum, r) => sum + r.grounded, 0) / (rigs.length * steps);
  const freeTravel = speed * FIXED_DT * steps;
  const travel = rigs.reduce((sum, r) => sum + r.travelled, 0) / (rigs.length * freeTravel);
  const maxDrop = rigs.reduce((most, r) => Math.max(most, r.maxDrop), 0);

  const result: Result = {
    label: scenario.label,
    note: scenario.note,
    cellM: scenario.cellM,
    cols,
    rows,
    cells: cols * rows,
    heightsMB: (heights.length * 4) / (1024 * 1024),
    sampleMs: ms(sampleStart, sampleEnd),
    colliderMs: ms(colliderStart, colliderEnd),
    meanStepMs: mean,
    p95StepMs: samples[Math.floor(samples.length * 0.95)]!,
    maxStepMs: samples[samples.length - 1]!,
    rssMB: rssMB(),
    rssDeltaMB: rssMB() - rssBefore,
    groundedFraction: grounded,
    travelFraction: travel,
    maxDropM: maxDrop,
  };
  world.free();
  return result;
}

async function main(): Promise<void> {
  await RAPIER.init();
  const carts = parseArg("carts", 24);
  const steps = parseArg("steps", 600);
  const only = parseString("only", "");

  const course = generateCourse(COURSE_SEED, HOLE_COUNT);
  const terrains = course.holes.map((spec) => createTerrain(spec));

  // The cell sizes to try. The default pair is the decision in front of Stage B; passing a
  // finer one (`--cells=1,2,4`) is how to check the probe still responds to cell size at all,
  // which is the difference between a measurement and a number.
  const cellSizes = parseString("cells", "2,4")
    .split(",")
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n > 0);

  const scenarios: Scenario[] = [
    holeScenario(course.holes[0]!, terrains[0]!),
    ...cellSizes.map((cell) => courseScenario(cell, course.holes, terrains)),
  ].filter((s) => only === "" || s.label === only);

  const results = scenarios.map((s) => run(s, carts, steps));

  console.log(`\nterrain probe -- ${carts} carts, ${steps} steps, seed 0x${COURSE_SEED.toString(16)}\n`);
  const head = [
    "scenario".padEnd(12),
    "grid".padStart(12),
    "cells".padStart(10),
    "heights".padStart(9),
    "sample".padStart(9),
    "collider".padStart(9),
    "mean/step".padStart(10),
    "p95".padStart(8),
    "max".padStart(8),
    "rss".padStart(8),
  ].join(" ");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of results) {
    console.log(
      [
        r.label.padEnd(12),
        `${r.cols}x${r.rows}`.padStart(12),
        `${(r.cells / 1000).toFixed(0)}k`.padStart(10),
        `${r.heightsMB.toFixed(1)} MB`.padStart(9),
        `${r.sampleMs.toFixed(0)} ms`.padStart(9),
        `${r.colliderMs.toFixed(1)} ms`.padStart(9),
        `${r.meanStepMs.toFixed(3)} ms`.padStart(10),
        `${r.p95StepMs.toFixed(2)}`.padStart(8),
        `${r.maxStepMs.toFixed(2)}`.padStart(8),
        `${r.rssMB.toFixed(0)} MB`.padStart(8),
      ].join(" "),
    );
  }

  console.log("\nvalidity -- a run that fails these measured an idle world, not a cheap one");
  for (const r of results) {
    console.log(
      `  ${r.label.padEnd(12)} grounded ${(r.groundedFraction * 100).toFixed(1)}%  ` +
        `travelled ${(r.travelFraction * 100).toFixed(1)}% of free speed  ` +
        `max drop ${r.maxDropM.toFixed(2)} m  (+${r.rssDeltaMB.toFixed(0)} MB rss)`,
    );
  }

  const failures: string[] = [];
  for (const r of results) {
    if (r.groundedFraction < MIN_GROUNDED_FRACTION) {
      failures.push(
        `${r.label}: carts grounded only ${(r.groundedFraction * 100).toFixed(1)}% of ticks -- ` +
          `the step cost below is not evidence about the collider`,
      );
    }
    if (r.travelFraction < MIN_TRAVEL_FRACTION) {
      failures.push(
        `${r.label}: carts travelled ${(r.travelFraction * 100).toFixed(1)}% of free speed -- ` +
          `they are stuck, and a stuck cart queries less ground than a driving one`,
      );
    }
    if (r.label === "hole@1m") continue;
    if (r.meanStepMs > MEAN_STEP_BUDGET_MS) {
      failures.push(`${r.label}: mean step ${r.meanStepMs.toFixed(2)} ms > ${MEAN_STEP_BUDGET_MS} ms`);
    }
    if (r.p95StepMs > P95_STEP_BUDGET_MS) {
      failures.push(`${r.label}: p95 step ${r.p95StepMs.toFixed(2)} ms > ${P95_STEP_BUDGET_MS} ms`);
    }
    if (r.sampleMs + r.colliderMs > BUILD_BUDGET_MS) {
      failures.push(
        `${r.label}: build ${(r.sampleMs + r.colliderMs).toFixed(0)} ms > ${BUILD_BUDGET_MS} ms`,
      );
    }
    if (r.rssMB > RSS_BUDGET_MB) {
      failures.push(`${r.label}: rss ${r.rssMB.toFixed(0)} MB > ${RSS_BUDGET_MB} MB`);
    }
  }

  const twoMetre = results.find((r) => r.label === "course@2m");
  if (twoMetre !== undefined) {
    const verdict = failures.some((f) => f.startsWith("course@2m"))
      ? "2 m cells miss a budget -- fall back to 4 m (DECISIONS.md says this is a constant, not a rewrite)"
      : "2 m cells are within every budget -- Stage B builds one heightfield at 2 m, no streaming";
    console.log(`\nverdict: ${verdict}`);
  }

  if (failures.length > 0) {
    console.log("\nFAIL");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nPASS");
}

void main();
