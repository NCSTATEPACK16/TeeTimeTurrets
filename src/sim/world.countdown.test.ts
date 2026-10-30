import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { neutralIntent } from "./intent";
import { Match } from "./match";
import { Sim } from "./world";

const DT = 1 / 60;

/**
 * The pre-match countdown. The match clock must not move while it runs, the player's cart must
 * not move under full throttle, and the cart must move once FORE! lets it go -- the last check is
 * what keeps "it held still" from passing because the throttle never did anything.
 */
describe("pre-match countdown", () => {
  it("spends the countdown before the clock, and reset puts it back", () => {
    const match = new Match({ playerCount: 2, durationS: 10 * DT, countdownS: 3 * DT });
    expect(match.phase).toBe("countdown");
    for (let i = 0; i < 3; i++) match.tick(DT);
    expect(match.phase).toBe("live");
    expect(match.remaining).toBeCloseTo(10 * DT, 12);

    match.tick(DT);
    expect(match.remaining).toBeCloseTo(9 * DT, 12);

    match.reset();
    expect(match.phase).toBe("countdown");
    expect(match.countdownRemaining).toBeCloseTo(3 * DT, 12);
  });

  it("holds the player's cart under throttle until FORE!, then lets it drive", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0, countdownS: 1 });
    const gas = { ...neutralIntent(), throttle: 1 };
    for (let i = 0; i < 20; i++) sim.step(); // settle onto the ground
    const start = { ...sim.cart.position };

    for (let i = 0; i < 40; i++) sim.step(gas); // the rest of the 1 s countdown
    expect(sim.matchPhase).toBe("live");
    expect(Math.hypot(sim.cart.position.x - start.x, sim.cart.position.z - start.z)).toBeLessThan(0.05);

    for (let i = 0; i < 60; i++) sim.step(gas);
    expect(Math.hypot(sim.cart.position.x - start.x, sim.cart.position.z - start.z)).toBeGreaterThan(1);
    sim.dispose();
  });
});
