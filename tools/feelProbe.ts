/**
 * Headless feel probe. Imports the REAL src/sim modules (no copies) and measures
 * carry / rollout / settle time / out-of-bounds for each club, plus terrain slope stats.
 * Run via a vite SSR build (see build-probe.config.ts) then `node out/probe.js`.
 */
import { Sim, FIXED_DT } from "../src/sim/world";
import { CUP_POSITION, CUP_RADIUS, FIELD_SIZE, NROWS, NCOLS, TEE_POSITION, WATER_LEVEL, heightAt } from "../src/sim/terrain";
import { SurfaceId, surfaceAt } from "../src/sim/surfaces";
import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../src/physics/Ballistics";

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

async function shoot(sim: Sim, club: ClubType): Promise<ShotResult> {
  sim.reset();
  const v = computeLaunchVelocity(club, 1, 0);
  const launchSpeed = Math.hypot(v.x, v.y, v.z);
  // Sim.launch uses its own DEFAULT_CLUB, so drive the body through the same
  // public path the game uses but force the club we want via a direct velocity set.
  (sim as unknown as { ball: { setLinvel: (v: unknown, w: boolean) => void } }).ball.setLinvel(v, true);

  const start = { ...sim.current.position };
  let apex = start.y;
  let flightS = 0;
  let landed = false;
  let everAirborne = false;
  let carryM = 0;
  let bounces = 0;
  let prevVy = v.y;
  let outOfBounds = false;
  let ticks = 0;
  let settleS = 0;
  let lastPos = { x: start.x, y: start.y, z: start.z };

  for (; ticks < MAX_TICKS; ticks++) {
    sim.step();
    const p = sim.current.position;
    const groundY = heightAt(p.x, p.z);
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
      const vy = (sim.current.position.y - sim.previous.position.y) / FIXED_DT;
      if (prevVy < -0.5 && vy > 0.5) bounces++;
      prevVy = vy;
    }

    // Sim returns an out-of-bounds ball to the tee itself, so read its flag rather than
    // re-testing the position (which is back in bounds by the time we see it).
    if (sim.lastShotOutOfBounds) {
      outOfBounds = true;
      console.log(
        `    [oob] ${club} left the field at t=${(ticks * FIXED_DT).toFixed(2)}s ` +
          `last in-bounds pos x=${lastPos.x.toFixed(1)} y=${lastPos.y.toFixed(2)} z=${lastPos.z.toFixed(1)} ` +
          `(terrain y=${heightAt(lastPos.x, lastPos.z).toFixed(2)})`,
      );
      break;
    }
    lastPos = { x: p.x, y: p.y, z: p.z };
    // Require ground contact as well as low speed: at the apex of a bounce the
    // vertical velocity passes through zero and isResting() alone reads true.
    if (!airborne && ticks > 5 && sim.isResting()) break;
  }
  settleS = ticks * FIXED_DT;
  const end = sim.current.position;
  const totalM = Math.hypot(end.x - start.x, end.z - start.z);

  return {
    club,
    launchSpeed,
    carryM,
    rollM: Math.max(0, totalM - carryM),
    totalM,
    apexM: apex - start.y,
    flightS,
    settleS,
    bounces,
    outOfBounds,
    inWater: sim.lastShotInWater,
    timedOut: ticks >= MAX_TICKS - 1,
  };
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d).padStart(7);
}

type BallHandle = { setTranslation: (v: unknown, w: boolean) => void; setLinvel: (v: unknown, w: boolean) => void };
function ballOf(sim: Sim): BallHandle {
  return (sim as unknown as { ball: BallHandle }).ball;
}

/**
 * The hazard and hole-out paths are new game rules, not tuning, so assert they actually
 * fire rather than inferring it from a distance number.
 */
function hazardAndHoleOutChecks(sim: Sim): void {
  console.log("\n=== RULES CHECKS ===");

  // Water: drop the ball straight into the pond that crosses the fairway.
  sim.reset();
  const pond = findWater();
  if (!pond) {
    console.log("  water      SKIP - no water found on the course");
  } else {
    ballOf(sim).setTranslation({ x: pond.x, y: heightAt(pond.x, pond.z) + 0.2, z: pond.z }, true);
    ballOf(sim).setLinvel({ x: 0, y: 0, z: 0 }, true);
    let fired = false;
    for (let i = 0; i < 240 && !fired; i++) {
      sim.step();
      fired = sim.lastShotInWater;
    }
    console.log(`  water      ${fired ? "PASS" : "FAIL"} - penalty fired=${fired}, strokes=${sim.strokes}`);
  }

  // Hole-out: putt from just outside the cup, straight at it.
  sim.reset();
  const approach = 2.0;
  const angle = Math.atan2(0 - CUP_POSITION.z, 0 - CUP_POSITION.x);
  const fromX = CUP_POSITION.x + Math.cos(angle) * approach;
  const fromZ = CUP_POSITION.z + Math.sin(angle) * approach;
  ballOf(sim).setTranslation({ x: fromX, y: heightAt(fromX, fromZ) + 0.2, z: fromZ }, true);
  const puttSpeed = 2.6;
  ballOf(sim).setLinvel({ x: -Math.cos(angle) * puttSpeed, y: 0, z: -Math.sin(angle) * puttSpeed }, true);
  let holed = false;
  let closest = Infinity;
  let speedAtClosest = 0;
  for (let i = 0; i < 600 && !holed; i++) {
    sim.step();
    const p = sim.current.position;
    const d = Math.hypot(p.x - CUP_POSITION.x, p.z - CUP_POSITION.z);
    if (d < closest) {
      closest = d;
      const q = sim.previous.position;
      speedAtClosest = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / FIXED_DT;
    }
    holed = sim.holedOut;
  }
  console.log(
    `  hole-out   ${holed ? "PASS" : "FAIL"} - from ${approach} m at ${puttSpeed} m/s; ` +
      `closest approach ${closest.toFixed(2)} m (cup radius ${CUP_RADIUS}), speed there ${speedAtClosest.toFixed(2)} m/s`,
  );
  sim.reset();
}

function findWater(): { x: number; z: number } | null {
  for (let x = -FIELD_SIZE / 2 + 2; x < FIELD_SIZE / 2 - 2; x += 1) {
    for (let z = -FIELD_SIZE / 2 + 2; z < FIELD_SIZE / 2 - 2; z += 1) {
      if (surfaceAt(x, z) === SurfaceId.Water) return { x, z };
    }
  }
  return null;
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

  const sim = await Sim.create();
  console.log("\n=== FULL-POWER SHOTS (charge = 1.0, flat aim down +X) ===");
  console.log("  club      v0   carry    roll   total    apex  flight  settle  bnc  result");
  for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
    const r = await shoot(sim, club);
    console.log(
      `  ${r.club.padEnd(7)}${fmt(r.launchSpeed)}${fmt(r.carryM)}${fmt(r.rollM)}${fmt(r.totalM)}` +
        `${fmt(r.apexM)}${fmt(r.flightS, 2)}${fmt(r.settleS, 2)}${String(r.bounces).padStart(5)}` +
        `  ${r.outOfBounds ? "OOB" : r.inWater ? "WATER" : "-"}${r.timedOut ? "  TIMED-OUT" : ""}`,
    );
  }
  hazardAndHoleOutChecks(sim);
  console.log("\n  club stats:", JSON.stringify(CLUB_STATS));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
