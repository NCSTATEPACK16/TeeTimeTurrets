import { describe, expect, it } from "vitest";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { generateCourse } from "./course";
import { CART_COLLIDER } from "./entities/Cart";
import { createCourseSurfaces } from "./courseSurfaces";
import { createCourseTerrain } from "./courseTerrain";
import type { CourseTerrain, PlacedHole } from "./courseTerrain";
import { solveCourseLayout, toCourseFrame } from "./courseLayout";
import type { LayoutHole } from "./courseLayout";
import { createSurfaces } from "./surfaces";
import { createTerrain } from "./terrain";
import { mulberry32 } from "./rng";
import { Sim } from "./world";

/**
 * Arena's ground, driven headlessly against the real Rapier world, the way `world.cart.test.ts`
 * drives stroke play's. What is under test is the one thing Stage B changed about `Sim`: which
 * ground it is standing on. The pin, the ball and the targets are still stroke play's furniture
 * and are not touched here -- `src/sim/match.ts` is where they get sorted out.
 */

const COURSE_SEED = 2026;
/** Six holes and 8 m cells: the assembly is the same, and the heightfield builds in a test's
 *  worth of time rather than a level load's. The cell size is the caller's to choose. */
const TEST_HOLES = 6;
const TEST_CELL_M = 8;
/**
 * How far the collider's ground may sit from `heightAt`'s.
 *
 * A cart rests on the heightfield, which is `heightAt` sampled on the grid and interpolated
 * linearly between samples; the two agree exactly only at a sample. The gap is the curvature the
 * cell spans, and at these deliberately coarse 8 m cells it reaches ~10 cm. Wide enough not to be
 * brittle, far too narrow for a cart that is falling: that one is metres out and getting worse.
 */
const CELL_SLACK_M = 0.3;

function play(sim: Sim, script: readonly ScriptedStep[]): void {
  const source = new ScriptedInputSource(script);
  const total = script.reduce((sum, step) => sum + step.ticks, 0);
  for (let i = 0; i < total; i++) {
    sim.step(source.sample());
    source.endTick();
  }
}

function buildCourse(): { terrain: CourseTerrain; holes: PlacedHole[] } {
  const generated = generateCourse(COURSE_SEED, TEST_HOLES);
  const layoutHoles: LayoutHole[] = generated.holes.map((h) => ({
    index: h.index,
    tee: h.tee,
    cup: h.cup,
    control: h.control,
  }));
  const layout = solveCourseLayout(layoutHoles);
  const holes: PlacedHole[] = layout.placements.map((placement) => {
    const spec = generated.holes[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  return {
    terrain: createCourseTerrain(holes, { rough: mulberry32(COURSE_SEED), cellM: TEST_CELL_M }),
    holes,
  };
}

async function arenaSim(): Promise<{ sim: Sim; terrain: CourseTerrain; holes: PlacedHole[] }> {
  const { terrain, holes } = buildCourse();
  const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
  sim.loadCourse(terrain, createCourseSurfaces(terrain, holes.map((h) => createSurfaces(h.spec, h.terrain))));
  return { sim, terrain, holes };
}

describe("standing on the whole course", () => {
  it("holds the cart on ground far past where the hole's field ended", async () => {
    const { sim, terrain, holes } = await arenaSim();
    const fieldHalf = holes[0]!.spec.fieldSize / 2;

    // Straight ahead for twenty seconds: about 280 m at top speed, which is well past the edge
    // of the field the sim was created on.
    play(sim, [{ ticks: 20 * 60, intent: { throttle: 1 } }]);

    const p = sim.cart.position;
    const travelled = Math.hypot(p.x, p.z);
    expect(travelled).toBeGreaterThan(fieldHalf);
    // On the ground it drove onto, not floating over it or sunk into it.
    expect(Math.abs(p.y - CART_COLLIDER.groundOffset - terrain.heightAt(p.x, p.z))).toBeLessThan(
      CELL_SLACK_M,
    );
  });

  it("is the course's ground under the cart, not the hole's", async () => {
    // The control on the test above: the two grounds disagree about that point, so "the cart is
    // at the course's height there" is a claim with something behind it.
    const { sim, terrain, holes } = await arenaSim();
    play(sim, [{ ticks: 20 * 60, intent: { throttle: 1 } }]);

    const p = sim.cart.position;
    expect(
      Math.abs(terrain.heightAt(p.x, p.z) - holes[0]!.terrain.heightAt(p.x, p.z)),
    ).toBeGreaterThan(CELL_SLACK_M);
  });

  it("stops the cart at the course perimeter rather than at a field edge", async () => {
    const { sim, terrain } = await arenaSim();
    // Long enough to reach any edge of the course from anywhere inside it.
    play(sim, [{ ticks: 400 * 60, intent: { throttle: 1 } }]);

    const p = sim.cart.position;
    const inset = CART_COLLIDER.radius;
    expect(p.x).toBeGreaterThanOrEqual(terrain.bounds.minX + inset - 1e-6);
    expect(p.x).toBeLessThanOrEqual(terrain.bounds.maxX - inset + 1e-6);
    expect(p.z).toBeGreaterThanOrEqual(terrain.bounds.minZ + inset - 1e-6);
    expect(p.z).toBeLessThanOrEqual(terrain.bounds.maxZ - inset + 1e-6);
    // And the perimeter it stopped at is the course's, which is a long way outside the hole's.
    expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(200);
  });

  it("puts a cart standing at another hole's tee on that hole's ground", async () => {
    // Nothing in stroke play's world exists out there: on one hole's collider this cart would
    // fall until the out-of-bounds floor caught it.
    const { sim, terrain, holes } = await arenaSim();
    const distant = holes[holes.length - 1]!;
    const tee = { x: 0, z: 0 };
    toCourseFrame(distant.placement, distant.spec.tee.x, distant.spec.tee.z, tee);

    sim.cart.position.x = tee.x;
    sim.cart.position.z = tee.z;
    sim.cart.position.y = terrain.heightAt(tee.x, tee.z) + CART_COLLIDER.groundOffset + 2;
    play(sim, [{ ticks: 3 * 60, intent: {} }]);

    const p = sim.cart.position;
    expect(Math.hypot(p.x - tee.x, p.z - tee.z)).toBeLessThan(2);
    expect(Math.abs(p.y - CART_COLLIDER.groundOffset - terrain.heightAt(p.x, p.z))).toBeLessThan(
      CELL_SLACK_M,
    );
  });

  it("reads the course's materials under the cart, not the hole's", async () => {
    const { sim, terrain, holes } = await arenaSim();
    const surfaces = createCourseSurfaces(
      terrain,
      holes.map((h) => createSurfaces(h.spec, h.terrain)),
    );
    const distant = holes[holes.length - 1]!;
    const cup = { x: 0, z: 0 };
    toCourseFrame(distant.placement, distant.spec.cup.x, distant.spec.cup.z, cup);

    expect(sim.surfaces.surfaceAt(cup.x, cup.z)).toBe(surfaces.surfaceAt(cup.x, cup.z));
    // The control: that point is a green rather than the rough a hole-scoped lookup would answer
    // for ground half a kilometre outside its own field.
    expect(surfaces.surfaceAt(cup.x, cup.z)).toBe("green");
  });
});
