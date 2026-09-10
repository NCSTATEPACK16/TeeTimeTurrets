/**
 * Closes a nine's loop by relaxation instead of by construction. `placeNineAsLobes` gives this
 * an initial guess that already has the right lobed shape (docs/RESEARCH-ROUTING.md's attempt
 * 6); what it does not reliably have is closure, because its transitions are fixed at exactly
 * TRANSITION_M and a lobed shape's residual displacement has nowhere else to go. This module
 * gives the chain the one degree of freedom §Q3 identifies -- transition length, bounded rather
 * than fixed -- and lets a fixed number of constraint-satisfaction passes absorb the residual.
 *
 * Deterministic by construction: no RNG, and a fixed iteration count rather than a convergence
 * threshold, so floating-point order-of-operations differences cannot change how many passes run.
 */

import type { Vec2 } from "./mapGeometry";
import {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  chordOf,
  placedControl,
  polylineClearance,
  toCourseFrame,
  type HolePlacement,
  type LayoutHole,
} from "./courseLayout";

const ITERATIONS = 200;
/** Fraction of the remaining distance to the clubhouse the last cup closes per iteration. Low
 *  enough that the rigid-length and slack constraints (which run first each iteration) get to
 *  react to each step rather than being dragged past their own limits by a single big jump. */
const ATTRACTOR_RATE = 0.08;

/** Moves `a`/`b` apart or together until `|b - a| === targetLen`, weighting the move by which
 *  endpoint is pinned. A pinned endpoint (weight 0) never moves; if neither is pinned each moves
 *  half the correction. */
function satisfyDistance(a: Vec2, b: Vec2, pinnedA: boolean, pinnedB: boolean, targetLen: number): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return;
  const wa = pinnedA ? 0 : 1;
  const wb = pinnedB ? 0 : 1;
  const wsum = wa + wb;
  if (wsum === 0) return;
  const diff = (len - targetLen) / len;
  a.x += dx * diff * (wa / wsum);
  a.z += dz * diff * (wa / wsum);
  b.x -= dx * diff * (wb / wsum);
  b.z -= dz * diff * (wb / wsum);
}

/** Only pulls `a`/`b` toward each other (or pushes apart) when their distance is outside
 *  [min, max] -- inside the range this applies no force at all, which is what makes it slack
 *  rather than a spring toward a fixed rest length. */
function satisfySlack(a: Vec2, b: Vec2, min: number, max: number): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < min) satisfyDistance(a, b, false, false, min);
  else if (len > max) satisfyDistance(a, b, false, false, max);
}

function placementFromParticles(hole: LayoutHole, tee: Vec2, cup: Vec2): HolePlacement {
  const wanted = Math.atan2(cup.z - tee.z, cup.x - tee.x);
  const own = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
  const rotation = wanted - own;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    index: hole.index,
    offsetX: tee.x - (hole.tee.x * cos - hole.tee.z * sin),
    offsetZ: tee.z - (hole.tee.x * sin + hole.tee.z * cos),
    rotation,
  };
}

/** Nudges every non-consecutive, off-apron pair of corridors apart when they run closer than
 *  CORRIDOR_CLEARANCE_M, by translating each hole's tee and cup together (a translation cannot
 *  change a hole's own length, so this needs no rigid-length re-check of its own). Reuses
 *  `placedControl`/`polylineClearance` -- the same functions `inspectLayout` grades against --
 *  so the solver and its own test suite agree on what a conflict is. */
function applyCorridorRepulsion(holes: readonly LayoutHole[], tee: Vec2[], cup: Vec2[], clubhouse: Vec2): void {
  const placements = holes.map((h, i) => placementFromParticles(h, tee[i]!, cup[i]!));
  const centrelines = holes.map((h, i) => placedControl(h, placements[i]!));

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (j - i === 1) continue;
      const { distance, at } = polylineClearance(centrelines[i]!, centrelines[j]!);
      if (distance === 0 || distance >= CORRIDOR_CLEARANCE_M) continue;
      if (Math.hypot(at.x - clubhouse.x, at.z - clubhouse.z) <= CLUBHOUSE_APRON_M) continue;

      const push = (CORRIDOR_CLEARANCE_M - distance) / 2;
      const midA = { x: (tee[i]!.x + cup[i]!.x) / 2, z: (tee[i]!.z + cup[i]!.z) / 2 };
      const midB = { x: (tee[j]!.x + cup[j]!.x) / 2, z: (tee[j]!.z + cup[j]!.z) / 2 };
      const sep = Math.hypot(midB.x - midA.x, midB.z - midA.z) || 1;
      const dx = (midB.x - midA.x) / sep;
      const dz = (midB.z - midA.z) / sep;
      tee[i]!.x -= dx * push;
      tee[i]!.z -= dz * push;
      cup[i]!.x -= dx * push;
      cup[i]!.z -= dz * push;
      tee[j]!.x += dx * push;
      tee[j]!.z += dz * push;
      cup[j]!.x += dx * push;
      cup[j]!.z += dz * push;
    }
  }
}

export function relaxNine(
  holes: readonly LayoutHole[],
  initial: readonly HolePlacement[],
  hub: Vec2,
  clubhouse: Vec2,
): HolePlacement[] {
  if (holes.length === 0) return [];

  const byIndex = new Map(initial.map((p) => [p.index, p]));
  const tee: Vec2[] = [];
  const cup: Vec2[] = [];
  for (const hole of holes) {
    const placement = byIndex.get(hole.index)!;
    const t = { x: 0, z: 0 };
    const c = { x: 0, z: 0 };
    toCourseFrame(placement, hole.tee.x, hole.tee.z, t);
    toCourseFrame(placement, hole.cup.x, hole.cup.z, c);
    tee.push(t);
    cup.push(c);
  }

  const lengths = holes.map(chordOf);
  const lastCup = cup[cup.length - 1]!;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Re-pin every iteration rather than once: repulsion below moves every particle, including
    // hole 0's tee, and only re-pinning after the fact keeps the anchor exact without giving
    // repulsion special-case knowledge of which particle is pinned.
    tee[0] = { x: hub.x, z: hub.z };

    // The attractor moves first so the constraints below get the final say each iteration --
    // otherwise its pull on the last cup could leave a transition outside its slack bound with
    // nothing left in the same pass to correct it, and the *returned* placement (the last
    // iteration's result) would carry that overshoot uncorrected.
    lastCup.x += (clubhouse.x - lastCup.x) * ATTRACTOR_RATE;
    lastCup.z += (clubhouse.z - lastCup.z) * ATTRACTOR_RATE;

    for (let i = 0; i < holes.length; i++) {
      satisfyDistance(tee[i]!, cup[i]!, i === 0, false, lengths[i]!);
    }
    for (let i = 0; i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
    applyCorridorRepulsion(holes, tee, cup, clubhouse);
  }

  // Repulsion above runs last each iteration, so its final push is never re-checked against the
  // length/slack constraints before the loop exits. A short settle pass -- constraints only, no
  // attractor or repulsion to reintroduce a violation -- is what actually guarantees the
  // returned placements satisfy both, rather than merely having satisfied them mid-loop.
  for (let settle = 0; settle < 120; settle++) {
    tee[0] = { x: hub.x, z: hub.z };
    for (let i = 0; i < holes.length; i++) {
      satisfyDistance(tee[i]!, cup[i]!, i === 0, false, lengths[i]!);
    }
    for (let i = 0; i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
  }
  tee[0] = { x: hub.x, z: hub.z };

  return holes.map((hole, i) => placementFromParticles(hole, tee[i]!, cup[i]!));
}
