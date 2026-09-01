import { beforeEach, describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../../physics/Ballistics";
import { SURFACES, SurfaceId } from "../surfaces";
import type { SurfaceTuning } from "../surfaces";
import { CART_COLLIDER, CART_TUNING, Cart, TireType, computeMuzzle } from "./Cart";
import type { CartIntent } from "./Cart";

/**
 * The cart's whole state machine is exercised here with no Rapier world: `Cart` owns intent
 * -> heading/speed/turret/reload/recoil, and produces a *desired* translation. Actually moving
 * a body through terrain is the character controller's job in world.ts. That split is what
 * makes this file possible, and it is the same split that lets Phase 5 replay intents on a
 * server.
 */

const FAIRWAY = SURFACES[SurfaceId.Fairway];
const DT = 1 / 60;

function idle(overrides: Partial<CartIntent> = {}): CartIntent {
  return { throttle: 0, steer: 0, brake: false, aimDelta: 0, fire: false, ...overrides };
}

/** Advance `seconds` of simulated time at the fixed rate, holding one intent throughout. */
function run(cart: Cart, seconds: number, intent: CartIntent, surface: SurfaceTuning = FAIRWAY): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) cart.step(intent, DT, surface);
}

describe("Cart reload gating", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
  });

  it("can fire when freshly created", () => {
    expect(cart.canFire).toBe(true);
  });

  it("blocks a second shot until the equipped club's reload elapses", () => {
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    expect(cart.canFire).toBe(false);
    expect(cart.reloadRemaining).toBeCloseTo(CLUB_STATS[ClubType.Driver].reloadSeconds, 9);
  });

  it("counts the reload down in step and allows firing once it elapses", () => {
    cart.selectClub(ClubType.Putter);
    cart.fire(1);
    run(cart, CLUB_STATS[ClubType.Putter].reloadSeconds - 0.1, idle());
    expect(cart.canFire).toBe(false);
    run(cart, 0.2, idle());
    expect(cart.canFire).toBe(true);
    expect(cart.reloadRemaining).toBe(0);
  });

  it("does not cancel an in-progress reload when a different club is selected", () => {
    // Otherwise club-swap is a free reload cancel, and the fastest fire rate in the game is
    // "swap to putter, swap back" -- which makes every reloadSeconds value decorative.
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    const remaining = cart.reloadRemaining;
    cart.selectClub(ClubType.Putter);
    expect(cart.canFire).toBe(false);
    expect(cart.reloadRemaining).toBeCloseTo(remaining, 9);
  });

  it("charges the reload of the club that fired, not the club equipped afterwards", () => {
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    cart.selectClub(ClubType.Putter);
    run(cart, CLUB_STATS[ClubType.Putter].reloadSeconds + 0.05, idle());
    expect(cart.canFire).toBe(false);
  });

  it("refuses a fire() call while reloading and reports it", () => {
    cart.fire(1);
    expect(cart.fire(1)).toBe(false);
  });
});

describe("Cart swing charge", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
    cart.selectClub(ClubType.Iron);
  });

  it("accumulates charge while the fire intent is held", () => {
    run(cart, CLUB_STATS[ClubType.Iron].chargeSeconds / 2, idle({ fire: true }));
    expect(cart.charge).toBeCloseTo(0.5, 1);
  });

  it("clamps charge at full rather than overshooting", () => {
    run(cart, CLUB_STATS[ClubType.Iron].chargeSeconds * 3, idle({ fire: true }));
    expect(cart.charge).toBe(1);
  });

  it("emits one shot on release, carrying the charge and the turret yaw", () => {
    cart.turretOffset = 0.9;
    run(cart, CLUB_STATS[ClubType.Iron].chargeSeconds, idle({ fire: true }));
    expect(cart.shot.fired).toBe(false);

    cart.step(idle({ fire: false }), DT, FAIRWAY);
    expect(cart.shot.fired).toBe(true);
    expect(cart.shot.club).toBe(ClubType.Iron);
    expect(cart.shot.charge01).toBeCloseTo(1, 6);
    expect(cart.shot.yaw).toBeCloseTo(0.9, 9);
  });

  it("does not re-emit the shot on subsequent ticks once the caller consumes it", () => {
    run(cart, 0.3, idle({ fire: true }));
    cart.step(idle({ fire: false }), DT, FAIRWAY);
    expect(cart.shot.fired).toBe(true);
    cart.shot.fired = false;

    run(cart, 0.5, idle());
    expect(cart.shot.fired).toBe(false);
  });

  it("resets charge to zero after the shot is emitted", () => {
    run(cart, 0.3, idle({ fire: true }));
    cart.step(idle({ fire: false }), DT, FAIRWAY);
    expect(cart.charge).toBe(0);
  });

  it("does not accumulate charge while reloading", () => {
    cart.fire(1);
    run(cart, 0.3, idle({ fire: true }));
    expect(cart.charge).toBe(0);
  });
});

describe("Cart recoil as self-propulsion", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
  });

  it("pushes the cart opposite the direction the turret is aiming", () => {
    // Roadmap Phase 2 / UI-SPEC §7: recoil opposes the shot. Turret at yaw 0 aims down +X,
    // so the kick is toward -X.
    cart.turretOffset = 0;
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    expect(cart.recoil.x).toBeLessThan(0);
    expect(Math.abs(cart.recoil.z)).toBeLessThan(1e-9);
  });

  it("kicks along -Z when the turret aims down +Z", () => {
    cart.turretOffset = Math.PI / 2;
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    expect(cart.recoil.z).toBeLessThan(0);
    expect(Math.abs(cart.recoil.x)).toBeLessThan(1e-9);
  });

  it("kicks harder with the driver than with the putter", () => {
    const driver = new Cart();
    driver.selectClub(ClubType.Driver);
    driver.fire(1);

    const putter = new Cart();
    putter.selectClub(ClubType.Putter);
    putter.fire(1);

    expect(Math.hypot(driver.recoil.x, driver.recoil.z)).toBeGreaterThan(
      Math.hypot(putter.recoil.x, putter.recoil.z) * 2,
    );
  });

  it("kicks harder at full charge than at no charge", () => {
    const full = new Cart();
    full.selectClub(ClubType.Driver);
    full.fire(1);

    const tap = new Cart();
    tap.selectClub(ClubType.Driver);
    tap.fire(0);

    expect(Math.hypot(full.recoil.x, full.recoil.z)).toBeGreaterThan(Math.hypot(tap.recoil.x, tap.recoil.z));
  });

  it("decays toward zero rather than persisting as free speed", () => {
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    const initial = Math.abs(cart.recoil.x);

    run(cart, 0.5, idle());
    const halfSecond = Math.abs(cart.recoil.x);
    expect(halfSecond).toBeLessThan(initial);

    run(cart, 4, idle());
    expect(Math.abs(cart.recoil.x)).toBeLessThan(initial * 0.01);
  });

  it("moves the cart even with no throttle, which is the whole point of the mechanic", () => {
    cart.turretOffset = 0;
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    cart.step(idle(), DT, FAIRWAY);
    expect(cart.desiredTranslation.x).toBeLessThan(0);
  });
});

describe("Cart turret aim", () => {
  /**
   * The turret is stored as an offset *relative to the chassis*, not as an absolute world yaw.
   * That is what makes aiming optional: a player who never touches the aim control always fires
   * exactly where the cart is pointing, and a player who does aim keeps that relative angle
   * through every turn instead of having to re-aim after each one.
   */
  it("fires where the chassis points when the player never aims", () => {
    const cart = new Cart();
    run(cart, 1.5, idle({ throttle: 1, steer: 1 }));
    expect(cart.heading).not.toBeCloseTo(0, 3);
    expect(cart.turretYaw).toBeCloseTo(cart.heading, 9);
  });

  it("turns the turret without turning the chassis", () => {
    const cart = new Cart();
    const heading = cart.heading;
    run(cart, 0.5, idle({ aimDelta: 0.02 }));
    expect(cart.turretOffset).toBeGreaterThan(0);
    expect(cart.heading).toBeCloseTo(heading, 9);
  });

  it("keeps an aim offset relative to the chassis while steering", () => {
    const cart = new Cart();
    cart.turretOffset = 1.2;
    run(cart, 1, idle({ throttle: 1, steer: 1 }));
    expect(cart.heading).not.toBeCloseTo(0, 3);
    expect(cart.turretOffset).toBeCloseTo(1.2, 9);
    expect(cart.turretYaw).toBeCloseTo(cart.heading + 1.2, 9);
  });
});

describe("computeMuzzle", () => {
  const out = { x: 0, y: 0, z: 0 };

  it("puts the muzzle above the cart, on top of the turret", () => {
    const cart = new Cart();
    computeMuzzle(cart, out);
    expect(out.y).toBeGreaterThan(cart.position.y);
  });

  it("puts the muzzle out in front along the turret's aim, not at the cart's centre", () => {
    const cart = new Cart();
    cart.turretOffset = 0; // aiming down +X
    computeMuzzle(cart, out);
    expect(out.x).toBeGreaterThan(cart.position.x + 0.5);
    expect(out.z).toBeCloseTo(cart.position.z, 6);
  });

  it("swings the muzzle around with the turret", () => {
    const cart = new Cart();
    cart.turretOffset = Math.PI / 2; // aiming down +Z
    computeMuzzle(cart, out);
    expect(out.z).toBeGreaterThan(cart.position.z + 0.5);
    expect(out.x).toBeCloseTo(cart.position.x, 6);
  });

  it("raises the muzzle higher for a more lofted club, since the barrel is the club", () => {
    const flat = new Cart({ club: ClubType.Putter });
    computeMuzzle(flat, out);
    const putterY = out.y;

    const lofted = new Cart({ club: ClubType.Iron });
    computeMuzzle(lofted, out);
    expect(out.y).toBeGreaterThan(putterY);
  });

  it("reaches further forward for a flatter club, since loft trades reach for height", () => {
    const flat = new Cart({ club: ClubType.Putter });
    computeMuzzle(flat, out);
    const putterX = out.x;

    const lofted = new Cart({ club: ClubType.Iron });
    computeMuzzle(lofted, out);
    expect(out.x).toBeLessThan(putterX);
  });

  it("clears the cart's own collider so a fired ball does not start inside it", () => {
    const cart = new Cart();
    computeMuzzle(cart, out);
    const gap = Math.hypot(out.x - cart.position.x, out.y - cart.position.y, out.z - cart.position.z);
    expect(gap).toBeGreaterThan(CART_COLLIDER.radius + 0.3);
  });
});

describe("Cart driving", () => {
  it("accelerates forward under throttle and caps at top speed", () => {
    const cart = new Cart();
    run(cart, 10, idle({ throttle: 1 }));
    expect(cart.speed).toBeCloseTo(CART_TUNING.topSpeed * FAIRWAY.cartSpeedScale, 1);
  });

  it("reverses more slowly than it drives forward", () => {
    const cart = new Cart();
    run(cart, 10, idle({ throttle: -1 }));
    expect(cart.speed).toBeLessThan(0);
    expect(Math.abs(cart.speed)).toBeLessThan(CART_TUNING.topSpeed);
  });

  it("is bogged down by sand relative to fairway", () => {
    const onFairway = new Cart();
    run(onFairway, 10, idle({ throttle: 1 }), FAIRWAY);

    const inSand = new Cart();
    run(inSand, 10, idle({ throttle: 1 }), SURFACES[SurfaceId.Sand]);

    expect(inSand.speed).toBeLessThan(onFairway.speed);
  });

  it("brakes harder than it coasts", () => {
    const braking = new Cart();
    run(braking, 4, idle({ throttle: 1 }));
    const startSpeed = braking.speed;
    run(braking, 0.4, idle({ brake: true }));

    const coasting = new Cart();
    run(coasting, 4, idle({ throttle: 1 }));
    run(coasting, 0.4, idle());

    expect(braking.speed).toBeLessThan(coasting.speed);
    expect(braking.speed).toBeLessThan(startSpeed);
  });

  it("translates along its heading when there is no recoil", () => {
    const cart = new Cart();
    cart.heading = Math.PI / 2; // down +Z
    run(cart, 2, idle({ throttle: 1 }));
    cart.step(idle({ throttle: 1 }), DT, FAIRWAY);
    expect(cart.desiredTranslation.z).toBeGreaterThan(0);
    expect(Math.abs(cart.desiredTranslation.x)).toBeLessThan(1e-9);
  });

  it("never writes a vertical component -- gravity and ground-follow belong to the controller", () => {
    const cart = new Cart();
    cart.selectClub(ClubType.Driver);
    cart.fire(1);
    run(cart, 1, idle({ throttle: 1, steer: 0.5 }));
    expect(cart.desiredTranslation.y).toBe(0);
  });
});

describe("Cart tire type is a stat, not a skin", () => {
  it("gives turf tires a higher top speed on fairway than knobby tires", () => {
    const turf = new Cart({ tire: TireType.Turf });
    run(turf, 10, idle({ throttle: 1 }), FAIRWAY);

    const knobby = new Cart({ tire: TireType.Knobby });
    run(knobby, 10, idle({ throttle: 1 }), FAIRWAY);

    expect(turf.speed).toBeGreaterThan(knobby.speed);
  });

  it("reverses that ranking in sand, so the choice is a trade rather than an upgrade", () => {
    const turf = new Cart({ tire: TireType.Turf });
    run(turf, 10, idle({ throttle: 1 }), SURFACES[SurfaceId.Sand]);

    const knobby = new Cart({ tire: TireType.Knobby });
    run(knobby, 10, idle({ throttle: 1 }), SURFACES[SurfaceId.Sand]);

    expect(knobby.speed).toBeGreaterThan(turf.speed);
  });

  it("gives higher-grip tires more steering authority at the same speed", () => {
    const turf = new Cart({ tire: TireType.Turf });
    const street = new Cart({ tire: TireType.Street });
    turf.speed = 8;
    street.speed = 8;
    turf.step(idle({ steer: 1 }), DT, FAIRWAY);
    street.step(idle({ steer: 1 }), DT, FAIRWAY);
    expect(Math.abs(turf.heading)).toBeGreaterThan(Math.abs(street.heading));
  });
});
