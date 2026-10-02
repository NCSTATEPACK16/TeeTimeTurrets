import { describe, expect, it } from "vitest";
import { Cart } from "./entities/Cart";
import { PICKUP_COOLDOWN_S, createPickupStates, siteInReach, take } from "./pickups";

/** Smoke check for pickup collection (`docs/art/specs/sim-slices.md` §3). */
describe("pickup collection", () => {
  it("a take starts the site's cooldown: charged again at 60 s, not before, and a full cart passes through", () => {
    const states = createPickupStates([{ x: 0, z: 0, type: "hot_dog", depot: false }]);
    const hurt = new Cart({ position: { x: 1, y: 0, z: 1 } });
    hurt.health.hp = 1;
    const other = new Cart({ position: { x: 1, y: 0, z: 1 } });
    other.health.hp = 1;

    // At full health a cart cannot take it, and the site stays charged.
    const full = new Cart({ position: { x: 1, y: 0, z: 1 } });
    expect(siteInReach(states, full, 5)).toBe(-1);
    expect(siteInReach(states, hurt, 5)).toBe(0);

    take(states, 0, hurt, 5);
    expect(hurt.health.hp).toBe(4);
    expect(states[0]!.readyAt).toBe(5 + PICKUP_COOLDOWN_S);
    expect(siteInReach(states, other, 5 + PICKUP_COOLDOWN_S - 0.01)).toBe(-1);
    expect(siteInReach(states, other, 5 + PICKUP_COOLDOWN_S)).toBe(0);
  });
});
