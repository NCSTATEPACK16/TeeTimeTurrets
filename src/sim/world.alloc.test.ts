import { describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { neutralIntent } from "./intent";
import { BallPool } from "./entities/BallPool";
import { CombatRegistry, processContacts } from "./combat";
import { Sim } from "./world";

/**
 * AGENTS.md: no per-tick allocation in the fixed step. Node gives no allocation counter worth
 * trusting, so these check the thing an allocation-free tick is made of: the objects it hands out
 * are the same objects every tick. (Rapier's own accessors, `translation()` among them, still
 * return a fresh vector per call; that is the binding's and out of reach here.)
 */
describe("a tick's reused objects", () => {
  it("keeps each cart's render transforms in two buffers it swaps, and previous is last tick's", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 2 });
    const seen = new Set<object>();
    const botSeen = [new Set<object>(), new Set<object>()];
    const drive = neutralIntent();
    drive.throttle = 1;
    let lastX = sim.currentCart.position.x;
    for (let tick = 0; tick < 120; tick++) {
      if (tick === 60) sim.reset();
      sim.step(drive);
      seen.add(sim.currentCart).add(sim.previousCart);
      sim.currentBotCarts.forEach((t, i) => botSeen[i]!.add(t));
      sim.previousBotCarts.forEach((t, i) => botSeen[i]!.add(t));
      if (tick !== 60) expect(sim.previousCart.position.x).toBe(lastX);
      expect(sim.currentCart).not.toBe(sim.previousCart);
      lastX = sim.currentCart.position.x;
    }
    expect(seen.size).toBe(2);
    expect(botSeen.map((s) => s.size)).toEqual([2, 2]);
  });

  it("hands back the same array from ballsNear on every call", async () => {
    await RAPIER.init();
    const pool = new BallPool(new RAPIER.World({ x: 0, y: -9.81, z: 0 }), { heightAt: () => 0 });
    const first = pool.ballsNear(0, 0, 5);
    expect(pool.ballsNear(10, 10, 5)).toBe(first);
  });

  it("gives Rapier the same contact callback every tick rather than a new closure", () => {
    const callbacks: unknown[] = [];
    const queue = { drainCollisionEvents: vi.fn((f: unknown) => callbacks.push(f)) };
    const ctx = { registry: new CombatRegistry(), onBallHit: () => {}, onCartKilled: () => {} };
    processContacts(queue, ctx);
    processContacts(queue, ctx);
    expect(callbacks[1]).toBe(callbacks[0]);
  });
});
