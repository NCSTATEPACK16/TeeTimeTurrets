import { createCourseGround } from "./courseGround";
import type { CourseGround } from "./courseGround";
import { createTreeline } from "./treeline";
import type { Treeline } from "./treeline";
import type { ArenaSource } from "./scene";

/**
 * The parts of a match scene that belong to the course rather than to the match: the tiled
 * ground and the treeline beyond the road.
 *
 * Built once per course and kept for the page. The course is fixed, so a rebuild on every PLAY
 * and every rematch could only arrive at the same ground, and paid half a second of far tiles and
 * every near tile the last match had built to get there. A `RenderScene` borrows these -- it adds
 * them to its scene and removes them again -- and never disposes them: the WebGL context they
 * live on is the page's, like the renderer's.
 */
export interface CourseDressing {
  readonly ground: CourseGround;
  /** Null on a course with no road. */
  readonly treeline: Treeline | null;
}

/** Keyed on the source object, which `main.ts` builds once per course and keeps. */
const dressings = new WeakMap<ArenaSource, CourseDressing>();

export function courseDressingFor(arena: ArenaSource): CourseDressing {
  let dressing = dressings.get(arena);
  if (dressing === undefined) {
    dressing = {
      ground: createCourseGround(arena.course, arena.surfaces),
      treeline:
        arena.southBoundary === undefined
          ? null
          : createTreeline(
              arena.southBoundary,
              arena.course.bounds,
              (x, z) => arena.course.heightAt(x, z),
              arena.seed ?? 0,
            ),
    };
    dressings.set(arena, dressing);
  }
  return dressing;
}
