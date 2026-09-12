import type { Course } from "./course";
import { solveCourseLayout } from "./courseLayout";
import { createCourseSurfaces } from "./courseSurfaces";
import { createCourseTerrain } from "./courseTerrain";
import type { CourseTerrain, PlacedHole } from "./courseTerrain";
import { mulberry32 } from "./rng";
import { createSurfaces } from "./surfaces";
import type { Surfaces } from "./surfaces";
import { createTerrain } from "./terrain";

/**
 * Eighteen holes assembled into one place: routed, blended into a single heightfield, and given
 * one set of course-wide materials.
 *
 * Six calls in a fixed order, each of which needs the one before it, and getting the order wrong
 * fails somewhere far from the mistake -- `createCourseSurfaces` handed per-hole surfaces built
 * against a different `Terrain` than the one `createCourseTerrain` blended produces a course whose
 * materials and heights disagree, and nothing throws. It existed once, inline, in the scene gate's
 * `courseGroundSubject`. Two callers is one too many for a sequence with that failure mode, so it
 * lives here and both read it.
 *
 * DOM-free and three-free, like everything else in `src/sim/**`: the renderer takes the result,
 * it does not take part in building it.
 */
export interface CourseWorld {
  readonly terrain: CourseTerrain;
  readonly surfaces: Surfaces;
  /**
   * The placed holes, in course order. Structurally a `SpawnHole[]` as well, which is why
   * `Sim.loadCourse` can be handed this array as it stands -- see `spawn.ts`.
   */
  readonly holes: readonly PlacedHole[];
}

/**
 * `seed` drives the course rough only -- the between-hole ground that is nobody's fairway. Each
 * hole's own terrain is already seeded from its spec, so passing the course seed here keeps the
 * whole course reproducible from one number, which is what the committed plans and the scene gate
 * both depend on.
 */
export function buildCourseWorld(course: Course, seed: number): CourseWorld {
  const layout = solveCourseLayout(
    course.holes.map((h) => ({ index: h.index, tee: h.tee, cup: h.cup, control: h.control })),
  );
  const holes: PlacedHole[] = layout.placements.map((placement) => {
    const spec = course.holes[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  const terrain = createCourseTerrain(holes, { rough: mulberry32(seed) });
  const surfaces = createCourseSurfaces(
    terrain,
    // Built from each hole's own `terrain`, the same object `createCourseTerrain` blended. Calling
    // `createTerrain(spec)` a second time here would give a second, equal-but-separate heightfield
    // and make that agreement a coincidence rather than a fact.
    holes.map((hole) => createSurfaces(hole.spec, hole.terrain)),
  );
  return { terrain, surfaces, holes };
}
