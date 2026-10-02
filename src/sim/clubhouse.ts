import {
  BARN_PLACEMENTS,
  CLUBHOUSE_PLACEMENT,
  FOOD_CART_PLACEMENT,
  LAMP_PLACEMENTS,
  placedAt,
  type KitPlacement,
} from "./clubhouseLayout";
import type { Obstacle } from "./lineOfSight";
import type { Vec2 } from "./mapGeometry";

/**
 * What the clubhouse complex is to the simulation: the static shapes carts and balls hit, and the
 * footprints that block a sight line (`docs/art/specs/sim-slices.md`). Placements come from
 * `clubhouseLayout.ts`, the table the renderer reads, so a building and its collider cannot drift.
 *
 * Shapes are authored in **graph space**, the frame each piece was modelled in (origin at ground
 * contact, +y up), and placed exactly as `src/render/clubhouse.ts` places the mesh: rotated by
 * the placement's yaw and standing at the terrain height under the placement's centre. Every
 * shape reaches `SINK_M` below that, as the plinths do, so a dip in the ground under one corner
 * does not open a gap a cart can slip through.
 *
 * Pure data and pure maths: Rapier is `world.ts`'s business (`addStaticColliders`).
 */

/** How far every shape reaches below its piece's base: the clubhouse plinth is modelled to -1. */
export const SINK_M = 1;

/** A box in graph space: its x/z extents and its top, from `-SINK_M`. */
export interface LocalBox {
  readonly name: string;
  readonly kind: "box";
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly top: number;
}

/** An upright cylinder in graph space, centred on (x, z), from `-SINK_M` to `top`. */
export interface LocalCylinder {
  readonly name: string;
  readonly kind: "cylinder";
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly top: number;
}

export type LocalShape = LocalBox | LocalCylinder;

/** The pieces that collide. The lot is flush with the ground and has no collider (`lot.md`). */
export type CollidingPiece = "clubhouse" | "team_barn" | "food_cart" | "lamp_post";

const box = (name: string, minX: number, maxX: number, minZ: number, maxZ: number, top: number): LocalBox => ({
  name,
  kind: "box",
  minX,
  maxX,
  minZ,
  maxZ,
  top,
});

/** The barn's five front posts: 0.25 m square, as exported. */
const BARN_POST_Z = [-11.845, -6.005, 0, 6.005, 11.845];

/**
 * Each piece's colliders, in graph space. The numbers are the asset specs' (`clubhouse.md`,
 * `team-barn.md`, `food-cart.md`, `lot.md`), corrected to the as-built exports.
 */
export const KIT_SHAPES: Readonly<Record<CollidingPiece, readonly LocalShape[]>> = {
  clubhouse: [
    box("clubhouse_block", -10, 10, -7, 4, 6.4),
    // Over the whole plinth, so carts cannot drive onto the verandah: a 0.6 m step is a KCC edge
    // case not worth owning.
    box("clubhouse_verandah", -12, 12, -7, 7, 3.6),
    // The entrance steps stand outside the plinth (`clubhouse.md`, As built).
    box("clubhouse_steps", -1.5, 1.5, 7, 7.9, 0.6),
  ],
  team_barn: [
    box("barn_back", -4, -3.7, -12, 12, 3.5),
    box("barn_end_n", -4, 4, 11.7, 12, 3.5),
    box("barn_end_s", -4, 4, -12, -11.7, 3.5),
    ...BARN_POST_Z.map((z, i) => box(`barn_post${i}`, 3.73, 3.98, z - 0.125, z + 0.125, 3.5)),
  ],
  food_cart: [box("food_cart", -1.3, 1.3, -0.7, 0.7, 2.1)],
  lamp_post: [{ name: "lamp", kind: "cylinder", x: 0, z: 0, radius: 0.18, top: 5.4 }],
};

/**
 * Each colliding piece's ground footprint in graph space, **measured from the exported JSON**: the
 * x/z extent of every mesh that reaches within 0.5 m of the ground, which leaves out roof
 * overhangs a cart drives under. `clubhouseGraph.test.ts` holds this to the export and
 * `clubhouse.test.ts` holds the colliders to this, each within 0.1 m: this table is the one place
 * the two sides meet.
 */
export const KIT_FOOTPRINTS: Readonly<
  Record<CollidingPiece, { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }>
> = {
  clubhouse: { minX: -12, maxX: 12, minZ: -7, maxZ: 7.9 },
  team_barn: { minX: -4, maxX: 4, minZ: -12, maxZ: 12 },
  food_cart: { minX: -1.3, maxX: 1.3, minZ: -0.675, maxZ: 0.74 },
  lamp_post: { minX: -0.18, maxX: 0.18, minZ: -0.18, maxZ: 0.18 },
};

/**
 * The sight-line blockers, one rectangle per building, in graph space, topped at the ridge. The
 * lamps are too thin to count. A barn is one solid rectangle, open front and all: a cart parked
 * inside one is hidden, which is a feature.
 */
const KIT_BLOCKERS: readonly { piece: CollidingPiece; box: LocalBox }[] = [
  { piece: "clubhouse", box: box("clubhouse", -12, 12, -7, 7, 6.4) },
  { piece: "team_barn", box: box("team_barn", -4, 4, -12, 12, 4.9) },
  { piece: "food_cart", box: box("food_cart", -1.3, 1.3, -0.7, 0.7, 2.1) },
];

/** A shape placed in the world. `yaw` turns about +Y, as three and Rapier both read it. */
export interface StaticShape {
  readonly name: string;
  readonly kind: "box" | "cylinder";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Box half extents; for a cylinder, `hx` is the radius and `hy` the half height. */
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly yaw: number;
}

type HeightAt = (x: number, z: number) => number;

/** Where each colliding piece stands: the one table, `clubhouseLayout.ts`. */
function placements(): readonly { piece: CollidingPiece; at: KitPlacement }[] {
  return [
    { piece: "clubhouse", at: CLUBHOUSE_PLACEMENT },
    ...BARN_PLACEMENTS.map((at) => ({ piece: "team_barn" as const, at })),
    { piece: "food_cart", at: FOOD_CART_PLACEMENT },
    ...LAMP_PLACEMENTS.map((at) => ({ piece: "lamp_post" as const, at })),
  ];
}

/**
 * A graph-space point turned by `yaw` about +Y and moved to `origin`. Three's rotation about Y
 * maps (x, z) to (x cos + z sin, -x sin + z cos); the renderer places the mesh with it.
 */
function toWorld(origin: Vec2, yaw: number, x: number, z: number, out: { x: number; z: number }): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = origin.x + x * c + z * s;
  out.z = origin.z - x * s + z * c;
}

/** Every static shape of the complex around `centre`, in world space. Built once per match. */
export function clubhouseShapes(centre: Vec2, heightAt: HeightAt): StaticShape[] {
  const shapes: StaticShape[] = [];
  const at = { x: 0, z: 0 };
  for (const { piece, at: p } of placements()) {
    const origin = placedAt(centre, p);
    const base = heightAt(origin.x, origin.z);
    for (const s of KIT_SHAPES[piece]) {
      const hy = (s.top + SINK_M) / 2;
      const y = base - SINK_M + hy;
      if (s.kind === "box") {
        toWorld(origin, p.yaw, (s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2, at);
        shapes.push({
          name: s.name,
          kind: "box",
          x: at.x,
          y,
          z: at.z,
          hx: (s.maxX - s.minX) / 2,
          hy,
          hz: (s.maxZ - s.minZ) / 2,
          yaw: p.yaw,
        });
      } else {
        toWorld(origin, p.yaw, s.x, s.z, at);
        shapes.push({ name: s.name, kind: "cylinder", x: at.x, y, z: at.z, hx: s.radius, hy, hz: s.radius, yaw: 0 });
      }
    }
  }
  return shapes;
}

/** The buildings as sight-line blockers around `centre`, for `hasLineOfSight`. */
export function clubhouseObstacles(centre: Vec2, heightAt: HeightAt): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const at = { x: 0, z: 0 };
  for (const { piece, at: p } of placements()) {
    const blocker = KIT_BLOCKERS.find((b) => b.piece === piece);
    if (!blocker) continue;
    const origin = placedAt(centre, p);
    const base = heightAt(origin.x, origin.z);
    const b = blocker.box;
    toWorld(origin, p.yaw, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, at);
    obstacles.push({
      x: at.x,
      z: at.z,
      halfX: (b.maxX - b.minX) / 2,
      halfZ: (b.maxZ - b.minZ) / 2,
      cos: Math.cos(p.yaw),
      sin: Math.sin(p.yaw),
      top: base + b.top,
    });
  }
  return obstacles;
}
