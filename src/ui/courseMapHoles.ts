import type { HolePlacement } from "../sim/courseGeometry";
import type { HoleSpec } from "../sim/course";
import { contours, corridorPolylines, surfaceRuns } from "../sim/mapGeometry";
import { createSurfaces } from "../sim/surfaces";
import type { Terrain } from "../sim/terrain";
import type { MapHole } from "./courseMap";

/**
 * The `M` map's static layer for the arena: every hole on the course, sampled in its own frame
 * and placed where the course put it. Built once, the first time the map opens -- `CourseMap`
 * takes this as a thunk -- and never per frame: a hole does not move.
 *
 * Sampling as the old stroke-play map had it: surfaces at the committed plan's 200, which is where
 * a run's rectangle stops reading as a stair; contours coarser, being a texture here.
 */
const MAP_SURFACE_SAMPLES = 200;
const MAP_CONTOUR_SAMPLES = 64;
const MAP_TARGET_CONTOURS = 7;
const MAP_CENTRELINE_STEPS = 96;

export interface MapSourceHole {
  readonly spec: HoleSpec;
  readonly terrain: Terrain;
  readonly placement: HolePlacement;
}

export function buildMapHoles(holes: readonly MapSourceHole[]): MapHole[] {
  return holes.map(({ spec, terrain, placement }) => ({
    number: spec.index + 1,
    field: { fieldSize: spec.fieldSize, offsetX: placement.offsetX, offsetZ: placement.offsetZ, rotation: placement.rotation },
    samples: MAP_SURFACE_SAMPLES,
    runs: surfaceRuns(spec, createSurfaces(spec, terrain), MAP_SURFACE_SAMPLES),
    contours: contours(spec, terrain, MAP_CONTOUR_SAMPLES, MAP_TARGET_CONTOURS).segments,
    corridor: corridorPolylines(terrain, MAP_CENTRELINE_STEPS),
    green: spec.green,
    tee: spec.tee,
    cup: spec.cup,
  }));
}

/** The printed number of the hole whose frame origin is closest to (x, z): the one the map's
 *  hole zoom frames. Allocation-free; it runs per frame while the map is open. */
export function nearestHoleNumber(placements: readonly HolePlacement[], x: number, z: number): number {
  let best = 1;
  let bestD = Infinity;
  for (const p of placements) {
    const d = (p.offsetX - x) * (p.offsetX - x) + (p.offsetZ - z) * (p.offsetZ - z);
    if (d < bestD) {
      bestD = d;
      best = p.index + 1;
    }
  }
  return best;
}
