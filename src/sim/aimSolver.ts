import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../physics/Ballistics";
import { CART_HULL, TURRET_GEOMETRY } from "./entities/Cart";

/**
 * How hard a bot charges to hit a cart at a given range: a per-club table of range -> charge,
 * built once from the same flight integration `Sim.previewTrajectory` runs (club gravity, then
 * damping, then integrate, at the fixed step) over flat ground.
 *
 * Aimed at the middle of the hull, so the answer has room either side for terrain and spread.
 * Flat ground is the simplification: a table cannot know the ground between the carts, and a bot
 * that did would be reading the map better than a player can.
 *
 * Pure and DOM-free; `aimSolver.test.ts` holds its constants to `world.ts`'s, which this module
 * cannot import without a cycle (world -> bot -> here).
 */

const GRAVITY = 9.81;
const LINEAR_DAMPING = 0.05;
const DT = 1 / 60;

/** Charges the table tries, 0..1. */
const CHARGE_STEPS = 40;
/** Ranges the table covers, one entry per metre. */
const MAX_RANGE_M = 80;
/** Long enough for any club to come down inside `MAX_RANGE_M`. */
const MAX_FLIGHT_TICKS = 600;

const AIM_HEIGHT = CART_HULL.height / 2;

/** Exported for the constants test only. */
export const SOLVER_CONSTANTS = { GRAVITY, LINEAR_DAMPING, DT } as const;

const tables = new Map<ClubType, Float32Array>();

/** The charge, 0..1, that puts `club`'s shot at mid-hull height `distance` metres from the cart. */
export function solveShot(club: ClubType, distance: number): number {
  let table = tables.get(club);
  if (table === undefined) {
    table = buildTable(club);
    tables.set(club, table);
  }
  const i = Math.min(MAX_RANGE_M, Math.max(0, Math.round(distance)));
  return table[i]!;
}

function buildTable(club: ClubType): Float32Array {
  const table = new Float32Array(MAX_RANGE_M + 1);
  const bestError = new Float32Array(MAX_RANGE_M + 1).fill(Infinity);
  const heights = new Float32Array(MAX_RANGE_M + 1);
  // No charge reaches: fire at full and hope, which is what a player would do.
  table.fill(1);

  for (let step = 0; step <= CHARGE_STEPS; step++) {
    const charge = step / CHARGE_STEPS;
    heightsAtRanges(club, charge, heights);
    for (let r = 0; r <= MAX_RANGE_M; r++) {
      const h = heights[r]!;
      if (Number.isNaN(h)) continue;
      const error = Math.abs(h - AIM_HEIGHT);
      if (error < bestError[r]!) {
        bestError[r] = error;
        table[r] = charge;
      }
    }
  }
  return table;
}

/**
 * Height above flat ground at each whole-metre range from the cart's centre, or NaN where the
 * ball has already landed or never reaches. The muzzle is out in front of the cart on the barrel.
 */
function heightsAtRanges(club: ClubType, charge: number, out: Float32Array): void {
  out.fill(Number.NaN);
  const loft = (CLUB_STATS[club].loftDeg * Math.PI) / 180;
  let x = TURRET_GEOMETRY.pivotForward + Math.cos(loft) * TURRET_GEOMETRY.barrelLength;
  let y = TURRET_GEOMETRY.pivotHeight + Math.sin(loft) * TURRET_GEOMETRY.barrelLength;
  const v = computeLaunchVelocity(club, charge, 0);
  let vx = v.x;
  let vy = v.y;
  const gravity = GRAVITY * CLUB_STATS[club].gravityScale;
  const damp = 1 / (1 + LINEAR_DAMPING * DT);

  let next = Math.ceil(x);
  for (let tick = 0; tick < MAX_FLIGHT_TICKS && next <= MAX_RANGE_M; tick++) {
    vy -= gravity * DT;
    vx *= damp;
    vy *= damp;
    const px = x;
    const py = y;
    x += vx * DT;
    y += vy * DT;
    // Every whole metre crossed this tick, interpolated along the step.
    while (next <= x && next <= MAX_RANGE_M) {
      const t = (next - px) / (x - px);
      const h = py + (y - py) * t;
      if (h <= 0) return;
      out[next] = h;
      next++;
    }
    if (y <= 0) return;
  }
}
