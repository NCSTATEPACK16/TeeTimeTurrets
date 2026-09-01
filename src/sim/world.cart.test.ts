import { beforeEach, describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { FIELD_SIZE, heightAt } from "./terrain";
import { Sim, SwingMode } from "./world";

/**
 * Phase 2's gate, run headlessly against the real Rapier world. Everything here is driven
 * through `ScriptedInputSource` rather than by calling Sim methods directly -- that is the
 * point of the gate, not an implementation detail. If the cart can only be exercised by
 * reaching past the InputSource interface, the interface is still keyboard-shaped and Phase 4's
 * touch layer will pay for it.
 */

const TICKS_PER_SECOND = 60;

function seconds(n: number): number {
  return Math.round(n * TICKS_PER_SECOND);
}

/** Run a script to completion, then hold neutral for `tail` extra ticks so motion can settle. */
function play(sim: Sim, script: readonly ScriptedStep[], tail = 0): void {
  const source = new ScriptedInputSource(script);
  const total = script.reduce((sum, step) => sum + step.ticks, 0) + tail;
  for (let i = 0; i < total; i++) {
    sim.step(source.sample());
    source.endTick();
  }
}

/** Drive to cart mode first -- every cart script needs it, and it is one press. */
const ENTER_CART_MODE: ScriptedStep = { ticks: 1, intent: { toggleMode: true } };

/** Full-charge shot with whatever club is equipped, measured as displacement from the tee. */
function fullShotDistance(sim: Sim): number {
  const from = { ...sim.current.position };
  play(sim, [{ ticks: seconds(2), intent: { fire: true } }, { ticks: 2, intent: {} }]);
  play(sim, [{ ticks: seconds(8), intent: {} }]);
  const p = sim.current.position;
  return Math.hypot(p.x - from.x, p.z - from.z);
}

describe("cart in the world", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create();
  });

  it("starts in stationary mode and toggles to cart mode on the mode key", () => {
    expect(sim.mode).toBe(SwingMode.Stationary);
    play(sim, [ENTER_CART_MODE]);
    expect(sim.mode).toBe(SwingMode.Cart);
    play(sim, [{ ticks: 1, intent: { toggleMode: true } }]);
    expect(sim.mode).toBe(SwingMode.Stationary);
  });

  it("spawns the cart resting on the terrain rather than inside or above it", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: {} }]);
    const p = sim.cart.position;
    expect(p.y).toBeGreaterThan(heightAt(p.x, p.z));
    expect(p.y - heightAt(p.x, p.z)).toBeLessThan(2);
  });

  it("drives forward under throttle without falling through the ground", () => {
    const start = { ...sim.cart.position };
    play(sim, [ENTER_CART_MODE, { ticks: seconds(3), intent: { throttle: 1 } }]);
    const p = sim.cart.position;

    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    // The tunneling check the AGENTS.md testing invariants ask for, applied to the cart:
    // a body that fell through the heightfield diverges downward instead of tracking it.
    expect(p.y).toBeGreaterThan(heightAt(p.x, p.z) - 0.5);
  });

  it("steers the chassis while driving", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1, steer: 1 } }]);
    expect(Math.abs(sim.cart.heading)).toBeGreaterThan(0.3);
  });

  it("stays on the field when driven at the edge for a long time", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(30), intent: { throttle: -1 } }]);
    const p = sim.cart.position;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(FIELD_SIZE / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(FIELD_SIZE / 2);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("holds an aim offset relative to the chassis rather than an absolute world yaw", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: { throttle: 1, steer: 1, aimDelta: -0.01 } }]);
    expect(sim.cart.turretOffset).toBeLessThan(0);
    expect(sim.cart.heading).toBeGreaterThan(0);
    expect(sim.cart.turretYaw).toBeCloseTo(sim.cart.heading + sim.cart.turretOffset, 9);
  });

  it("fires straight over the bonnet when the player never touches the aim control", () => {
    // Aiming is optional: drive, point the cart, shoot. The turret only leaves the chassis
    // heading if the player asks it to.
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1, steer: -0.6 } }]);
    expect(sim.cart.heading).toBeLessThan(-0.3);
    expect(sim.cart.turretYaw).toBeCloseTo(sim.cart.heading, 9);
  });
});

describe("striking the ball from the cart", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create();
  });

  it("counts a stroke and launches the ball when the cart is parked next to it", () => {
    // The cart spawns behind the tee and inside strike range, so the tee shot is playable
    // without driving first -- CART_SPAWN_OFFSET and STRIKE_RANGE are coupled for this.
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    expect(sim.ballLoaded).toBe(true);

    const teed = { ...sim.current.position };
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.strokes).toBe(1);

    play(sim, [{ ticks: seconds(4), intent: {} }]);
    // Displacement from the tee, not distance from the world origin: the tee sits at
    // x = -FIELD_SIZE/2 + inset, so an origin-relative check passes before the ball moves.
    const p = sim.current.position;
    expect(Math.hypot(p.x - teed.x, p.z - teed.z)).toBeGreaterThan(10);
  });

  it("treats a shot fired with no ball loaded as propulsion, not a wasted stroke", () => {
    // Drive well away from the ball first, then fire. This is the mechanic the phase exists
    // for: with the ball loaded the button plays a stroke, without it the button is an engine.
    play(sim, [ENTER_CART_MODE, { ticks: seconds(4), intent: { throttle: 1 } }]);
    expect(sim.ballLoaded).toBe(false);

    const before = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.lastShotWasStrike).toBe(false);
    expect(sim.strokes).toBe(0);
    expect(Math.hypot(sim.cart.position.x - before.x, sim.cart.position.z - before.z)).toBeGreaterThan(0.5);
  });

  it("fires regardless of distance in stationary mode, where the player stands at the ball", () => {
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.mode).toBe(SwingMode.Stationary);
    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.strokes).toBe(1);
  });

  it("sends the ball where the turret points, not where the chassis points", () => {
    // Turret swung a quarter-turn from the chassis heading; the ball must follow the turret.
    // Deliberately the iron, not the driver: the tee sits on the -X edge with z = 0, so there
    // is only FIELD_SIZE/2 of room sideways and a driver carries past it. A shot that leaves
    // the field is returned to the tee, which would leave the ball where it started and pass
    // any "it moved along Z" check by accident -- hence the explicit out-of-bounds assertion.
    const teed = { ...sim.current.position };
    play(sim, [
      ENTER_CART_MODE,
      { ticks: 1, intent: { selectClub: ClubType.Iron } },
      { ticks: seconds(1), intent: { aimDelta: Math.PI / 2 / seconds(1) } },
      { ticks: seconds(1.2), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);
    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.cart.heading).toBe(0);

    play(sim, [{ ticks: seconds(5), intent: {} }]);
    const p = sim.current.position;
    expect(sim.lastShotOutOfBounds).toBe(false);
    expect(Math.abs(p.z - teed.z)).toBeGreaterThan(10);
    expect(Math.abs(p.z - teed.z)).toBeGreaterThan(Math.abs(p.x - teed.x));
  });

  it("carries the ball on the turret and fires it from the club head, not from the ground", () => {
    // The core of concept images 03 and 04: the ball rides on top of the cart and leaves through
    // the club head on the end of the barrel. A ball launched from where it was lying would start
    // at roughly terrain height; this one has to start up at the muzzle.
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    expect(sim.ballLoaded).toBe(true);

    const muzzle = { x: 0, y: 0, z: 0 };
    sim.muzzle(muzzle);
    const groundHeight = heightAt(sim.cart.position.x, sim.cart.position.z);
    expect(muzzle.y).toBeGreaterThan(groundHeight + 2);

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 1, intent: {} }]);
    // Sampled on the tick the shot resolves, before gravity has pulled it far.
    const launched = sim.current.position;
    expect(launched.y).toBeGreaterThan(groundHeight + 1.5);
    expect(Math.hypot(launched.x - muzzle.x, launched.z - muzzle.z)).toBeLessThan(2);
  });

  it("unloads the ball once fired, so the next shot is a blank until it is collected again", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.strokes).toBe(1);
    expect(sim.ballLoaded).toBe(false);
  });

  it("reloads the ball when the cart drives back to where it came to rest", () => {
    // The golf loop survives the turret: fire the ball, drive after it, scoop it up, fire again.
    // Two things this script has to respect, both found by getting it wrong first:
    // - The tee ball spawns 0.3 m up and takes about half a second to settle. It cannot be
    //   scooped onto the turret until it does, so the hole opens with a brief unloaded moment.
    // - Firing from a ~2.3 m muzzle adds a lot of carry. A *full* charge putt from up there
    //   reaches the water at 41 m and takes a penalty stroke, so this is a light tap.
    play(sim, [
      ENTER_CART_MODE,
      { ticks: seconds(1), intent: {} },
      { ticks: 1, intent: { selectClub: ClubType.Putter } },
      { ticks: seconds(0.15), intent: { fire: true } },
      { ticks: seconds(8), intent: {} },
    ]);
    expect(sim.lastShotInWater).toBe(false);
    expect(sim.strokes).toBe(1);
    expect(sim.ballLoaded).toBe(false);

    // Drive toward wherever the ball settled rather than assuming a direction.
    const ball = sim.current.position;
    for (let i = 0; i < seconds(20); i++) {
      const cart = sim.cart.position;
      const desired = Math.atan2(ball.z - cart.z, ball.x - cart.x);
      const error = Math.atan2(Math.sin(desired - sim.cart.heading), Math.cos(desired - sim.cart.heading));
      sim.step({
        throttle: 1,
        steer: Math.max(-1, Math.min(1, error * 2)),
        brake: false,
        aimDelta: 0,
        fire: false,
        selectClub: null,
        toggleMode: false,
      });
      if (sim.ballLoaded) break;
    }
    expect(sim.ballLoaded).toBe(true);
  });

  it("blocks a second shot until the fired club's reload elapses", () => {
    play(sim, [
      { ticks: seconds(1.5), intent: { fire: true } },
      { ticks: 2, intent: {} },
      { ticks: seconds(0.2), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);
    expect(sim.strokes).toBe(1);
  });

  it("equips the club the player selects and uses its stats for the shot", async () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Putter } }]);
    expect(sim.cart.equippedClub).toBe(ClubType.Putter);

    // Compared against a driver on an identical course rather than against a magic number:
    // `Sim.launch` used to hardcode DEFAULT_CLUB, so what needs proving is that selection
    // reaches Ballistics at all, and the two clubs' relative carry is what shows it.
    const putterDistance = fullShotDistance(sim);
    const driverSim = await Sim.create();
    play(driverSim, [{ ticks: 1, intent: { selectClub: ClubType.Driver } }]);
    const driverDistance = fullShotDistance(driverSim);

    expect(putterDistance).toBeLessThan(driverDistance * 0.6);
  });

  it("drives the whole gate through the input interface with no direct Sim calls", () => {
    // Meta-check: one script covering mode, club, drive, aim and fire, asserting the sim ends
    // somewhere sane. If this ever needs a direct method call to work, the interface is wrong.
    const source = new ScriptedInputSource([
      { ticks: 1, intent: { toggleMode: true } },
      { ticks: 1, intent: { selectClub: ClubType.Iron } },
      { ticks: seconds(2), intent: { throttle: 1, steer: 0.4 } },
      { ticks: seconds(1), intent: { brake: true } },
      { ticks: seconds(1), intent: { aimDelta: 0.01 } },
      { ticks: seconds(1.2), intent: { fire: true } },
      { ticks: seconds(3), intent: {} },
    ]);
    while (!source.finished) {
      sim.step(source.sample());
      source.endTick();
    }
    expect(sim.mode).toBe(SwingMode.Cart);
    expect(sim.cart.equippedClub).toBe(ClubType.Iron);
    expect(Number.isFinite(sim.cart.position.y)).toBe(true);
    expect(Number.isFinite(sim.current.position.y)).toBe(true);
  });
});
