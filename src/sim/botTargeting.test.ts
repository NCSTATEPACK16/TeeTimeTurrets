import { describe, expect, it } from "vitest";
import { neutralIntent } from "./intent";
import { NO_TARGET, TARGET_SWITCH_MARGIN, pickTarget } from "./bot";
import type { TargetCandidate } from "./bot";
import { CART_COLLIDER } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { teamOf } from "./matchConfig";
import { miniCourse } from "./testing/miniCourse";
import { Sim } from "./world";

/**
 * Who a bot fights. Until this existed every bot, allies included, hunted the player -- and with
 * friendly fire on, a player's own team was a third of the enemy.
 */

function at(x: number, z: number, dead = false): TargetCandidate {
  return { position: { x, z }, dead };
}

describe("pickTarget", () => {
  // Rig 1 is on team 1; rigs 0 and 2 are its enemies, rig 3 its ally.
  it("picks the nearest enemy and ignores a nearer ally", () => {
    const carts = [at(50, 0), at(0, 0), at(80, 0), at(5, 0)];
    expect(teamOf(3)).toBe(teamOf(1));
    expect(pickTarget(1, NO_TARGET, carts)).toBe(0);
  });

  it("never picks itself", () => {
    const carts = [at(0, 0), at(0, 0)];
    expect(pickTarget(1, NO_TARGET, carts)).toBe(0);
  });

  it("keeps its current target unless another enemy is a margin closer", () => {
    const current = 2;
    const within = [at(100 - TARGET_SWITCH_MARGIN + 1, 0), at(0, 0), at(100, 0)];
    expect(pickTarget(1, current, within)).toBe(current);

    const beyond = [at(100 - TARGET_SWITCH_MARGIN - 1, 0), at(0, 0), at(100, 0)];
    expect(pickTarget(1, current, beyond)).toBe(0);
  });

  it("drops a dead target for the nearest living enemy", () => {
    const carts = [at(10, 0, true), at(0, 0), at(90, 0)];
    expect(pickTarget(1, 0, carts)).toBe(2);
  });

  it("drops a current target that is an ally, however it got there", () => {
    const carts = [at(90, 0), at(0, 0), at(95, 0), at(5, 0)];
    expect(pickTarget(1, 3, carts)).toBe(0);
  });

  it("has no target when every enemy is dead", () => {
    const carts = [at(10, 0, true), at(0, 0), at(20, 0, true)];
    expect(pickTarget(1, 0, carts)).toBe(NO_TARGET);
  });
});

/** The internal rig shape this test reaches for, to stand carts where it needs them. */
interface RigLike {
  cart: Cart;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

function place(sim: Sim, rig: RigLike, x: number, z: number, heading: number): void {
  const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
  rig.cart.position.x = x;
  rig.cart.position.y = y;
  rig.cart.position.z = z;
  rig.cart.heading = heading;
  rig.body.setTranslation({ x, y, z }, true);
}

describe("bots on the shipped course fight the other team", () => {
  it(
    "an ally beside the player drives off toward the enemy instead of closing on the player",
    async () => {
      // Rigs: 0 the player (team 0), 1 an enemy (team 1), 2 an ally (team 0).
      const sim = await Sim.create(miniCourse(2).ground, { botCount: 2 });
      const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
      const player = rigs[0]!;
      const enemy = rigs[1]!;
      const ally = rigs[2]!;
      expect(teamOf(2)).toBe(teamOf(0));
      expect(teamOf(1)).not.toBe(teamOf(0));

      // Down the player's own tee line, which is fairway: the ally 10 m out, the enemy 70 m out.
      const p = player.cart.position;
      const h = player.cart.heading;
      const fx = Math.cos(h);
      const fz = Math.sin(h);
      place(sim, ally, p.x + fx * 10, p.z + fz * 10, h);
      place(sim, enemy, p.x + fx * 70, p.z + fz * 70, h + Math.PI);

      const flat = (a: Cart, b: Cart): number => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      const toPlayerBefore = flat(ally.cart, player.cart);
      const toEnemyBefore = flat(ally.cart, enemy.cart);

      for (let i = 0; i < 180; i++) sim.step(neutralIntent());

      // Targeting the player, the ally would close from 10 m to its 7 m standoff and stop. It
      // has to have gone the other way, and by more than the standoff wobble.
      expect(flat(ally.cart, player.cart) - toPlayerBefore).toBeGreaterThan(10);
      expect(toEnemyBefore - flat(ally.cart, enemy.cart)).toBeGreaterThan(10);
    },
    60_000,
  );
});
