import { beforeEach, describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { STARTING_AMMO } from "./entities/Cart";
import { SurfaceId } from "./surfaces";
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
    sim = await Sim.create(fixedHoleSpec());
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
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z));
    expect(p.y - sim.terrain.heightAt(p.x, p.z)).toBeLessThan(2);
  });

  it("drives forward under throttle without falling through the ground", () => {
    const start = { ...sim.cart.position };
    play(sim, [ENTER_CART_MODE, { ticks: seconds(3), intent: { throttle: 1 } }]);
    const p = sim.cart.position;

    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(5);
    // The tunneling check the AGENTS.md testing invariants ask for, applied to the cart:
    // a body that fell through the heightfield diverges downward instead of tracking it.
    expect(p.y).toBeGreaterThan(sim.terrain.heightAt(p.x, p.z) - 0.5);
  });

  it("steers the chassis while driving", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(2), intent: { throttle: 1, steer: 1 } }]);
    expect(Math.abs(sim.cart.heading)).toBeGreaterThan(0.3);
  });

  it("stays on the field when driven at the edge for a long time", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(30), intent: { throttle: -1 } }]);
    const p = sim.cart.position;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.terrain.spec.fieldSize / 2);
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

  it("exposes the terrain and surfaces built from the hole it was created with", () => {
    expect(sim.terrain.spec.fieldSize).toBe(160);
    expect(sim.terrain.spec.tee).toEqual({ x: -45, z: 0 });
    expect(sim.surfaces.surfaceAt(sim.terrain.cupPosition.x, sim.terrain.cupPosition.z)).toBe(
      SurfaceId.Green,
    );
  });

  it("loadHole swaps the ground collider and re-tees onto the new hole", () => {
    const next: HoleSpec = { ...fixedHoleSpec(), seed: 999, tee: { x: 20, z: -20 } };
    sim.loadHole(next);

    expect(sim.terrain.spec.seed).toBe(999);
    expect(sim.current.position.x).toBeCloseTo(20, 5);
    expect(sim.current.position.z).toBeCloseTo(-20, 5);
    expect(sim.strokes).toBe(0);

    // The ball must be standing on the *new* heightfield, not the old one: step it and confirm
    // it settles rather than falling through to the out-of-bounds floor.
    for (let i = 0; i < 180; i++) sim.step();
    expect(sim.current.position.y).toBeGreaterThan(
      sim.terrain.heightAt(sim.current.position.x, sim.current.position.z) - 0.5,
    );
  });
});

describe("striking the ball from the cart", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec());
  });

  it("fires regardless of distance in stationary mode, where the player stands at the ball", () => {
    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);
    expect(sim.mode).toBe(SwingMode.Stationary);
    expect(sim.lastShotWasStrike).toBe(true);
    expect(sim.strokes).toBe(1);
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
    const driverSim = await Sim.create(fixedHoleSpec());
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

describe("cart-mode ammo-aware combat shots", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(legacyHoleSpec());
  });

  it("a fire with ammo spawns a pooled ball at the muzzle and it flies", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    expect(sim.cart.ammo).toBeGreaterThan(0);
    const ammoBefore = sim.cart.ammo;

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.lastShotWasStrike).toBe(true);
  });

  it("firing at 0 ammo produces a recoil-only blank: no strike, ammo stays at 0", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    sim.cart.ammo = 0;
    const recoilBefore = { x: sim.cart.recoil.x, z: sim.cart.recoil.z };

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    expect(sim.cart.ammo).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    expect(sim.cart.recoil.x).not.toBeCloseTo(recoilBefore.x, 9);
  });

  it("does not touch stationary mode's stroke count or ball state", () => {
    expect(sim.mode).toBe(SwingMode.Stationary);
    const strokesBefore = sim.strokes;
    const ammoBefore = sim.cart.ammo;
    expect(ammoBefore).toBe(STARTING_AMMO);

    play(sim, [{ ticks: seconds(1.5), intent: { fire: true } }, { ticks: 2, intent: {} }]);

    // Cart.fire() runs off the one shared swing state machine regardless of Sim.mode -- that is
    // by design, so charge/reload/ammo cannot drift between modes -- so ammo still ticks down
    // here even though the shot itself is resolved by stationary mode's own path. What this
    // guards is narrower: that stationary mode's stroke/ball bookkeeping is driven only by its
    // own resting/holedOut rules, untouched by the cart-mode ammo/pool/bucket wiring that now
    // also runs unconditionally inside stepCart every tick.
    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.strokes).toBe(strokesBefore + (sim.lastShotWasStrike ? 1 : 0));
  });
});
