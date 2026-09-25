import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { authoredCourse } from "./authoredCourse";
import { metresNorthOfBoundary } from "./authoredLayout";
import { buildCourseWorld } from "./courseWorld";
import { arenaFromCourse } from "./arena";
import { BOT_ENGAGE_RANGE } from "./bot";
import { CART_COLLIDER, RESPAWN_DELAY_S } from "./entities/Cart";
import type { CourseTerrain, PlacedHole } from "./courseTerrain";
import { toCourseFrame } from "./courseLayout";
import { SurfaceId } from "./surfaces";
import type { Surfaces } from "./surfaces";
import { ARENA_BOTS, ARENA_MAX_HEALTH } from "./matchConfig";
import { miniCourse } from "./testing/miniCourse";
import { Sim } from "./world";

/**
 * The arena on a course, driven headlessly against the real Rapier world: the ground a cart stands
 * on across hole boundaries, the spawns, the scoring, and the shipped eighteen-hole course.
 */

const COURSE_SEED = 2026;
/** Six authored holes and 8 m cells: the assembly is the shipped one, and the heightfield builds in
 *  a test's worth of time rather than a level load's. */
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

/** A course-frame point that is water, found by scanning one hole's own pond. Null if the six
 *  generated holes happen to be dry, which the caller asserts against rather than skipping. */
function wetPoint(terrain: CourseTerrain, surfaces: Surfaces): { x: number; z: number } | null {
  const step = 4;
  for (let x = terrain.bounds.minX; x < terrain.bounds.maxX; x += step) {
    for (let z = terrain.bounds.minZ; z < terrain.bounds.maxZ; z += step) {
      if (surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
    }
  }
  return null;
}

async function arenaSim(botCount = 0): Promise<{
  sim: Sim;
  terrain: CourseTerrain;
  surfaces: Surfaces;
  holes: readonly PlacedHole[];
}> {
  const course = miniCourse(TEST_HOLES, TEST_CELL_M, COURSE_SEED);
  const sim = await Sim.create(course.ground, { botCount });
  return { sim, terrain: course.terrain, surfaces: course.surfaces, holes: course.holes };
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
    // On one hole's collider alone this cart would fall until the out-of-bounds floor caught it.
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
    const { sim, surfaces, holes } = await arenaSim();
    const distant = holes[holes.length - 1]!;
    const cup = { x: 0, z: 0 };
    toCourseFrame(distant.placement, distant.spec.cup.x, distant.spec.cup.z, cup);

    expect(sim.surfaces.surfaceAt(cup.x, cup.z)).toBe(surfaces.surfaceAt(cup.x, cup.z));
    // The control: that point is a green rather than the rough a hole-scoped lookup would answer
    // for ground half a kilometre outside its own field.
    expect(surfaces.surfaceAt(cup.x, cup.z)).toBe("green");
  });
});

describe("arena spawns, health and scoring", () => {
  it("deals every cart its own hole's tee, facing that hole's cup", async () => {
    // Five bots and six holes, so every cart can have a tee to itself.
    const { sim, holes } = await arenaSim(5);

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
    // Six carts, six different tees -- not one heap on hole 1.
    expect(claimed.size).toBe(6);
  });

  it("sizes every cart to the arena bar, and a respawn refills it without re-sizing it", async () => {
    const { sim } = await arenaSim(1);
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
    const { sim, terrain, surfaces } = await arenaSim(1);

    // One hit from death, then driven into water.
    sim.cart.health.hp = 1;
    const wet = wetPoint(terrain, surfaces);
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

});


/**
 * The shipped course, built once. Expensive -- eighteen holes blended into one heightfield -- and
 * read-only, so the `Sim` on top is the only per-test part. Same reasoning as `buildCourse` above.
 */
let cachedAuthored: ReturnType<typeof buildCourseWorld> | null = null;
function authoredWorld(): ReturnType<typeof buildCourseWorld> {
  if (cachedAuthored === null) cachedAuthored = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
  return cachedAuthored;
}

async function authoredSim(): Promise<{ sim: Sim; world: ReturnType<typeof buildCourseWorld> }> {
  const world = authoredWorld();
  const sim = await Sim.create(arenaFromCourse(world), { botCount: 0 });
  return { sim, world };
}

describe("County Home Road is a barrier", () => {
  /**
   * **The bounds box is not the road, and the plan's test cannot tell them apart.**
   *
   * `moveCartBody` has always clamped the cart inside `playfield.bounds`, so the plan's "stops a
   * cart at the southern boundary" assertion -- `cart.position.z > bounds.minZ` -- passes with no
   * barrier written at all. It was verified passing before this task started any work.
   *
   * The road is a *diagonal*: it runs east and south across the bottom of the plat, so the box's
   * flat `minZ` sits south of it at the western end by a wide margin. Everything in that wedge is
   * inside the bounds, on the heightfield, and on the wrong side of a public road.
   */
  it("keeps the cart north of the road, which the bounds box does not", async () => {
    const { sim, world } = await authoredSim();

    // The wedge has to exist, or this test is about nothing: somewhere along the southern edge of
    // the bounds there is ground inside the box and south of the road.
    const b = world.terrain.bounds;
    let wedge = 0;
    for (let f = 0; f <= 1; f += 0.05) {
      const x = b.minX + (b.maxX - b.minX) * f;
      if (metresNorthOfBoundary(x, b.minZ) < 0) wedge += 1;
    }
    expect(wedge, "no ground inside the bounds lies south of the road").toBeGreaterThan(0);

    // Point it south and hold the throttle. Measured rather than guessed at: from hole 1's tee the
    // cart starts 78 m north of the road and is against the barrier -- held at `BARRIER_INSET_M`,
    // 6 m -- by the eighth second, and stays there. Fifteen seconds is comfortably past that and
    // still short enough to be honest about what the test needs.
    sim.cart.heading = -Math.PI / 2;
    play(sim, [{ ticks: 15 * 60, intent: { throttle: 1 } }]);

    expect(
      metresNorthOfBoundary(sim.cart.position.x, sim.cart.position.z),
      `cart ended at (${sim.cart.position.x.toFixed(0)}, ${sim.cart.position.z.toFixed(0)})`,
    ).toBeGreaterThan(0);
    // The default 5 s is not enough and the driving is not why: the 900 ticks cost about 0.2 s,
    // while standing an eighteen-hole heightfield up in Rapier inside `Sim.create` costs 2.7 s
    // here and around 7 s on CI's slower machine. This is the one test that loads the whole
    // authored course, so it carries its own timeout rather than raising the suite's.
  }, 30000);
});

describe("an arena match on the authored course is a match", () => {
  /**
   * **The regression this exists to catch shipped, and nothing in the suite noticed.**
   *
   * `computeBotIntent` used to return a zero intent beyond `BOT_ENGAGE_RANGE`, on the reasoning
   * that closing would be pathfinding. That was sound while the arena was one generated hole. The
   * authored routing deals carts one to a hole across a course roughly 1,590 x 1,290 m: the nearest
   * pair a six-cart roster gets is 75 m and the closest two tees anywhere are 74 m, both outside the
   * 40 m range. So every bot stood still from the opening tick, no bot ever reached anyone, and
   * arena combat did not happen -- while `bot.test.ts` and `world.cart.test.ts` both stayed green,
   * because both asserted the idling that was the bug.
   *
   * Every existing assertion was a unit one against a hand-placed pair of carts. This is the
   * missing one: the carts the *course* deals, on the course it deals them onto.
   */
  it("deals carts far apart and still brings a bot into range of the player", async () => {
    const world = authoredWorld();
    const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });

    const distanceToPlayer = (bot: { position: { x: number; z: number } }): number =>
      Math.hypot(bot.position.x - sim.cart.position.x, bot.position.z - sim.cart.position.z);

    // The premise: they start well outside engagement range, or the test proves nothing. Measured
    // rather than assumed, because it is exactly the fact that changed under the old rule.
    const opening = sim.bots.map(distanceToPlayer);
    expect(Math.min(...opening), `opening distances ${opening.map((d) => d.toFixed(0))}`).toBeGreaterThan(
      BOT_ENGAGE_RANGE,
    );

    // The player holds still. Any closing is the bots' doing. A bot that reaches the player now
    // kills it -- bots fire an effective short-range club -- and the player respawns across the
    // course, so the *final* distance measures the respawn, not the closing. The nearest a bot got
    // over the whole minute is what proves one came into range.
    const source = new ScriptedInputSource([{ ticks: 60 * 60, intent: {} }]);
    let nearest = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step(source.sample());
      source.endTick();
      for (const bot of sim.bots) nearest = Math.min(nearest, distanceToPlayer(bot));
    }

    expect(
      nearest,
      `over 60 s the nearest a bot got was ${nearest.toFixed(0)} m, from ${Math.min(...opening).toFixed(0)} m`,
    ).toBeLessThanOrEqual(BOT_ENGAGE_RANGE);
  }, 60000);
});

describe("fired balls on the course", () => {
  /**
   * A pooled ball decides it has landed by comparing its height with the ground under it. The pool
   * was built with a closure over `sim.terrain` -- the hole the Sim was created on -- and arena
   * never replaced it, so on the course a ball was judged against hole 1's heightfield read at
   * course coordinates. Where that ground sits higher than the course, a ball lying on the grass
   * never lands and can never be picked up as ammo; where it sits lower, a ball "lands" in the air.
   */
  it("lands where the course ground is, so it can be picked back up", async () => {
    const { sim, world } = await authoredSim();
    interface PoolLike {
      all: readonly { state: string; body: { translation(): { x: number; y: number; z: number } } }[];
    }
    const pool = (sim as unknown as { ballPool: PoolLike }).ballPool;

    // One full-charge putter shot along the fairway, then hands off until it has come to rest.
    play(sim, [
      { ticks: 1, intent: { selectClub: ClubType.Putter } },
      { ticks: 30, intent: { fire: true } },
      { ticks: 1, intent: {} },
      { ticks: 8 * 60, intent: {} },
    ]);

    const fired = pool.all.filter((b) => b.state !== "idle");
    expect(fired.length, "the shot never left the muzzle").toBe(1);
    const ball = fired[0]!;
    const at = ball.body.translation();
    const gap = at.y - world.terrain.heightAt(at.x, at.z);
    // The premise: the ball is lying on the course's own ground, not caught on anything.
    expect(Math.abs(gap), `ball rests ${gap.toFixed(2)} m off the course ground`).toBeLessThan(1);
    expect(ball.state).toBe("landed");
  }, 30000);
});
