/**
 * Headless feel probe. Imports the REAL src/sim modules (no copies) and measures
 * carry / rollout / settle time / out-of-bounds for each club, plus terrain slope stats.
 * Run via a vite SSR build (see build-probe.config.ts) then `node out/probe.js`.
 */
import { createNoise2D } from "simplex-noise";
import { Sim, FIXED_DT } from "../src/sim/world";
import { mulberry32 } from "../src/sim/rng";
import { fixedHoleSpec } from "../src/sim/course";
import { NOISE_MAX_GRADIENT, createTerrain } from "../src/sim/terrain";
import { arenaFromHole } from "../src/sim/arena";
import { neutralIntent } from "../src/sim/intent";
// The driver's reference distance lives in sim/carry.ts, a leaf module (see that file's header),
// not in course.ts, which does not re-export it.
import { ARENA_DRIVER_CARRY_M, ARENA_DRIVER_TOTAL_M } from "../src/sim/carry";
import {
  derivePar,
  draftHole,
  generateCourse,
  parForIndex,
} from "../src/sim/course";
import { validateHole } from "../src/sim/holeValidation";
import { createSurfaces } from "../src/sim/surfaces";
import { SurfaceId } from "../src/sim/surfaces";
import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../src/physics/Ballistics";

/**
 * The probe builds its own hole rather than reading module constants, because there are no
 * module constants any more. Same spec the game boots with, so the numbers below stay
 * comparable to the Phase 0 baseline.
 *
 * Uses the hashed defaults, not injected noise sources: Task 9 retired the shipped hole's
 * literal sources, so the probe now measures what the game actually ships.
 */
const HOLE = fixedHoleSpec();
const terrain = createTerrain(HOLE);
const surfaces = createSurfaces(HOLE, terrain);

const FIELD_SIZE = HOLE.fieldSize;
const NROWS = HOLE.cells;
const NCOLS = HOLE.cells;
const WATER_LEVEL = HOLE.waterLevel;
const TEE_POSITION = terrain.teePosition;
const CUP_POSITION = terrain.cupPosition;
const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);
const surfaceAt = (x: number, z: number): SurfaceId => surfaces.surfaceAt(x, z);

/** Surface mix across the course, and whether the tee->cup line is actually playable. */
function surfaceReport(): void {
  const counts = new Map<SurfaceId, number>();
  const step = FIELD_SIZE / 160;
  let total = 0;
  for (let x = -FIELD_SIZE / 2; x < FIELD_SIZE / 2; x += step) {
    for (let z = -FIELD_SIZE / 2; z < FIELD_SIZE / 2; z += step) {
      const s = surfaceAt(x, z);
      counts.set(s, (counts.get(s) ?? 0) + 1);
      total++;
    }
  }
  console.log("\n=== SURFACE MIX ===");
  for (const id of Object.values(SurfaceId)) {
    const pct = ((counts.get(id) ?? 0) / total) * 100;
    console.log(`  ${id.padEnd(9)} ${pct.toFixed(1).padStart(5)}%  ${"#".repeat(Math.round(pct / 2))}`);
  }

  // Walk the tee->cup line: a hole with water or sand straight across it at the tee is unfair.
  const dx = CUP_POSITION.x - TEE_POSITION.x;
  const dz = CUP_POSITION.z - TEE_POSITION.z;
  const holeLength = Math.hypot(dx, dz);
  const line: string[] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const s = surfaceAt(TEE_POSITION.x + dx * t, TEE_POSITION.z + dz * t);
    line.push(s === SurfaceId.Water ? "~" : s === SurfaceId.Sand ? "s" : s === SurfaceId.Green ? "G" : s === SurfaceId.Rough ? "r" : ".");
  }
  console.log(`  hole length ${holeLength.toFixed(0)} m, water level ${WATER_LEVEL}`);
  console.log(`  tee->cup line: ${line.join("")}   (. fairway  r rough  s sand  ~ water  G green)`);
  console.log(`  cup at x=${CUP_POSITION.x.toFixed(0)} z=${CUP_POSITION.z.toFixed(0)} y=${CUP_POSITION.y.toFixed(2)}`);
}

const MAX_TICKS = 60 * 40; // 40 simulated seconds

function terrainStats() {
  const cell = FIELD_SIZE / NCOLS;
  let maxSlopeDeg = 0;
  let sumSlope = 0;
  let n = 0;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let col = 0; col < NCOLS; col++) {
    for (let row = 0; row < NROWS; row++) {
      const x = (col / NCOLS - 0.5) * FIELD_SIZE;
      const z = (row / NROWS - 0.5) * FIELD_SIZE;
      const h = heightAt(x, z);
      const dhdx = (heightAt(x + cell, z) - h) / cell;
      const dhdz = (heightAt(x, z + cell) - h) / cell;
      const slope = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
      maxSlopeDeg = Math.max(maxSlopeDeg, slope);
      sumSlope += slope;
      n++;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  return {
    cellM: cell,
    meanSlopeDeg: sumSlope / n,
    maxSlopeDeg,
    reliefM: maxH - minH,
  };
}

interface ShotResult {
  club: string;
  launchSpeed: number;
  carryM: number;
  rollM: number;
  totalM: number;
  apexM: number;
  flightS: number;
  settleS: number;
  bounces: number;
  outOfBounds: boolean;
  inWater: boolean;
  timedOut: boolean;
}

/** The player's pooled balls, read through the TS-private pool: the probe measures, it never drives it. */
interface ProbeBall {
  state: "idle" | "flying" | "landed";
  firedBy: number;
  body: { translation(): { x: number; y: number; z: number } };
}
function poolOf(sim: Sim): readonly ProbeBall[] {
  return (sim as unknown as { ballPool: { all: readonly ProbeBall[] } }).ballPool.all;
}

/** Deepest the ball's centre may sit below the terrain surface under it before it counts as tunnelling. */
const TUNNEL_TOLERANCE_M = 0.5;
/** Lowest height of a fired ball's centre above the terrain under it, over every tick measured. */
let lowestClearanceM = Infinity;

/**
 * One full-charge shot of `club`, fired the way the game fires one: the player's cart selects the
 * club, the turret is swung to +X, the trigger is held past the club's charge time and let go. The
 * ball is then the pooled ball the cart put in the air, followed until the pool calls it landed.
 *
 * Until the arena became the only mode this drove the stroke-play course ball directly, and that
 * ball is gone. Measuring from the muzzle rather than the tee also means `apex` is above the
 * muzzle, about 2.4 m up.
 */
async function shoot(sim: Sim, club: ClubType): Promise<ShotResult> {
  sim.reset();
  const intent = neutralIntent();
  intent.selectClub = club;
  intent.aimDelta = -sim.cart.turretYaw;
  sim.step(intent);
  intent.selectClub = null;
  intent.aimDelta = 0;
  const chargeTicks = Math.ceil(CLUB_STATS[club].chargeSeconds / FIXED_DT) + 2;
  intent.fire = true;
  for (let i = 0; i < chargeTicks; i++) sim.step(intent);
  intent.fire = false;
  sim.step(intent);
  const ball = poolOf(sim).find((b) => b.state === "flying" && b.firedBy === 0);
  if (!ball) throw new Error(`probe: the ${club} shot put no ball in the air`);

  const v = computeLaunchVelocity(club, 1, 0);
  const launchSpeed = Math.hypot(v.x, v.y, v.z);
  const start = ball.body.translation();
  let apex = start.y;
  let flightS = 0;
  let landed = false;
  let everAirborne = false;
  let carryM = 0;
  let bounces = 0;
  let prevY = start.y;
  let prevVy = v.y;
  let ticks = 0;
  let end = start;

  for (; ticks < MAX_TICKS && ball.state === "flying"; ticks++) {
    sim.step();
    // `sim.step` moves the state, which the loop condition's narrowing cannot see.
    if ((ball.state as ProbeBall["state"]) === "idle") break; // released by the pool, not landed
    const p = ball.body.translation();
    end = p;
    const groundY = heightAt(p.x, p.z);
    lowestClearanceM = Math.min(lowestClearanceM, p.y - groundY);
    const airborne = p.y - groundY > 0.35;
    if (airborne) everAirborne = true;
    apex = Math.max(apex, p.y);

    if (!landed) {
      flightS += FIXED_DT;
      // Only call it a landing once the ball has actually left the ground, so a
      // low putt (never airborne) reports carry 0 instead of a spurious full carry.
      if (everAirborne && !airborne) {
        landed = true;
        carryM = Math.hypot(p.x - start.x, p.z - start.z);
      }
    } else {
      const vy = (p.y - prevY) / FIXED_DT;
      if (prevVy < -0.5 && vy > 0.5) bounces++;
      prevVy = vy;
    }
    prevY = p.y;
  }
  const totalM = Math.hypot(end.x - start.x, end.z - start.z);
  const half = FIELD_SIZE / 2;

  return {
    club,
    launchSpeed,
    carryM,
    rollM: Math.max(0, totalM - carryM),
    totalM,
    apexM: apex - start.y,
    flightS,
    settleS: ticks * FIXED_DT,
    bounces,
    outOfBounds: Math.abs(end.x) > half || Math.abs(end.z) > half,
    inWater: surfaceAt(end.x, end.z) === SurfaceId.Water,
    timedOut: ball.state === "flying",
  };
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d).padStart(7);
}

/** Fixed so the measurement is comparable run to run; the band's job is to catch a library bump. */
const K_PROBE_SEED = 20260901;
const PROBE_COURSE_SEED = 2026;

let probeFailed = false;

function report(name: string, ok: boolean, detail: string): void {
  if (!ok) probeFailed = true;
  console.log(`  ${name.padEnd(22)} ${ok ? "PASS" : "FAIL"} - ${detail}`);
}

/**
 * 1. The measured constant. Every terrain amplitude solves A = G / (f * k) with this k, so it
 *    is a property of the installed simplex-noise build that a version bump can silently
 *    invalidate -- which is why it is an assertion here rather than a number in a document.
 *
 *    Central differences at h = 1e-4 over 1,002,001 samples of a 20x20 domain, matching how
 *    7.333 was measured in the first place.
 */
function noiseGradientCheck(): void {
  const noise = createNoise2D(mulberry32(K_PROBE_SEED));
  const h = 1e-4;
  const steps = 1000;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i <= steps; i++) {
    const x = -10 + (20 * i) / steps;
    for (let j = 0; j <= steps; j++) {
      const z = -10 + (20 * j) / steps;
      const dx = (noise(x + h, z) - noise(x - h, z)) / (2 * h);
      const dz = (noise(x, z + h) - noise(x, z - h)) / (2 * h);
      const g = Math.hypot(dx, dz);
      if (g > max) max = g;
      sum += g;
      count++;
    }
  }
  const tolerance = NOISE_MAX_GRADIENT * 0.05;
  report(
    "noise gradient k",
    Math.abs(max - NOISE_MAX_GRADIENT) <= tolerance,
    `max ${max.toFixed(3)} (mean ${(sum / count).toFixed(3)}, n=${count}), ` +
      `expected ${NOISE_MAX_GRADIENT} +-5%`,
  );
}

/**
 * 2. Holds the driver to its measured arena distance: ARENA_DRIVER_TOTAL_M and ARENA_DRIVER_CARRY_M,
 *    the full-power total and carry fired from a cart through the ball pool. Neither is a second
 *    copy of CLUB_STATS. A club rebalance that changes the driver's reach fails here and has to update
 *    that constant on purpose, rather than drifting unnoticed.
 */
async function driverDistanceCheck(sim: Sim): Promise<void> {
  const r = await shoot(sim, ClubType.Driver);
  // Carry and total are both held: on this hole's terrain a faster driver can carry into a bank,
  // stop dead, and land on the same total, so the total alone misses it (see carry.ts).
  const totalDrift = Math.abs(r.totalM - ARENA_DRIVER_TOTAL_M) / ARENA_DRIVER_TOTAL_M;
  const carryDrift = Math.abs(r.carryM - ARENA_DRIVER_CARRY_M) / ARENA_DRIVER_CARRY_M;
  report(
    "driver distance",
    totalDrift <= 0.15 && carryDrift <= 0.15,
    `${r.totalM.toFixed(1)} m total vs ${ARENA_DRIVER_TOTAL_M} (drift ${(totalDrift * 100).toFixed(1)}%), ` +
      `${r.carryM.toFixed(1)} m carry vs ${ARENA_DRIVER_CARRY_M} (drift ${(carryDrift * 100).toFixed(1)}%), limit 15% each`,
  );
}

/** 3. The generator's own criteria, re-run from outside it against a full nine. */
function coursePlayabilityCheck(): void {
  let failures = 0;
  const course = generateCourse(PROBE_COURSE_SEED, 9);
  for (const hole of course.holes) {
    const rejection = validateHole(hole, createTerrain(hole));
    if (rejection === null) continue;
    failures++;
    console.log(`    hole ${hole.index}: check ${rejection.check} - ${rejection.reason}`);
  }
  const pars = course.holes.map((h) => h.par).join("");
  report(
    "course playability",
    failures === 0,
    `${course.holes.length} holes, pars ${pars} (total ${course.holes.reduce((s, h) => s + h.par, 0)}), ` +
      `${failures} failing`,
  );
}

/**
 * 4. Reports rather than asserts. The research claims 80-85%, computed from its miscalibrated
 *    amplitudes; that figure carries no weight here and the real number is what this run
 *    records. The per-check breakdown is the useful part -- it names which threshold is
 *    actually binding.
 */
function acceptanceReport(): void {
  const samples = 200;
  let accepted = 0;
  const byCheck = new Map<number, number>();
  for (let i = 0; i < samples; i++) {
    const candidate = draftHole(PROBE_COURSE_SEED, i, parForIndex(i), 0);
    const terrain = createTerrain(candidate);
    const spec = { ...candidate, par: derivePar(terrain.spline.length) };
    const rejection = validateHole(spec, terrain);
    if (rejection === null) accepted++;
    else byCheck.set(rejection.check, (byCheck.get(rejection.check) ?? 0) + 1);
  }
  const breakdown = [...byCheck.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([check, n]) => `check ${check}: ${n}`)
    .join(", ");
  console.log(
    `  acceptance rate         ${((accepted / samples) * 100).toFixed(1)}% ` +
      `(${accepted}/${samples})${breakdown ? ` - rejections by ${breakdown}` : ""}`,
  );
}

async function main(): Promise<void> {
  const t = terrainStats();
  console.log("=== TERRAIN ===");
  console.log(`  field ${FIELD_SIZE} m, grid ${NROWS}x${NCOLS}, cell ${t.cellM.toFixed(3)} m`);
  console.log(`  relief (min->max height)  ${t.reliefM.toFixed(2)} m`);
  console.log(`  mean slope               ${t.meanSlopeDeg.toFixed(1)} deg`);
  console.log(`  max  slope               ${t.maxSlopeDeg.toFixed(1)} deg`);
  console.log(`  tee at x=${TEE_POSITION.x.toFixed(1)} z=${TEE_POSITION.z.toFixed(1)} y=${TEE_POSITION.y.toFixed(2)}`);
  console.log(`  distance tee -> far edge  ${(FIELD_SIZE / 2 - TEE_POSITION.x).toFixed(1)} m`);

  // The tee pad is blended toward a fixed height; if it is blended toward absolute 0
  // rather than the local terrain height, there is a step at the pad boundary.
  console.log("\n=== TEE PAD PROFILE (height vs distance out from the tee, +X) ===");
  let worstStep = 0;
  const samples: string[] = [];
  for (let d = 0; d <= 8; d += 0.5) {
    const h = heightAt(TEE_POSITION.x + d, TEE_POSITION.z);
    const hPrev = heightAt(TEE_POSITION.x + d - 0.5, TEE_POSITION.z);
    if (d > 0) worstStep = Math.max(worstStep, Math.abs(h - hPrev));
    samples.push(`${d.toFixed(1)}m:${h.toFixed(2)}`);
  }
  console.log(`  ${samples.join("  ")}`);
  console.log(`  worst 0.5 m step across the pad edge: ${worstStep.toFixed(2)} m ` +
    `(${((Math.atan(worstStep / 0.5) * 180) / Math.PI).toFixed(0)} deg)`);

  surfaceReport();

  // No bot: one standing downrange could clip a shot and make these numbers -- cited in tuning
  // docstrings -- flaky.
  const sim = await Sim.create(arenaFromHole(HOLE), { botCount: 0 });
  console.log("\n=== FULL-POWER SHOTS (charge = 1.0, turret down +X, from the cart's muzzle) ===");
  console.log("  club      v0   carry    roll   total    apex  flight  settle  bnc  result");
  for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
    const r = await shoot(sim, club);
    console.log(
      `  ${r.club.padEnd(7)}${fmt(r.launchSpeed)}${fmt(r.carryM)}${fmt(r.rollM)}${fmt(r.totalM)}` +
        `${fmt(r.apexM)}${fmt(r.flightS, 2)}${fmt(r.settleS, 2)}${String(r.bounces).padStart(5)}` +
        `  ${r.outOfBounds ? "OOB" : r.inWater ? "WATER" : "-"}${r.timedOut ? "  TIMED-OUT" : ""}`,
    );
  }
  console.log("\n  club stats:", JSON.stringify(CLUB_STATS));

  console.log("\n=== COURSE CHECKS ===");
  noiseGradientCheck();
  await driverDistanceCheck(sim);
  // AGENTS.md: after a ball or terrain tuning change, a full-power shot's height must stay bounded
  // through flight and settling, not diverge toward free fall.
  report(
    "ball stays above ground",
    lowestClearanceM >= -TUNNEL_TOLERANCE_M,
    `lowest ball centre ${lowestClearanceM.toFixed(3)} m above the terrain under it, over every tick of ` +
      `the three full-power shots and the driver check (limit -${TUNNEL_TOLERANCE_M} m)`,
  );
  coursePlayabilityCheck();
  acceptanceReport();

  if (probeFailed) {
    console.error("\nprobe: one or more course checks failed");
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
