import { toCourseFrame } from "./courseGeometry";
import type { CourseFrame } from "./courseGeometry";
import type { Vec2 } from "./mapGeometry";
import { PAD_OFFSET_M, PAD_SLOTS, PAD_SLOT_SPACING_M } from "./spawn";

/**
 * Where the match is played: six of the eighteen holes, and the clubhouse the teams start from.
 *
 * The zone is the convex hull of those holes' corridor centrelines, the clubhouse and its team
 * pads, grown by `ZONE_PAD_M` all round. A hull rather than the union of the six corridors because
 * the union is not one piece -- the clubhouse sits a drive away from every tee -- and a zone a cart
 * has to leave to get from its pad to a fairway is a zone that punishes playing. A hull is also
 * the cheapest shape to ask "how far outside?" of, which the tick does for every cart.
 *
 * Crossing the edge is allowed, and costs: `Sim` drains `OOB_DRAIN_HP` every `OOB_DRAIN_INTERVAL_S`
 * outside, and holds the cart `ZONE_CLAMP_REACH_M` past the edge at most. Bots are only ever sent
 * to points inside it.
 *
 * DOM-free and allocation-free on the query path: `zoneSignedDistance` and `clampToZone` are
 * called per cart per tick.
 */

/** Holes 1, 9, 10, 14, 15 and 18, by index. docs/DECISIONS.md "The match is played on six holes". */
export const ARENA_HOLE_INDICES = [0, 8, 9, 13, 14, 17] as const;
/** Metres the edge stands off the hull: wider than any corridor's half-width, so the rough counts. */
export const ZONE_PAD_M = 45;
/** How far past the edge a cart may go before it is held. */
export const ZONE_CLAMP_REACH_M = 30;
export const OOB_DRAIN_INTERVAL_S = 2;
export const OOB_DRAIN_HP = 1;

/** The slice of a placed hole the zone is built from; `PlacedHole` satisfies it. */
export interface ZoneHole {
  readonly placement: CourseFrame;
  readonly spec: {
    readonly index: number;
    readonly tee: Vec2;
    readonly cup: Vec2;
    readonly control: readonly Vec2[];
  };
}

export interface ArenaZone {
  /** Counter-clockwise in (x, z), no three points collinear. */
  readonly hull: readonly Vec2[];
  /** Metres the edge stands off the hull. */
  readonly pad: number;
}

/** The zone around `points`, its edge `pad` metres out. */
export function createZoneFromPoints(points: readonly Vec2[], pad: number): ArenaZone {
  return { hull: convexHull(points), pad };
}

/** The shipped zone: `ARENA_HOLE_INDICES` of `holes`, and the clubhouse with its team pads. */
export function createArenaZone(holes: readonly ZoneHole[], clubhouse: Vec2 | null, pad = ZONE_PAD_M): ArenaZone {
  const points: Vec2[] = [];
  const scratch = { x: 0, z: 0 };
  for (const hole of holes) {
    if (!(ARENA_HOLE_INDICES as readonly number[]).includes(hole.spec.index)) continue;
    for (const p of [hole.spec.tee, ...hole.spec.control, hole.spec.cup]) {
      toCourseFrame(hole.placement, p.x, p.z, scratch);
      points.push({ x: scratch.x, z: scratch.z });
    }
  }
  if (clubhouse !== null) {
    points.push({ x: clubhouse.x, z: clubhouse.z });
    // The pads run north of the clubhouse either side of it; see `createTeamPads`.
    const north = PAD_SLOTS * PAD_SLOT_SPACING_M;
    for (const side of [-1, 1]) {
      points.push({ x: clubhouse.x + side * PAD_OFFSET_M, z: clubhouse.z });
      points.push({ x: clubhouse.x + side * PAD_OFFSET_M, z: clubhouse.z + north });
    }
  }
  if (points.length < 3) throw new Error("createArenaZone: fewer than three points; none of the arena holes are here");
  return createZoneFromPoints(points, pad);
}

/** Metres outside the zone's edge; negative inside. */
export function zoneSignedDistance(zone: ArenaZone, x: number, z: number): number {
  const hull = zone.hull;
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    if (ex * (z - a.z) - ez * (x - a.x) < 0) inside = false;
    const d = segmentDistanceSq(a, ex, ez, x, z);
    if (d < best) best = d;
  }
  const d = Math.sqrt(best);
  return (inside ? -d : d) - zone.pad;
}

/**
 * Holds (x, z) no more than `reach` metres outside the edge. Returns whether it moved it.
 *
 * Pulled straight back toward the nearest point of the hull, so a cart driven along the limit
 * slides along it rather than stopping.
 */
export function clampToZone(zone: ArenaZone, x: number, z: number, reach: number, out: { x: number; z: number }): boolean {
  out.x = x;
  out.z = z;
  if (zoneSignedDistance(zone, x, z) <= reach) return false;
  const hull = zone.hull;
  let best = Infinity;
  let qx = 0;
  let qz = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = clamp01(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez));
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) {
      best = d;
      qx = px;
      qz = pz;
    }
  }
  const len = Math.sqrt(best);
  const r = zone.pad + reach;
  out.x = qx + ((x - qx) / len) * r;
  out.z = qz + ((z - qz) / len) * r;
  return true;
}

/**
 * Evenly spaced points along the edge, no further apart than `spacing`, counter-clockwise: where
 * the stakes go. The edge is the hull's sides pushed out by the pad, joined by arcs at its corners.
 */
export function zoneEdgePoints(zone: ArenaZone, spacing: number): Vec2[] {
  const hull = zone.hull;
  const n = hull.length;
  // The outward normal of side i (a -> b, counter-clockwise, so outward is to the right).
  const normal = (i: number): Vec2 => {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
  };
  const pieces: { length: number; at: (s: number) => Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const nrm = normal(i);
    const sx = a.x + nrm.x * zone.pad;
    const sz = a.z + nrm.z * zone.pad;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const length = Math.hypot(ex, ez);
    pieces.push({ length, at: (s) => ({ x: sx + (ex * s) / length, z: sz + (ez * s) / length }) });
    // Round the corner at b, from this side's normal to the next side's.
    const next = normal((i + 1) % n);
    const from = Math.atan2(nrm.z, nrm.x);
    let sweep = Math.atan2(next.z, next.x) - from;
    // Counter-clockwise, so the normals turn the same way, by less than a half turn.
    while (sweep < 0) sweep += 2 * Math.PI;
    while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
    const arc = sweep * zone.pad;
    pieces.push({
      length: arc,
      at: (s) => {
        const angle = from + (arc === 0 ? 0 : (sweep * s) / arc);
        return { x: b.x + Math.cos(angle) * zone.pad, z: b.z + Math.sin(angle) * zone.pad };
      },
    });
  }
  const total = pieces.reduce((sum, p) => sum + p.length, 0);
  const count = Math.max(3, Math.ceil(total / spacing));
  const step = total / count;
  const out: Vec2[] = [];
  let piece = 0;
  let start = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (piece < pieces.length - 1 && s > start + pieces[piece]!.length) {
      start += pieces[piece]!.length;
      piece++;
    }
    out.push(pieces[piece]!.at(Math.min(pieces[piece]!.length, s - start)));
  }
  return out;
}

/** Points of health to drain on the tick that took a cart from `before` to `after` seconds outside. */
export function outOfBoundsDrain(before: number, after: number): number {
  return (Math.floor(after / OOB_DRAIN_INTERVAL_S + 1e-9) - Math.floor(before / OOB_DRAIN_INTERVAL_S + 1e-9)) * OOB_DRAIN_HP;
}

/** Andrew's monotone chain, counter-clockwise in (x, z) with z up the page. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function segmentDistanceSq(a: Vec2, ex: number, ez: number, x: number, z: number): number {
  const t = clamp01(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez));
  const dx = x - (a.x + ex * t);
  const dz = z - (a.z + ez * t);
  return dx * dx + dz * dz;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
