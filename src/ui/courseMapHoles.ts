import { contours, corridorPolylines, surfaceRuns } from "../sim/mapGeometry";
import type { CourseTerrain } from "../sim/courseTerrain";
import { createSurfaces } from "../sim/surfaces";
import type { MapHole } from "./courseMap";

/**
 * The `M` map's eighteen holes, each sampled in its own frame from its own terrain and surfaces,
 * the same functions `tools/holePlan.ts` draws the committed plans with. `CourseMap` places them
 * on the course by their placement.
 *
 * Not sampled from the blended course, though that would be more exact where two holes' rough
 * meets: blended `surfaceAt` weighs all eighteen holes per sample, and measured 3.9 s for the
 * whole map against 0.5 s this way. Once Stage 3 bakes the surface grid that trade goes away.
 *
 * Built once per course and kept. `main.ts` builds it during PLAY's loading step so opening the
 * map mid-match never stalls a frame.
 */

const MAP_SURFACE_SAMPLES = 160;
const MAP_CONTOUR_SAMPLES = 56;
const MAP_TARGET_CONTOURS = 7;
const MAP_CENTRELINE_STEPS = 96;

interface CourseSource {
  readonly course: CourseTerrain;
}

const built = new WeakMap<CourseTerrain, readonly MapHole[]>();

export function courseMapHoles(source: CourseSource): readonly MapHole[] {
  const cached = built.get(source.course);
  if (cached) return cached;

  const holes: MapHole[] = source.course.holes
    .map(({ placement, spec, terrain }) => {
      const field = {
        fieldSize: spec.fieldSize,
        offsetX: placement.offsetX,
        offsetZ: placement.offsetZ,
        rotation: placement.rotation,
      };
      return {
        number: spec.index + 1,
        field,
        samples: MAP_SURFACE_SAMPLES,
        runs: surfaceRuns(spec, createSurfaces(spec, terrain), MAP_SURFACE_SAMPLES),
        contours: contours(spec, terrain, MAP_CONTOUR_SAMPLES, MAP_TARGET_CONTOURS).segments,
        corridor: corridorPolylines(terrain, MAP_CENTRELINE_STEPS),
        green: spec.green,
        tee: spec.tee,
        cup: spec.cup,
      };
    })
    .sort((a, b) => a.number - b.number);
  built.set(source.course, holes);
  return holes;
}

/** The number of the hole whose field centre is nearest a course-frame point: the one you are on. */
export function nearestHoleNumber(holes: readonly MapHole[], x: number, z: number): number {
  let best = holes[0]?.number ?? 1;
  let bestD = Infinity;
  for (const h of holes) {
    const d = (h.field.offsetX - x) ** 2 + (h.field.offsetZ - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = h.number;
    }
  }
  return best;
}
