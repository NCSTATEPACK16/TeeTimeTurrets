import { authoredCourse } from "../authoredCourse";
import { AUTHORED_PLACEMENTS } from "../authoredLayout";
import { bakeCourseGrids } from "../courseGrids";
import { createCourseSurfaces } from "../courseSurfaces";
import { createCourseTerrain } from "../courseTerrain";
import type { CourseTerrain, PlacedHole } from "../courseTerrain";
import { coursePlayfield } from "../playfield";
import type { ArenaGround } from "../arena";
import { mulberry32 } from "../rng";
import { createSurfaces } from "../surfaces";
import type { Surfaces } from "../surfaces";
import { createTerrain } from "../terrain";

/**
 * A few of the real authored holes, in their real places, blended into one course at a coarse
 * cell -- the shipped assembly, at a test's budget rather than a level load's.
 *
 * Test-only. It exists so sim tests stand on the ground the game actually ships rather than on a
 * generated stand-in: `docs/TEST-AND-SPEC-PITFALLS.md` records a test whose fixture diverged from
 * the shipped course and stayed green while the shipped path was broken.
 */
export interface MiniCourse {
  readonly terrain: CourseTerrain;
  readonly surfaces: Surfaces;
  readonly holes: readonly PlacedHole[];
  readonly ground: ArenaGround;
}

const cache = new Map<string, MiniCourse>();

/**
 * The first `holeCount` authored holes at `cellM`-metre cells. Memoised: the result is read-only,
 * and only the `Sim` built on top of it is per-test.
 */
export function miniCourse(holeCount: number, cellM = 8, seed = 2026): MiniCourse {
  const key = `${holeCount}/${cellM}/${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const specs = authoredCourse(seed).holes;
  const holes: PlacedHole[] = AUTHORED_PLACEMENTS.slice(0, holeCount).map((placement) => {
    const spec = specs[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  const terrain = createCourseTerrain(holes, { rough: mulberry32(seed), cellM });
  const surfaces = createCourseSurfaces(
    terrain,
    holes.map((hole) => createSurfaces(hole.spec, hole.terrain)),
  );
  const built: MiniCourse = {
    terrain,
    surfaces,
    holes,
    ground: {
      playfield: coursePlayfield(bakeCourseGrids(terrain, surfaces)),
      holes,
      southBoundary: null,
      // A few holes do not reach the clubhouse, so these tests deal carts onto the tees.
      clubhouse: null,
    pickupSites: [],
      seed: specs[0]!.seed,
    },
  };
  cache.set(key, built);
  return built;
}
