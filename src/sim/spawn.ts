import { toCourseFrame } from "./courseLayout";
import type { CourseFrame } from "./courseLayout";
import type { Vec2 } from "./mapGeometry";
import { SPAWN_CLEARANCE_M, SPAWN_TRIES } from "./matchConfig";

/**
 * Where a cart starts a match, and where it comes back.
 *
 * Arena spawns on the eighteen tees, which is the one set of points on the course that is
 * guaranteed to be flat, drivable, spread out and pointing somewhere. Stage B's `loadCourse`
 * re-teed every cart onto "ground that exists and no further", which in the course frame is
 * wherever hole 1 happens to sit -- so a match opened with every cart parked on top of each
 * other by the clubhouse. This is the module that was named as the answer.
 *
 * DOM-free and Rapier-free: it takes a height sampler and a random stream and returns points.
 * Never `Math.random()`, per `AGENTS.md` -- the stream is injected so a match is reproducible
 * from its seed.
 */

/**
 * The structural slice of a `PlacedHole` this module needs: where the hole sits in the course
 * frame, and its tee and cup in its own. Structural so the tests need neither a generated course
 * nor a `Terrain`; `PlacedHole` satisfies it as it stands.
 */
export interface SpawnHole {
  readonly placement: CourseFrame;
  readonly spec: {
    readonly index: number;
    readonly tee: Vec2;
    readonly cup: Vec2;
  };
}

/** Anything with a position and a pulse. `Cart` satisfies it as it stands. */
export interface SpawnOccupant {
  readonly position: { readonly x: number; readonly z: number };
  readonly dead: boolean;
}

export interface SpawnPoint {
  readonly x: number;
  /** Ground height at the tee. The caller adds its own collider offset; this is the ground. */
  readonly y: number;
  readonly z: number;
  /**
   * Chassis yaw, radians, pointing down the hole at its cup **in the course frame**.
   *
   * Not decoration. A cart spawned at yaw 0 on hole 14 is pointing at whatever happens to be
   * west of it, which on a course laid out around a loop is usually a neighbouring fairway.
   */
  readonly heading: number;
  /** 0-based hole index this tee belongs to, for a scoreboard or a map that wants to say where. */
  readonly hole: number;
}

const scratch = { x: 0, z: 0 };

/**
 * The eighteen tees, in the course frame, at ground height, each facing its own cup.
 *
 * Built once per match rather than per respawn: the tees do not move, and `heightAt` on the
 * assembled course is 3 µs a call.
 */
export function createSpawnSet(
  holes: readonly SpawnHole[],
  heightAt: (x: number, z: number) => number,
): SpawnPoint[] {
  const set: SpawnPoint[] = [];
  for (const hole of holes) {
    toCourseFrame(hole.placement, hole.spec.tee.x, hole.spec.tee.z, scratch);
    const teeX = scratch.x;
    const teeZ = scratch.z;
    toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, scratch);
    set.push({
      x: teeX,
      y: heightAt(teeX, teeZ),
      z: teeZ,
      heading: Math.atan2(scratch.z - teeZ, scratch.x - teeX),
      hole: hole.spec.index,
    });
  }
  return set;
}

/**
 * Where cart `index` starts the match.
 *
 * Dealt rather than drawn. "Carts start spread across the eighteen holes" is a property that
 * has no reason to vary within a seed, and a deal gives it exactly, without spending a draw or
 * risking two carts on one tee at the one moment of the match when everybody is stationary.
 * A roster longer than the course wraps, which is the only case where two carts share a tee.
 */
export function openingSpawn(set: readonly SpawnPoint[], index: number): SpawnPoint {
  return set[index % set.length]!;
}

/**
 * A tee to come back to.
 *
 * Draws from `random` and rejects any tee within `SPAWN_CLEARANCE_M` of a living cart other than
 * the one respawning, up to `SPAWN_TRIES` attempts. `self` is that cart's index in `occupants`:
 * its own body is still lying wherever it died, and counting it would make the tee it died
 * nearest to permanently unavailable to it.
 *
 * When every tee is contested the fallback takes **the one farthest from its nearest living
 * cart** rather than an arbitrary one. A fallback that returns index 0 puts every contested
 * respawn in a match on the same tee, which is the worst possible answer to "it is crowded".
 *
 * Returns a point from `set`, never a new one, so this allocates nothing.
 */
export function respawnPoint(
  set: readonly SpawnPoint[],
  random: () => number,
  occupants: readonly SpawnOccupant[],
  self: number,
): SpawnPoint {
  for (let attempt = 0; attempt < SPAWN_TRIES; attempt++) {
    const candidate = set[Math.floor(random() * set.length) % set.length]!;
    if (nearestLive(candidate, occupants, self) >= SPAWN_CLEARANCE_M) return candidate;
  }

  let best = set[0]!;
  let bestDistance = -1;
  for (const candidate of set) {
    const distance = nearestLive(candidate, occupants, self);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Distance to the closest living cart that is not `self`. `Infinity` when there are none. */
function nearestLive(point: SpawnPoint, occupants: readonly SpawnOccupant[], self: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < occupants.length; i++) {
    if (i === self) continue;
    const occupant = occupants[i]!;
    if (occupant.dead) continue;
    const distance = Math.hypot(occupant.position.x - point.x, occupant.position.z - point.z);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}
