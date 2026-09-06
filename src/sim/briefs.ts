/**
 * The course bible as data -- eighteen authored `HoleBrief`s.
 *
 * This is the authoring unit described in docs/COURSE_PIPELINE.md sections 3 and 4: you author
 * intent, the generator produces coordinates. It is what keeps the properties that make the
 * current system good -- a hole is reconstructible from a uint32, so multiplayer ships a seed
 * rather than a level file, and rejection sampling still guarantees playability -- while giving
 * real design control over what each hole *is*.
 *
 * Nothing reads this yet. `generateHole` consumes it at step 6 of the section 9 build order; the
 * point of landing it first is that design intent becomes reviewable before any generator work,
 * and Tier 2 (water polygons, placed bunkers) has something to be checked against instead of
 * polygons hand-tuned against nothing.
 *
 * Plain data: DOM-free, no Rapier, no Three, same as the rest of src/sim.
 */

import type { BiomeId } from "./course";

/**
 * The shape of a hole, as a golf architect would name it rather than as coordinates.
 *
 * `drivable` and `cape` are the two that carry a distance claim rather than only a shape:
 * a drivable par 4 is short enough to reach from the tee, and a cape asks you to choose how much
 * of a hazard to carry on the diagonal.
 */
export type Archetype =
  | "straightaway"
  | "dogleg"
  | "cape"
  | "double-dogleg"
  | "island-green"
  | "forced-carry"
  | "drivable";

/**
 * Tree density in the rough. **This is the combat axis, not a golf one.**
 *
 * A 300 m dead-straight par 5 at 19 m half-width is a shooting gallery; a tight dogleg with dense
 * cover is a knife fight. That axis exists in this game and in no real course, and it was entirely
 * absent from the superseded shot list, which described eighteen climates and no arenas.
 */
export type Cover = "open" | "moderate" | "dense";

/** Where a bunker sits, relative to the routing -- never a coordinate. See the `HoleBrief` note. */
export type BunkerPlacement =
  | "greenside-left"
  | "greenside-right"
  | "fairway-elbow"
  | "landing-zone"
  | "carry";

/** How water relates to the corridor. `island` means the green, not a pond in the rough. */
export type WaterForm =
  | "crossing"
  | "lateral-left"
  | "lateral-right"
  | "inside-elbow"
  | "island";

export interface HazardSchema {
  readonly bunkers: {
    readonly count: number;
    readonly placement: readonly BunkerPlacement[];
  };
  readonly water: null | { readonly form: WaterForm };
}

export type DoglegDir = "none" | "left" | "right" | "s-curve";

export interface HoleBrief {
  /** 1..18. One-based, because this is the scorecard's numbering, not an array index. */
  readonly number: number;
  readonly parTarget: 3 | 4 | 5;
  readonly archetype: Archetype;
  /** `severity` is 0..1, and is 0 exactly when `dir` is `none`. */
  readonly dogleg: { readonly dir: DoglegDir; readonly severity: number };
  readonly biome: BiomeId;
  /** Corridor half-widths in metres, at the tee, the middle and the green. See `COVER_CORRIDOR`. */
  readonly corridor: {
    readonly start: number;
    readonly mid: number;
    readonly end: number;
  };
  readonly cover: Cover;
  readonly hazards: HazardSchema;
  readonly signature: boolean;
  /** Strategic intent, for humans. Never read by code. */
  readonly note: string;
}

/**
 * Corridor half-widths, in metres, derived from `cover` rather than authored per hole.
 *
 * The section 4 table has a `cover` column and no width column, so these are the missing link
 * between them, and they are anchored rather than invented:
 *
 * **`moderate` is exactly today's `HALF_WIDTH` (15, terrain.ts).** That is deliberate and it is
 * the reviewable property. When Tier 2 lands and the generator finally varies corridor width, the
 * eleven moderate holes must render byte-identically to today or something is wrong -- which makes
 * a change that touches every hole in the course reviewable one hole at a time.
 *
 * The mid value pinches slightly on every setting: a corridor that narrows through the landing
 * zone and reopens at the green is the shape that makes a drive a decision. A constant width is a
 * hallway.
 */
export const COVER_CORRIDOR: Readonly<
  Record<Cover, { start: number; mid: number; end: number }>
> = {
  dense: { start: 11, mid: 10, end: 12 },
  moderate: { start: 15, mid: 14, end: 15 },
  open: { start: 19, mid: 18, end: 19 },
};

/** No bunkers. Spelled once so eleven holes do not each repeat the empty literal. */
const NO_BUNKERS = { count: 0, placement: [] as readonly BunkerPlacement[] } as const;

function bunkers(...placement: BunkerPlacement[]): HazardSchema["bunkers"] {
  return { count: placement.length, placement };
}

/**
 * The eighteen briefs, hole 1 to hole 18.
 *
 * Transcribed from the table in docs/COURSE_PIPELINE.md section 4. Four properties of that table
 * are asserted in briefs.test.ts against independent sources rather than trusted here: par against
 * `PAR_MIX`, biome against `BIOME_ROUTING`, the adjacent-dogleg rule, and whether an authored
 * corridor width still leaves room for its par band.
 *
 * **Declarative, never geometric.** A brief says `placement: 'fairway-elbow'` and the generator
 * resolves that to coordinates from the seed. A brief that named a coordinate would have defeated
 * the whole point -- the system exists so a hole is reconstructible from a uint32.
 *
 * Where the section 4 table says "3 pot bunkers, greenside" and the vocabulary only offers
 * `greenside-left` and `greenside-right`, the left/right split is arbitrary and stays arbitrary
 * until the generator resolves placements against the routing it drew. Do not read intent into it.
 */
export const COURSE_BRIEFS: readonly HoleBrief[] = [
  {
    number: 1,
    parTarget: 4,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: { bunkers: bunkers("landing-zone", "landing-zone"), water: null },
    signature: false,
    note: "Wide, gentle opener. Nothing punitive. The first hole is where a player learns the swing HUD, not where they are tested.",
  },
  {
    number: 2,
    parTarget: 3,
    archetype: "forced-carry",
    dogleg: { dir: "none", severity: 0 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: NO_BUNKERS, water: { form: "crossing" } },
    signature: false,
    note: "Small carry over the creek. The round's first real decision, and a cheap one -- the carry is short enough that failing it is embarrassing rather than costly.",
  },
  {
    number: 3,
    parTarget: 4,
    archetype: "dogleg",
    dogleg: { dir: "left", severity: 0.4 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: bunkers("fairway-elbow", "fairway-elbow"), water: null },
    signature: false,
    note: "Cut the corner, or lay back to the wide side. The elbow bunkers price the aggressive line.",
  },
  {
    number: 4,
    parTarget: 5,
    archetype: "double-dogleg",
    dogleg: { dir: "s-curve", severity: 0.5 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: {
      bunkers: bunkers("carry", "greenside-left", "greenside-right"),
      water: null,
    },
    signature: false,
    note: "Three-shot hole. Reachable in two only from the inside line, which the carry bunker guards.",
  },
  {
    number: 5,
    parTarget: 4,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.dense,
    cover: "dense",
    hazards: { bunkers: bunkers("greenside-right"), water: null },
    signature: false,
    note: "Narrow tree corridor -- the round's first knife fight. Straight as a golf hole, claustrophobic as an arena.",
  },
  {
    number: 6,
    parTarget: 3,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "links",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: {
      bunkers: bunkers("greenside-left", "greenside-left", "greenside-right"),
      water: null,
    },
    signature: false,
    note: "Exposed. Wind and a small target, ringed by pot bunkers. The biome changes here and the hole is short enough to notice it.",
  },
  {
    number: 7,
    parTarget: 4,
    archetype: "cape",
    dogleg: { dir: "right", severity: 0.8 },
    biome: "links",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: {
      bunkers: bunkers("greenside-left", "greenside-left"),
      water: { form: "inside-elbow" },
    },
    signature: true,
    note: "SIGNATURE. Carry as much of the inside water as you dare; every extra metre of carry is a shorter approach. The purest risk/reward hole on the card.",
  },
  {
    number: 8,
    parTarget: 4,
    archetype: "drivable",
    dogleg: { dir: "none", severity: 0 },
    biome: "links",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: bunkers("landing-zone", "landing-zone"), water: null },
    signature: false,
    note: "Short, blind over a dune ridge. Eagle or trouble, and you cannot see which until you drive over the crest.",
  },
  {
    number: 9,
    parTarget: 5,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "links",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: { bunkers: NO_BUNKERS, water: { form: "lateral-right" } },
    signature: false,
    note: "Long and dead straight. Benign as golf; in cart combat it is a shooting gallery with no cover for 300 m.",
  },
  {
    number: 10,
    parTarget: 4,
    archetype: "dogleg",
    dogleg: { dir: "left", severity: 0.5 },
    biome: "links",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: bunkers("fairway-elbow"), water: null },
    signature: false,
    note: "Turn around the dune. Position over power -- the long line runs out of fairway.",
  },
  {
    number: 11,
    parTarget: 5,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "links",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: bunkers("carry", "greenside-right"), water: null },
    signature: false,
    note: "Longest on the card. The hard stretch begins here and does not let up until 15.",
  },
  {
    number: 12,
    parTarget: 4,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "marsh",
    corridor: COVER_CORRIDOR.dense,
    cover: "dense",
    hazards: { bunkers: NO_BUNKERS, water: { form: "lateral-left" } },
    signature: false,
    note: "Narrow, with a boardwalk crossing. Claustrophobic -- dense cover on one side, open water on the other, and nowhere to break contact.",
  },
  {
    number: 13,
    parTarget: 3,
    archetype: "island-green",
    dogleg: { dir: "none", severity: 0 },
    biome: "marsh",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: { bunkers: NO_BUNKERS, water: { form: "island" } },
    signature: true,
    note: "SIGNATURE. All carry, no bail-out. The shortest hole on the card and the one most likely to end a round.",
  },
  {
    number: 14,
    parTarget: 4,
    archetype: "dogleg",
    dogleg: { dir: "right", severity: 0.6 },
    biome: "marsh",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: NO_BUNKERS, water: { form: "lateral-right" } },
    signature: false,
    note: "The whole right side is wet, and the dogleg turns into it. Hug the water or bail left and add a shot.",
  },
  {
    number: 15,
    parTarget: 4,
    archetype: "forced-carry",
    dogleg: { dir: "none", severity: 0 },
    biome: "marsh",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: NO_BUNKERS, water: { form: "crossing" } },
    signature: false,
    note: "Full carry over wetland -- the same idea as hole 2 at four times the length, and the last of the hard stretch.",
  },
  {
    number: 16,
    parTarget: 3,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: {
      bunkers: bunkers("greenside-left", "greenside-right"),
      water: null,
    },
    signature: false,
    note: "Downhill and receptive. The comeback hole: parkland returns, the water stops, and a player who survived 11-15 is allowed to breathe.",
  },
  {
    number: 17,
    parTarget: 4,
    archetype: "dogleg",
    dogleg: { dir: "left", severity: 0.7 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.dense,
    cover: "dense",
    hazards: {
      bunkers: bunkers("fairway-elbow", "greenside-left"),
      water: null,
    },
    signature: false,
    note: "Tightest driving hole on the course. The test -- a sharp dogleg through dense cover, placed where a match is usually decided.",
  },
  {
    number: 18,
    parTarget: 5,
    archetype: "double-dogleg",
    dogleg: { dir: "s-curve", severity: 0.3 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.open,
    cover: "open",
    hazards: {
      bunkers: bunkers("greenside-left", "greenside-right"),
      water: { form: "crossing" },
    },
    signature: true,
    note: "SIGNATURE. Reachable finisher past the clubhouse. Gentle s-curve, open cover -- a hole that can be won, which is what a closing hole is for.",
  },
];

/** By scorecard number, 1..18. Throws rather than returning undefined on a number off the card. */
export function briefForHole(number: number): HoleBrief {
  const brief = COURSE_BRIEFS[number - 1];
  if (brief === undefined) {
    throw new RangeError(
      `no brief for hole ${number}: the course bible covers 1..${COURSE_BRIEFS.length}`,
    );
  }
  return brief;
}
