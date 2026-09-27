import { beforeEach, describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../../physics/Ballistics";
import { SURFACES, SurfaceId } from "../surfaces";
import type { SurfaceTuning } from "../surfaces";
import {
  CART_COLLIDER,
  CART_TUNING,
  Cart,
  MAX_AMMO,
  STARTING_AMMO,
  TURRET_GEOMETRY,
  TireType,
  computeMuzzle,
} from "./Cart";
import { ARENA_MAX_HEALTH } from "../matchConfig";
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
  return { throttle: 0, steer: 0, brake: false, aimDelta: 0, fire: false, cancelCharge: false, ...overrides };
}

/** Advance `seconds` of simulated time at the fixed rate, holding one intent throughout. */
function run(cart: Cart, seconds: number, intent: CartIntent, surface: SurfaceTuning = FAIRWAY): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) cart.step(intent, DT, surface);
}

describe("Cart loadout", () => {
  it("starts holding the putter, the arena's close-range sidearm", () => {
    expect(new Cart().equippedClub).toBe(ClubType.Putter);
  });
});

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

  it("cancelling drops the charge, and letting go afterwards fires nothing", () => {
    run(cart, 0.3, idle({ fire: true }));
    const ammo = cart.ammo;
    cart.step(idle({ fire: true, cancelCharge: true }), DT, FAIRWAY);
    expect(cart.charge).toBe(0);

    cart.step(idle({ fire: false }), DT, FAIRWAY);
    expect(cart.shot.fired).toBe(false);
    expect(cart.ammo).toBe(ammo);
  });

  it("after a cancel, the trigger has to be let go before it charges again", () => {
    run(cart, 0.3, idle({ fire: true }));
    cart.step(idle({ fire: true, cancelCharge: true }), DT, FAIRWAY);
    run(cart, 0.3, idle({ fire: true }));
    expect(cart.charge).toBe(0);

    cart.step(idle({ fire: false }), DT, FAIRWAY);
    run(cart, 0.3, idle({ fire: true }));
    expect(cart.charge).toBeGreaterThan(0);
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

  it("kicks the club's own recoil at full charge", () => {
    for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      const c = new Cart({ club });
      c.fire(1);
      expect(Math.hypot(c.recoil.x, c.recoil.z), club).toBeCloseTo(CLUB_STATS[club].recoil, 9);
    }
  });

  it("barely moves the cart with a full-charge putter shot, so the pistol can be fired on the move", () => {
    const c = new Cart({ club: ClubType.Putter });
    c.fire(1);
    expect(Math.hypot(c.recoil.x, c.recoil.z)).toBeLessThanOrEqual(1);
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

  it("swings the muzzle around with the turret, from a pivot the chassis carries", () => {
    // Two angles, not one. Slewing the turret 90 degrees swings the barrel onto +Z, but the pivot
    // it swings from stays bolted `pivotForward` ahead of the chassis on +X -- the ring does not
    // slide across the roof. So the muzzle ends up off the cart's centre in *both* axes, and a
    // `computeMuzzle` that used `turretYaw` for the offset as well would put it on neither.
    const cart = new Cart();
    cart.heading = 0; // chassis facing +X
    cart.turretOffset = Math.PI / 2; // turret aiming down +Z
    computeMuzzle(cart, out);
    expect(out.z).toBeGreaterThan(cart.position.z + 0.5);
    expect(out.x - cart.position.x).toBeCloseTo(TURRET_GEOMETRY.pivotForward, 6);
  });

  it("carries the pivot round with the chassis when the turret is centred", () => {
    const east = new Cart({ heading: 0 });
    const north = new Cart({ heading: Math.PI / 2 });
    computeMuzzle(east, out);
    const eastX = out.x;
    computeMuzzle(north, out);
    // Same shot, cart turned a quarter turn: the whole muzzle -- offset and reach together --
    // has to rotate with it, so what was an X reach is now a Z reach of the same length.
    expect(out.z).toBeCloseTo(eastX, 6);
    expect(out.x).toBeCloseTo(0, 6);
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

describe("Cart pace", () => {
  it("is fast: at least 18 m/s on fairway, reached inside two seconds", () => {
    // The user's call (2026-09-24): "somewhat realistic but a lot of action". 14 m/s was not it.
    const cart = new Cart();
    const throttle = { ...idle(), throttle: 1 };
    let reachedAt = Infinity;
    for (let tick = 0; tick < 5 * 60; tick++) {
      cart.step(throttle, DT, FAIRWAY);
      if (cart.speed >= 18 && reachedAt === Infinity) reachedAt = tick * DT;
    }
    expect(cart.speed).toBeGreaterThanOrEqual(18);
    expect(reachedAt).toBeLessThanOrEqual(2);
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

describe("Cart ammo", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
  });

  it("starts at STARTING_AMMO", () => {
    expect(cart.ammo).toBe(STARTING_AMMO);
  });

  it("addAmmo clamps at MAX_AMMO", () => {
    cart.addAmmo(MAX_AMMO);
    expect(cart.ammo).toBe(MAX_AMMO);
  });

  it("addAmmo clamps a near-cap value rather than overshooting", () => {
    cart.ammo = 90;
    cart.addAmmo(30);
    expect(cart.ammo).toBe(100);
  });

  it("fire() decrements ammo by 1 and sets shot.hasBall on a real shot", () => {
    cart.fire(1);
    expect(cart.ammo).toBe(STARTING_AMMO - 1);
    expect(cart.shot.hasBall).toBe(true);
  });

  it("fire() at 0 ammo leaves ammo at 0, sets hasBall false, and does not kick", () => {
    // A blank throws nothing, so there is nothing to push back against. It used to kick like a
    // real shot, which made an empty putter a free, silent way to skate the cart around.
    cart.ammo = 0;
    cart.fire(1);
    expect(cart.ammo).toBe(0);
    expect(cart.shot.hasBall).toBe(false);
    expect(Math.hypot(cart.recoil.x, cart.recoil.z)).toBe(0);
  });

  it("fire() while reloading does not touch ammo or hasBall", () => {
    cart.fire(1);
    const ammoAfterFirstShot = cart.ammo;
    const fired = cart.fire(1);
    expect(fired).toBe(false);
    expect(cart.ammo).toBe(ammoAfterFirstShot);
  });
});

describe("Cart rearm", () => {
  /** Everything the weapon carries between ticks, private state included. */
  function weapon(cart: Cart): Record<string, unknown> {
    const c = cart as unknown as Record<string, unknown>;
    const keys = ["club", "ammo", "reload", "chargeHeld", "wasFiring", "cancelled", "shot"];
    return Object.fromEntries(keys.map((k) => [k, structuredClone(c[k])]));
  }

  /**
   * What a match can leave on a cart's weapon. No one cart can show all of it at once -- a charge
   * only builds once the reload is done, and a cancel drops the charge -- so each scenario dirties
   * part of it, and the last test checks that between them they dirty every field.
   */
  const scenarios: Record<string, (cart: Cart) => void> = {
    // Clubs swapped, a full driver shot fired, ammo picked up, the reload still running.
    fired: (cart) => {
      cart.selectClub(ClubType.Driver);
      run(cart, 2, idle({ fire: true }));
      run(cart, 1 / 60, idle());
      cart.addAmmo(40);
    },
    // The trigger held down on a charge when the buzzer went.
    charging: (cart) => run(cart, 0.25, idle({ fire: true })),
    // The trigger held down after a cancel, which latches until it is let go.
    cancelled: (cart) => run(cart, 0.25, idle({ fire: true, cancelCharge: true })),
  };

  function usedCart(scenario: string): Cart {
    const cart = new Cart({ club: ClubType.Iron });
    scenarios[scenario]!(cart);
    return cart;
  }

  for (const scenario of Object.keys(scenarios)) {
    it(`leaves the weapon exactly as a new cart of the same loadout has it (${scenario})`, () => {
      const fresh = new Cart({ club: ClubType.Iron });
      const used = usedCart(scenario);
      expect(weapon(used)).not.toEqual(weapon(fresh));

      used.rearm();

      expect(weapon(used)).toEqual(weapon(fresh));
    });
  }

  it("is tested against every field of the weapon, not only some", () => {
    const fresh = weapon(new Cart({ club: ClubType.Iron }));
    const dirtied = new Set<string>();
    for (const scenario of Object.keys(scenarios)) {
      const used = weapon(usedCart(scenario));
      for (const key of Object.keys(fresh)) {
        if (JSON.stringify(used[key]) !== JSON.stringify(fresh[key])) dirtied.add(key);
      }
    }
    expect([...dirtied].sort()).toEqual(Object.keys(fresh).sort());
  });
});

describe("Cart health, death and shunting", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
  });

  it("starts alive at full HP", () => {
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(cart.health.max).toBe(ARENA_MAX_HEALTH);
    expect(cart.dead).toBe(false);
    expect(cart.respawnTimer).toBe(0);
  });

  it("adds shunt velocity into the desired translation the way recoil already does", () => {
    cart.shuntVelocity.x = 4;
    cart.step(idle(), DT, FAIRWAY);
    expect(cart.desiredTranslation.x).toBeGreaterThan(0);
  });

  it("decays shunt velocity exponentially at the recoil rate", () => {
    cart.shuntVelocity.x = 10;
    cart.shuntVelocity.z = -6;
    cart.step(idle(), DT, FAIRWAY);

    const decay = Math.exp(-CART_TUNING.recoilDecay * DT);
    expect(cart.shuntVelocity.x).toBeCloseTo(10 * decay, 9);
    expect(cart.shuntVelocity.z).toBeCloseTo(-6 * decay, 9);
  });

  it("shunt is a velocity term, never an impulse -- it runs out on its own", () => {
    cart.shuntVelocity.x = 12;
    run(cart, 3, idle());
    expect(Math.abs(cart.shuntVelocity.x)).toBeLessThan(0.05);
  });

  it("revive() restores full HP and clears death and momentum", () => {
    cart.health.hp = 0;
    cart.dead = true;
    cart.respawnTimer = 1.2;
    cart.speed = 8;
    cart.recoil.x = 3;
    cart.shuntVelocity.z = 2;

    cart.revive();

    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH);
    expect(cart.dead).toBe(false);
    expect(cart.respawnTimer).toBe(0);
    expect(cart.speed).toBe(0);
    expect(cart.recoil.x).toBe(0);
    expect(cart.shuntVelocity.z).toBe(0);
  });

  it("revive() tops ammo back up to the starting load, and never takes any away", () => {
    cart.ammo = 0;
    cart.revive();
    expect(cart.ammo).toBe(STARTING_AMMO);

    cart.ammo = STARTING_AMMO + 12;
    cart.revive();
    expect(cart.ammo).toBe(STARTING_AMMO + 12);
  });
});

describe("health bar sizing", () => {
  it("sizes health from the maxHealth option and defaults to ARENA_MAX_HEALTH", () => {
    expect(new Cart().health.max).toBe(ARENA_MAX_HEALTH);
    const sized = new Cart({ maxHealth: 8 });
    expect(sized.health.max).toBe(8);
    expect(sized.health.hp).toBe(8);
  });

  it("setMaxHealth resizes and refills", () => {
    const cart = new Cart({ maxHealth: 6 });
    cart.health.hp = 2;
    cart.setMaxHealth(10);
    expect(cart.health.max).toBe(10);
    expect(cart.health.hp).toBe(10);
  });
});
