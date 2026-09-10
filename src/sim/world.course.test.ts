import { describe, expect, it } from "vitest";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { generateCourse } from "./course";
import { CART_COLLIDER, RESPAWN_DELAY_S } from "./entities/Cart";
import { createCourseSurfaces } from "./courseSurfaces";
import { createCourseTerrain } from "./courseTerrain";
import type { CourseTerrain, PlacedHole } from "./courseTerrain";
import { solveCourseLayout, toCourseFrame } from "./courseLayout";
import type { LayoutHole } from "./courseLayout";
import { SurfaceId, createSurfaces } from "./surfaces";
import { createTerrain } from "./terrain";
import { mulberry32 } from "./rng";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import { Sim } from "./world";

/**
 * Arena, driven headlessly against the real Rapier world, the way `world.cart.test.ts` drives
 * stroke play's.
 *
 * Stage B's half of this file is the ground: which one `Sim` is standing on, and that a cart
 * driving off a hole's field finds course under it rather than air. Stage C's half is the mode --
 * `loadCourse` is now the switch, and the furniture it *removes* is asserted at the registration
 * as well as at the count, because a spec that says a thing becomes dormant and leaves it
 * registered is how driving over your own tee became lethal (`docs/TEST-AND-SPEC-PITFALLS.md` §4).
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
 * cell spans, in either direction -- the cart floats where the cell bridges a dip and sinks where
 * it bridges a rise.
 *
 * **0.3 was measured against the line the cart used to drive and is not a property of the cell.**
 * Stage C spawns it at hole 1's tee facing the cup rather than wherever `Sim.create` left it, so
 * it now crosses ground the old line never touched, and the gap there measures 0.37 m. Sampled
 * every five seconds across a 40 s drive it runs +0.01, -0.04, -0.30, -0.37, +0.02, +0.02, +0.03,
 * +0.02: it oscillates about zero and does not grow, which is the whole difference between a cart
 * resting on coarse ground and a cart falling through it. 0.5 admits the curvature with room and
 * is still three orders of magnitude tighter than the ~2 km a cart in free fall covers in 20 s.
 */
const CELL_SLACK_M = 0.5;

function play(sim: Sim, script: readonly ScriptedStep[]): void {
  const source = new ScriptedInputSource(script);
  const total = script.reduce((sum, step) => sum + step.ticks, 0);
  for (let i = 0; i < total; i++) {
    sim.step(source.sample());
    source.endTick();
  }
}

/** Signed: positive is the cart floating above `heightAt`, negative is it sunk below. */
function groundGap(sim: Sim, terrain: CourseTerrain): number {
  const p = sim.cart.position;
  return p.y - CART_COLLIDER.groundOffset - terrain.heightAt(p.x, p.z);
}

function surfacesFor(terrain: CourseTerrain, holes: readonly PlacedHole[]) {
  return createCourseSurfaces(terrain, holes.map((h) => createSurfaces(h.spec, h.terrain)));
}

/** A course-frame point that is water, found by scanning one hole's own pond. Null if the six
 *  generated holes happen to be dry, which the caller asserts against rather than skipping. */
function wetPoint(
  terrain: CourseTerrain,
  holes: readonly PlacedHole[],
): { x: number; z: number } | null {
  const surfaces = surfacesFor(terrain, holes);
  const step = 4;
  for (let x = terrain.bounds.minX; x < terrain.bounds.maxX; x += step) {
    for (let z = terrain.bounds.minZ; z < terrain.bounds.maxZ; z += step) {
      if (surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
    }
  }
  return null;
}

/**
 * Memoised. Generating six holes and assembling them is ~700 ms, every test in this file needs
 * one, and the result is read-only -- only the `Sim` built on top of it is per-test. Rebuilding
 * it a dozen times is what pushed this file's tests past Vitest's 5 s default under a parallel
 * run, which surfaces as a timeout and reads exactly like a failed assertion.
 */
let cachedCourse: { terrain: CourseTerrain; holes: PlacedHole[] } | null = null;

function buildCourse(): { terrain: CourseTerrain; holes: PlacedHole[] } {
  if (cachedCourse !== null) return cachedCourse;
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
  cachedCourse = {
    terrain: createCourseTerrain(holes, { rough: mulberry32(COURSE_SEED), cellM: TEST_CELL_M }),
    holes,
  };
  return cachedCourse;
}

async function arenaSim(): Promise<{ sim: Sim; terrain: CourseTerrain; holes: PlacedHole[] }> {
  const { terrain, holes } = buildCourse();
  const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
  sim.loadCourse(
    terrain,
    createCourseSurfaces(terrain, holes.map((h) => createSurfaces(h.spec, h.terrain))),
    holes,
  );
  return { sim, terrain, holes };
}

describe("standing on the whole course", () => {
  it("holds the cart on ground far past where the hole's field ended", async () => {
    const { sim, terrain, holes } = await arenaSim();
    const fieldHalf = holes[0]!.spec.fieldSize / 2;

    // Straight ahead for twenty seconds: about 280 m at top speed, which is well past the edge
    // of the field the sim was created on. Sampled halfway as well as at the end -- a tolerance
    // checked once is satisfied by any single frame of a descent that has not got far yet, and
    // that is the failure this test exists to rule out. A fall is monotonic; cell curvature
    // oscillates, so two bounded samples ten seconds apart cannot both be a fall in progress.
    play(sim, [{ ticks: 10 * 60, intent: { throttle: 1 } }]);
    expect(Math.abs(groundGap(sim, terrain))).toBeLessThan(CELL_SLACK_M);

    play(sim, [{ ticks: 10 * 60, intent: { throttle: 1 } }]);
    const tee = holes[0]!.spec.tee;
    const p = sim.cart.position;
    expect(Math.hypot(p.x - tee.x, p.z - tee.z)).toBeGreaterThan(fieldHalf);
    expect(Math.abs(groundGap(sim, terrain))).toBeLessThan(CELL_SLACK_M);
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

/**
 * Stage C: `loadCourse` is the mode switch, and what it *removes* is as much the point as what
 * it stands on. `docs/TEST-AND-SPEC-PITFALLS.md` §4 is the reason each removal is asserted at the
 * registration as well as at the count -- a spec that says a thing becomes dormant and leaves it
 * registered is how driving over your own tee became lethal.
 */
describe("arena takes stroke play's furniture out of the world", () => {
  function actorFor(sim: Sim, handle: number): unknown {
    return (sim as unknown as { registry: { get(h: number): unknown } }).registry.get(handle);
  }

  it("says which mode it is in", async () => {
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
    expect(sim.arena).toBe(false);
    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);
    expect(sim.arena).toBe(true);
  });

  it("takes every target out of the world, the count and the registry", async () => {
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
    // The control: stroke play stood three of them up, so "none afterwards" is a change rather
    // than a description of a sim that never had any.
    expect(sim.targets.length).toBeGreaterThan(0);
    const handles = sim.targets.flatMap((t) => t.parts.map((part) => part.collider.handle));
    expect(handles.length).toBeGreaterThan(0);

    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    expect(sim.targets).toHaveLength(0);
    expect(sim.targetPartCount).toBe(0);
    for (const handle of handles) expect(actorFor(sim, handle)).toBeUndefined();
  });

  it("takes the pin out of the world and out of the registry", async () => {
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
    expect(sim.pinStanding).toBe(true);
    const pinHandle = (sim as unknown as { pinCollider: { handle: number } }).pinCollider.handle;
    expect(actorFor(sim, pinHandle)).toBeDefined();

    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    expect(actorFor(sim, pinHandle)).toBeUndefined();
  });

  it("parks the played ball where no check can reach it, and leaves it there", async () => {
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 0 });
    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    expect(sim.current.position.y).toBeLessThan(-100);
    // Still there after a long drive: a ball merely teleported once would fall back through the
    // world under gravity and could re-enter a height check on the way.
    play(sim, [{ ticks: 10 * 60, intent: { throttle: 1 } }]);
    expect(sim.current.position.y).toBeLessThan(-100);
    expect(sim.holedOut).toBe(false);
  });
});

describe("arena spawns, health and scoring", () => {
  it("deals every cart its own hole's tee, facing that hole's cup", async () => {
    const { terrain, holes } = buildCourse();
    // Five bots and six holes, so every cart can have a tee to itself.
    const sim = await Sim.create(holes[0]!.spec, { botCount: 5 });
    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    const carts = [sim.cart, ...sim.bots];
    const tees = holes.map((h) => {
      const out = { x: 0, z: 0 };
      toCourseFrame(h.placement, h.spec.tee.x, h.spec.tee.z, out);
      return out;
    });

    const claimed = new Set<number>();
    for (const cart of carts) {
      const nearest = tees.reduce(
        (best, tee, i) =>
          Math.hypot(tee.x - cart.position.x, tee.z - cart.position.z) < best.d
            ? { i, d: Math.hypot(tee.x - cart.position.x, tee.z - cart.position.z) }
            : best,
        { i: -1, d: Infinity },
      );
      // Standing on it, not merely nearest to it.
      expect(nearest.d).toBeLessThan(1);
      claimed.add(nearest.i);
    }
    // Six carts, six different tees. Red against every cart being left where `Sim.create` put it,
    // which is what Stage B's loadCourse did and which puts them all in one heap.
    expect(claimed.size).toBe(6);
  });

  it("sizes every cart to the arena bar once, and never re-sizes it", async () => {
    const { terrain, holes } = buildCourse();
    // Deliberately **not** a par 4: `2 x par` is 8 there, which is `ARENA_MAX_HEALTH` exactly, so
    // a par-4 hole makes the control below vacuous and the test unable to tell the two rules
    // apart. The band is 6-10 and only one value in it collides.
    const contrast = holes.find((h) => h.spec.par !== 4);
    expect(contrast).toBeDefined();
    const sim = await Sim.create(contrast!.spec, { botCount: 1 });

    // The control: stroke play sized it to 2 x par, which for this hole is not the arena bar.
    expect(sim.cart.health.max).toBe(2 * contrast!.spec.par);
    expect(sim.cart.health.max).not.toBe(ARENA_MAX_HEALTH);

    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);
    expect(sim.cart.health.max).toBe(ARENA_MAX_HEALTH);
    expect(sim.bots[0]!.health.max).toBe(ARENA_MAX_HEALTH);

    // A death and a respawn is the event that used to re-size and refill the bar. It must move
    // the HP back to full without moving the ceiling.
    sim.cart.health.hp = 1;
    sim.cart.dead = true;
    sim.cart.respawnTimer = RESPAWN_DELAY_S;
    for (let i = 0; i < RESPAWN_DELAY_S * 60 + 2; i++) sim.step();

    expect(sim.cart.dead).toBe(false);
    expect(sim.cart.health.max).toBe(ARENA_MAX_HEALTH);
  });

  it("scores a drowning as a stroke against the team and a point for nobody", async () => {
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 1 });
    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    // One hit from death, then driven into water.
    sim.cart.health.hp = 1;
    const wet = wetPoint(terrain, holes);
    expect(wet).not.toBeNull();
    sim.cart.position.x = wet!.x;
    sim.cart.position.z = wet!.z;
    sim.step();

    expect(sim.cart.dead).toBe(true);
    // The discriminating half: red against `killCart` not routing through `Match` at all.
    expect(sim.match.strokesFor(0)).toBe(1);
    // The other two are weaker and worth saying so. A self-death is a team kill by `teamOf`'s
    // reckoning, so `scoreKill` would withhold the point even if `checkCartWater` named the
    // drowning cart as its own killer -- these guard against a rule that credited the *victim*,
    // not against a wrong attribution. `match.test.ts` covers NO_KILLER on its own terms.
    expect(sim.match.pointsFor(0)).toBe(0);
    expect(sim.match.pointsFor(1)).toBe(0);
  });

  it("keeps hits absorbed and deaths as two different numbers", async () => {
    // D1, and the highest-risk sentence in the design: `strokesTaken` counts ball hits, arena's
    // stroke counts deaths, and they differ by the height of the health bar. A cart that has been
    // shot without dying is the case where folding them together is visible.
    const { terrain, holes } = buildCourse();
    const sim = await Sim.create(holes[0]!.spec, { botCount: 1 });
    sim.loadCourse(terrain, surfacesFor(terrain, holes), holes);

    sim.cart.strokesTaken = 3;
    sim.cart.health.hp = ARENA_MAX_HEALTH - 3;

    expect(sim.cart.strokesTaken).toBe(3);
    expect(sim.match.strokesFor(0)).toBe(0);
    expect(sim.match.teamStrokes(0)).toBe(0);
  });
});
