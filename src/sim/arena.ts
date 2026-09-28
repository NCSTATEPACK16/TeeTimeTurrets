import { AUTHORED_CLUBHOUSE } from "./authoredLayout";
import type { CourseWorld } from "./courseWorld";
import type { Vec2 } from "./mapGeometry";
import type { HoleSpec } from "./course";
import type { SouthBoundary } from "./courseBarrier";
import { coursePlayfield, holePlayfield } from "./playfield";
import type { Playfield } from "./playfield";
import type { SpawnHole } from "./spawn";
import { createSurfaces } from "./surfaces";
import { createTerrain } from "./terrain";

/**
 * Everything `Sim` needs to know about the place a match is fought: the ground, the tees carts
 * are dealt onto, the line they may not cross, and the seed their randomness grows from.
 *
 * The game has one mode -- the arena -- and this is the one input that decides *where*. The
 * shipped game stands on the eighteen-hole course (`arenaFromCourse`); a single hole is also a
 * complete, if small, arena (`arenaFromHole`), which is what most sim tests stand on because it
 * builds in milliseconds rather than a second.
 */
export interface ArenaGround {
  readonly playfield: Playfield;
  /** The holes whose tees carts are dealt onto, in course frame. At least one. */
  readonly holes: readonly SpawnHole[];
  /** The road carts are held north of, or null where there is none. */
  readonly southBoundary: SouthBoundary | null;
  /**
   * Where the clubhouse stands. With one, both teams spawn and respawn on pads either side of it
   * (`createTeamPads`); without one -- a single-hole test arena -- carts are dealt onto the tees.
   */
  readonly clubhouse: Vec2 | null;
  /**
   * Root of every seeded stream in the match -- each bot's and the respawn draw. Taken from the
   * ground rather than the clock, per the AGENTS.md no-`Math.random`-in-the-sim rule, so the same
   * ground replays the same match.
   */
  readonly seed: number;
}

/**
 * The shipped arena: all eighteen holes as one place.
 *
 * The seed is hole 1's. That is not a coincidence to tidy away -- it is the seed every arena match
 * has been played from since arena was built on top of a hole-1 `Sim`, and keeping it means the
 * recorded fingerprint in `arenaGolden.test.ts` still describes the same match.
 */
export function arenaFromCourse(world: CourseWorld): ArenaGround {
  const first = world.holes.find((h) => h.spec.index === 0) ?? world.holes[0];
  if (!first) throw new Error("arenaFromCourse: the course has no holes");
  return {
    playfield: coursePlayfield(world.grids),
    holes: world.holes,
    southBoundary: world.southBoundary,
    clubhouse: AUTHORED_CLUBHOUSE,
    seed: first.spec.seed,
  };
}

/**
 * One hole as a whole arena: its own field, no road, and two spawn points -- the tee facing the
 * cup and the cup facing the tee -- so the first two carts open at opposite ends rather than
 * stacked on one another.
 */
export function arenaFromHole(spec: HoleSpec): ArenaGround {
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  const frame = { index: spec.index, offsetX: 0, offsetZ: 0, rotation: 0 };
  return {
    playfield: holePlayfield(terrain, surfaces),
    holes: [
      { placement: frame, spec: { index: spec.index, tee: spec.tee, cup: spec.cup } },
      { placement: frame, spec: { index: spec.index, tee: spec.cup, cup: spec.tee } },
    ],
    southBoundary: null,
    clubhouse: null,
    seed: spec.seed,
  };
}
