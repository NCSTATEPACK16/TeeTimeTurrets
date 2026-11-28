import { createCourseGround } from "./courseGround";
import type { CourseGround } from "./courseGround";
import { createTreeline } from "./treeline";
import { createCartPathStrip } from "./cartPaths";
import type { CartPathStrip } from "./cartPaths";
import type { Treeline } from "./treeline";
import { createCourseTrees } from "./Trees";
import { buildWoodsDensity, placeCourseWoods } from "./woodsPlacement";
import type { WoodsDensity } from "./woodsPlacement";
import type { Trees } from "./Trees";
import type { ArenaSource } from "./scene";
import type { GroundDetailMode } from "./groundShader";
import { loadGroundTextures } from "./groundTextures";
import type { GroundTextures } from "./groundTextures";

/** Where `tools/textures/packGround.mjs` writes, relative to the page. */
const GROUND_TEXTURE_URL = "textures/ground/";

/**
 * The parts of a match scene that belong to the course rather than to the match: the tiled
 * ground, the woods on it and the treeline beyond the road.
 *
 * Built once per course and kept for the page. The course is fixed, so a rebuild on every PLAY
 * and every rematch could only arrive at the same ground, and paid half a second of far tiles and
 * every near tile the last match had built to get there. A `RenderScene` borrows these -- it adds
 * them to its scene and removes them again -- and never disposes them: the WebGL context they
 * live on is the page's, like the renderer's.
 */
export interface CourseDressing {
  readonly ground: CourseGround;
  /** Each hole's woods, in its biome's two species (`Trees.ts`' `createCourseTrees`). */
  readonly woods: Trees;
  /** Null on a course with no road. */
  readonly treeline: Treeline | null;
  /** The cart paths (`cartPaths.ts`); null on a course without any. */
  readonly cartPaths: CartPathStrip | null;
  /** How wooded the ground is (`woodsPlacement.buildWoodsDensity`): pine straw, and where tufts thin. */
  readonly woodsDensity: WoodsDensity;
  /**
   * Set the ground's detail for the match about to start (`QualityPreset.groundDetail`). The
   * textures are fetched once per page, the first time a preset asks for them, and kept: like
   * the ground they belong to the course, not to a match. Until they arrive -- and for good, if
   * they fail to load -- the ground draws flat.
   */
  applyGroundDetail(mode: GroundDetailMode): void;
}

/** One load for the page, shared by every course's dressing. */
let groundTextures: Promise<GroundTextures | null> | null = null;

/** Keyed on the source object, which `main.ts` builds once per course and keeps. */
const dressings = new WeakMap<ArenaSource, CourseDressing>();

export function courseDressingFor(arena: ArenaSource): CourseDressing {
  let dressing = dressings.get(arena);
  if (dressing === undefined) {
    const woodsOptions = {
      seed: arena.seed ?? 0,
      southBoundary: arena.southBoundary,
      clubhouse: arena.clubhouse,
    };
    // Placed once: the trees are instanced from it and the woods floor is drawn from it.
    const placed = placeCourseWoods(arena.course, arena.surfaces, woodsOptions);
    const woodsDensity = buildWoodsDensity(placed, arena.course.bounds);
    const ground = createCourseGround(arena.course, arena.surfaces, woodsDensity);
    // The mode the latest match asked for, so a load that lands late applies the current one.
    let wanted: GroundDetailMode = "off";
    dressing = {
      ground,
      applyGroundDetail(mode) {
        wanted = mode;
        if (mode === "off") {
          ground.setDetail(null, "off");
          return;
        }
        groundTextures ??= loadGroundTextures(GROUND_TEXTURE_URL);
        void groundTextures.then((textures) => {
          if (wanted !== "off") ground.setDetail(textures, wanted);
        });
      },
      woods: createCourseTrees(arena.course, arena.surfaces, woodsOptions, placed),
      cartPaths: arena.cartPaths ? createCartPathStrip(arena.cartPaths, (x, z) => arena.course.heightAt(x, z)) : null,
      woodsDensity,
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
