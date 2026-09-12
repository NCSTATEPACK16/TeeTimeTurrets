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
  RETURNING_BELT_MAX_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  chordOf,
  placedControl,
  polylineClearance,
  returningPairs,
  toCourseFrame,
  type HolePlacement,
  type LayoutHole,
} from "./courseGeometry";

/** `Vec2`'s x/z are readonly (mapGeometry.ts) -- a point this module actually moves during
 *  relaxation needs a mutable version of the same shape. */
interface Particle {
  x: number;
  z: number;
}

const ITERATIONS = 200;
/** Fraction of the remaining distance to the clubhouse the last cup closes per iteration. Low
 *  enough that the rigid-length and slack constraints (which run first each iteration) get to
 *  react to each step rather than being dragged past their own limits by a single big jump. */
const ATTRACTOR_RATE = 0.08;

/**
 * How close to the exact clubhouse point the attractor pulls the last cup, in metres.
 *
 * Not zero: the clubhouse apron already holds hole 1's tee, hole 9's cup, hole 10's tee and
 * hole 18's cup by design, and pulling every nine's return to within a few centimetres of the
 * same point crowds them past what `courseTerrain.ts`'s blend and `courseSurfaces.ts`'s material
 * lookup were ever exercised against -- discovered as two failures downstream (a corridor
 * blended steeper than the hole's own terrain, and a cup reading as fairway instead of green)
 * when the attractor was left pulling all the way to the point. 25 m mirrors the margin the
 * shipped circle construction already closes to on its own (measured 30.0 m front / 120.0 m
 * back in docs/RESEARCH-ROUTING.md) and stays clear of the tighter front-nine return threshold
 * (`TRANSITION_M + 1` = 31 m).
 */
const RETURN_MARGIN_M = 25;

/** Moves `a`/`b` apart or together until `|b - a| === targetLen`, weighting the move by which
 *  endpoint is pinned. A pinned endpoint (weight 0) never moves; if neither is pinned each moves
 *  half the correction. */
function satisfyDistance(a: Particle, b: Particle, pinnedA: boolean, pinnedB: boolean, targetLen: number): void {
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
function satisfySlack(a: Particle, b: Particle, min: number, max: number): void {
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

/**
 * Holds each lobe's out and back corridors inside the returning belt: pushes them apart when they
 * are closer than `CORRIDOR_CLEARANCE_M`, pulls them together when they are further than
 * `RETURNING_BELT_MAX_M`, and does nothing in between. Slack, not a spring -- the same shape as
 * `satisfySlack`, measured on corridor clearance instead of endpoint distance.
 *
 * `placeNineAsLobes` already seeds the anti-parallel pairs this preserves; what it cannot do is
 * defend them. The clubhouse attractor drags the last cup home every iteration and the rigid-length
 * and slack constraints propagate that pull back up the chain, which rotates the interior holes off
 * their lobe bearings -- measured as the front nine falling from three returning legs in the seed
 * to two after 200 iterations, with the attractor as the *only* force responsible (disabling
 * repulsion or the side barrier instead makes it worse, not better: both are holding the shape).
 * So this is a preserving force, not a creating one.
 *
 * Translates each hole's tee and cup together, which cannot change a hole's own length and so
 * needs no rigid-length re-check of its own -- the same argument `applyCorridorRepulsion` makes.
 */
function satisfyReturningBelt(
  holes: readonly LayoutHole[],
  pairs: readonly [number, number][],
  tee: Particle[],
  cup: Particle[],
): void {
  if (pairs.length === 0) return;
  const placements = holes.map((h, i) => placementFromParticles(h, tee[i]!, cup[i]!));
  const centrelines = holes.map((h, i) => placedControl(h, placements[i]!));

  for (const [i, j] of pairs) {
    const { distance } = polylineClearance(centrelines[i]!, centrelines[j]!);
    // Zero means the corridors cross; there is no separating direction to move along, and the
    // corridor repulsion below is what is meant to resolve a crossing.
    if (distance === 0) continue;
    let move: number;
    if (distance < CORRIDOR_CLEARANCE_M) move = (CORRIDOR_CLEARANCE_M - distance) / 2;
    else if (distance > RETURNING_BELT_MAX_M) move = -(distance - RETURNING_BELT_MAX_M) / 2;
    else continue;

    const midA = { x: (tee[i]!.x + cup[i]!.x) / 2, z: (tee[i]!.z + cup[i]!.z) / 2 };
    const midB = { x: (tee[j]!.x + cup[j]!.x) / 2, z: (tee[j]!.z + cup[j]!.z) / 2 };
    const sep = Math.hypot(midB.x - midA.x, midB.z - midA.z) || 1;
    const dx = (midB.x - midA.x) / sep;
    const dz = (midB.z - midA.z) / sep;
    tee[i]!.x -= dx * move;
    tee[i]!.z -= dz * move;
    cup[i]!.x -= dx * move;
    cup[i]!.z -= dz * move;
    tee[j]!.x += dx * move;
    tee[j]!.z += dz * move;
    cup[j]!.x += dx * move;
    cup[j]!.z += dz * move;
  }
}

/** Nudges every non-consecutive, off-apron pair of corridors apart when they run closer than
 *  CORRIDOR_CLEARANCE_M, by translating each hole's tee and cup together (a translation cannot
 *  change a hole's own length, so this needs no rigid-length re-check of its own). Reuses
 *  `placedControl`/`polylineClearance` -- the same functions `inspectLayout` grades against --
 *  so the solver and its own test suite agree on what a conflict is. */
function applyCorridorRepulsion(holes: readonly LayoutHole[], tee: Particle[], cup: Particle[], clubhouse: Vec2): void {
  // A Gauss-Seidel push only ever approaches its target asymptotically, never reaches it exactly.
  // Aiming 1 m past CORRIDOR_CLEARANCE_M means a partially-converged result still lands strictly
  // clear of the threshold `inspectLayout` grades against, instead of asymptoting to within a
  // hair of it (and occasionally landing a float's width under, which reads as a conflict).
  // Computed per call rather than at module scope: `CORRIDOR_CLEARANCE_M` comes from courseLayout.ts,
  // which imports this module in turn, and a module-top-level read of it can run before
  // courseLayout.ts has finished initialising its own exports.
  const clearanceTargetM = CORRIDOR_CLEARANCE_M + 1;
  const placements = holes.map((h, i) => placementFromParticles(h, tee[i]!, cup[i]!));
  const centrelines = holes.map((h, i) => placedControl(h, placements[i]!));

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (j - i === 1) continue;
      const { distance, at } = polylineClearance(centrelines[i]!, centrelines[j]!);
      if (distance === 0 || distance >= clearanceTargetM) continue;
      if (Math.hypot(at.x - clubhouse.x, at.z - clubhouse.z) <= CLUBHOUSE_APRON_M) continue;

      const push = (clearanceTargetM - distance) / 2;
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
  expectedSign: number,
): HolePlacement[] {
  if (holes.length === 0) return [];

  const byIndex = new Map(initial.map((p) => [p.index, p]));
  const tee: Particle[] = [];
  const cup: Particle[] = [];
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
  const belts = returningPairs(holes);
  const lastCup = cup[cup.length - 1]!;

  // A hard barrier at the clubhouse line for every interior hole (not the first, which is
  // pinned, and not the last, whose cup is the attractor's own target and is expected to
  // approach clubhouse.z). Mirrors *both* of a hole's particles across the clubhouse line when
  // its cup lands on the
  // wrong side -- not the cup alone. A reflection is an isometry, so it preserves |cup - tee|
  // exactly; moving the cup by itself would silently break the rigid-length constraint that was
  // just satisfied, and the next iteration's length correction would drag it straight back
  // across, undoing the barrier before it ever reached the caller.
  const holdSide = (): void => {
    for (let i = 1; i < holes.length - 1; i++) {
      const z = cup[i]!.z - clubhouse.z;
      if (z !== 0 && Math.sign(z) !== expectedSign) {
        cup[i]!.z = clubhouse.z * 2 - cup[i]!.z;
        tee[i]!.z = clubhouse.z * 2 - tee[i]!.z;
      }
    }
  };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Re-pin every iteration rather than once: repulsion below moves every particle, including
    // hole 0's tee, and only re-pinning after the fact keeps the anchor exact without giving
    // repulsion special-case knowledge of which particle is pinned.
    tee[0] = { x: hub.x, z: hub.z };

    // The attractor moves first so the constraints below get the final say each iteration --
    // otherwise its pull on the last cup could leave a transition outside its slack bound with
    // nothing left in the same pass to correct it, and the *returned* placement (the last
    // iteration's result) would carry that overshoot uncorrected.
    //
    // Targets a point RETURN_MARGIN_M out from the clubhouse, on the line from the clubhouse
    // through the cup's own current position, rather than the clubhouse point itself -- a ring,
    // not a point. Once the cup is already inside the ring this pulls it back out to the ring
    // rather than the rest of the way to zero.
    {
      const dx = lastCup.x - clubhouse.x;
      const dz = lastCup.z - clubhouse.z;
      const dist = Math.hypot(dx, dz) || 1;
      const targetX = clubhouse.x + (dx / dist) * RETURN_MARGIN_M;
      const targetZ = clubhouse.z + (dz / dist) * RETURN_MARGIN_M;
      lastCup.x += (targetX - lastCup.x) * ATTRACTOR_RATE;
      lastCup.z += (targetZ - lastCup.z) * ATTRACTOR_RATE;
    }

    for (let i = 0; i < holes.length; i++) {
      satisfyDistance(tee[i]!, cup[i]!, i === 0, false, lengths[i]!);
    }
    for (let i = 0; i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
    // Before repulsion, not after: the belt can pull a pair together, and repulsion is what
    // guarantees the result still clears every *other* corridor. Running it last would let a
    // belt pull be the final word on a position no clearance check had seen.
    satisfyReturningBelt(holes, belts, tee, cup);
    applyCorridorRepulsion(holes, tee, cup, clubhouse);
    holdSide();
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
    holdSide();
  }
  tee[0] = { x: hub.x, z: hub.z };

  return holes.map((hole, i) => placementFromParticles(hole, tee[i]!, cup[i]!));
}

/**
 * A cross-nine cleanup pass over an already-relaxed (or already-fallen-back) 18-hole course.
 * `relaxNine` runs once per nine and never sees the other nine's corridors, so a front-nine hole
 * and a back-nine hole -- both pulled toward the same clubhouse point by their own attractors --
 * can converge into each other. `applyCorridorRepulsion` is generic over array position rather
 * than "nine": passed all 18 holes in index order, `j - i === 1` still means "consecutive hole",
 * so it needs no change to run globally instead of per-nine.
 */
export function polishCourse(
  holes: readonly LayoutHole[],
  placements: readonly HolePlacement[],
  frontHub: Vec2,
  backHub: Vec2,
  clubhouse: Vec2,
  frontSign: number,
  backSign: number,
): HolePlacement[] {
  if (holes.length === 0) return placements.slice();

  const byIndex = new Map(placements.map((p) => [p.index, p]));
  const tee: Particle[] = [];
  const cup: Particle[] = [];
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
  // Handed all eighteen holes, `returningPairs` keys off `hole.index` and so finds both nines'
  // lobes without this pass needing to know where the turn is.
  const belts = returningPairs(holes);
  // Both nines' first tees are pinned throughout -- this pass only nudges holes apart and settles
  // the resulting slack, it never re-decides where a nine starts. Position 0 is always the front
  // nine's first hole; the back nine's first hole is wherever hole index 9 landed in this array
  // (normally also position 9, since callers pass holes in index order).
  const frontPinIndex = 0;
  const backPinIndex = holes.findIndex((h) => h.index === 9);
  const pinned = (i: number): boolean => i === frontPinIndex || i === backPinIndex;

  // Same barrier as `relaxNine`, and for the same reason: a cross-nine repulsion push resolves a
  // clearance conflict by moving a hole away from whatever it collided with, which is blind to
  // which side of the clubhouse that leaves it on. `frontSign`/`backSign` come from the caller
  // rather than being inferred from the incoming layout -- for real, irregular hole lengths a
  // nine's own interior holes do not reliably lean toward the side its `outward` bearing intends.
  // Mirrors both of a hole's particles (see `relaxNine`'s `holdSide` for why not the cup alone).
  const mirror = (i: number): void => {
    cup[i]!.z = clubhouse.z * 2 - cup[i]!.z;
    tee[i]!.z = clubhouse.z * 2 - tee[i]!.z;
  };
  const holdSides = (): void => {
    for (let i = frontPinIndex + 1; backPinIndex > 0 && i < backPinIndex - 1; i++) {
      const z = cup[i]!.z - clubhouse.z;
      if (z !== 0 && Math.sign(z) !== frontSign) mirror(i);
    }
    for (let i = backPinIndex + 1; backPinIndex >= 0 && i < holes.length - 1; i++) {
      const z = cup[i]!.z - clubhouse.z;
      if (z !== 0 && Math.sign(z) !== backSign) mirror(i);
    }
  };

  for (let iter = 0; iter < 20; iter++) {
    if (frontPinIndex >= 0) tee[frontPinIndex] = { x: frontHub.x, z: frontHub.z };
    if (backPinIndex >= 0) tee[backPinIndex] = { x: backHub.x, z: backHub.z };

    satisfyReturningBelt(holes, belts, tee, cup);
    applyCorridorRepulsion(holes, tee, cup, clubhouse);

    for (let i = 0; i < holes.length; i++) {
      satisfyDistance(tee[i]!, cup[i]!, pinned(i), false, lengths[i]!);
    }
    for (let i = 0; i + 1 < 9 && i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
    for (let i = 9; i + 1 < 18 && i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
    holdSides();
  }
  if (frontPinIndex >= 0) tee[frontPinIndex] = { x: frontHub.x, z: frontHub.z };
  if (backPinIndex >= 0) tee[backPinIndex] = { x: backHub.x, z: backHub.z };

  return holes.map((hole, i) => placementFromParticles(hole, tee[i]!, cup[i]!));
}
