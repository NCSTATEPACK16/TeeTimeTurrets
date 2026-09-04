import { describe, expect, it } from "vitest";
import { createHudStateScratch, deriveHudState } from "./hudState";
import { ClubType } from "../physics/Ballistics";
import type { HudSource, HudState } from "./hudState";

/** deriveHudState writes into a caller-owned scratch object rather than allocating (see its
 *  docstring); tests want a fresh return value each call, so this wraps that with a fresh
 *  scratch object per invocation. */
function derive(source: HudSource): HudState {
  const out = createHudStateScratch();
  deriveHudState(source, out);
  return out;
}

function source(overrides: Partial<HudSource> = {}): HudSource {
  return {
    strokes: 0,
    holedOut: false,
    lastShotInWater: false,
    lastShotOutOfBounds: false,
    matchTimeRemaining: 180,
    cart: {
      equippedClub: ClubType.Driver,
      charge: 0,
      canFire: true,
      reloadRemaining: 0,
      ammo: 10,
      dead: false,
      respawnTimer: 0,
      health: { hp: 100, max: 100 },
    },
    ...overrides,
  };
}

describe("combat element visibility", () => {
  it("always shows health and ammo: there is one HUD configuration now", () => {
    expect(derive(source()).combatVisible).toBe(true);
    expect(derive(source({ cart: { ...source().cart, ammo: 0 } })).combatVisible).toBe(true);
  });
});

describe("health", () => {
  it("reports the fraction and the rounded value", () => {
    const state = derive(source({ cart: { ...source().cart, health: { hp: 45, max: 100 } } }));
    expect(state.healthFraction).toBeCloseTo(0.45, 5);
    expect(state.healthText).toBe("45");
  });

  it("shows zero rather than hiding when the cart is dead", () => {
    // Section 5's rule is about elements with nothing behind them, not about a real value of zero.
    const state = derive(
      source({ cart: { ...source().cart, dead: true, respawnTimer: 2.4, health: { hp: 0, max: 100 } } }),
    );
    expect(state.combatVisible).toBe(true);
    expect(state.healthFraction).toBe(0);
    expect(state.healthText).toBe("0");
  });

  it("clamps a fraction that would otherwise go negative or past one", () => {
    const over = derive(source({ cart: { ...source().cart, health: { hp: 140, max: 100 } } }));
    const under = derive(source({ cart: { ...source().cart, health: { hp: -5, max: 100 } } }));
    expect(over.healthFraction).toBe(1);
    expect(under.healthFraction).toBe(0);
  });

  it("does not divide by zero on a zero-max health", () => {
    const state = derive(source({ cart: { ...source().cart, health: { hp: 0, max: 0 } } }));
    expect(state.healthFraction).toBe(0);
  });
});

describe("ammo", () => {
  it("reports the count", () => {
    expect(derive(source({ cart: { ...source().cart, ammo: 7 } })).ammoText).toBe("7");
  });
});

describe("status precedence", () => {
  it("puts death above reloading, because a dead cart's reload is frozen too", () => {
    const state = derive(
      source({ cart: { ...source().cart, dead: true, respawnTimer: 2.44, canFire: false, reloadRemaining: 1.2 } }),
    );
    expect(state.status).toBe("DESTROYED — RESPAWNING 2.4s");
  });

  it("reports holing out above everything", () => {
    expect(derive(source({ holedOut: true })).status).toBe("HOLED OUT — R to reset");
  });

  it("reports reloading when alive and not yet able to fire", () => {
    const state = derive(source({ cart: { ...source().cart, canFire: false, reloadRemaining: 1.25 } }));
    expect(state.status).toBe("RELOADING 1.2s");
  });

  it("reports the water hazard", () => {
    expect(derive(source({ lastShotInWater: true })).status).toBe("WATER HAZARD — plus one stroke");
  });

  it("reports out of bounds", () => {
    expect(derive(source({ lastShotOutOfBounds: true })).status).toBe(
      "OUT OF BOUNDS — returned to the tee",
    );
  });

  it("tells a player with no ammo that firing still boosts", () => {
    expect(derive(source({ cart: { ...source().cart, ammo: 0 } })).status).toBe(
      "NO AMMO — fire a blank to boost",
    );
  });
});

describe("the rest of the readout", () => {
  it("labels the club and the strokes", () => {
    const state = derive(source({ strokes: 3, cart: { ...source().cart, equippedClub: ClubType.Putter } }));
    expect(state.clubText).toBe("PUTTER");
    expect(state.strokesText).toBe("STROKES 3");
  });

  it("renders the clock as minutes and seconds", () => {
    expect(derive(source({ matchTimeRemaining: 180 })).timerText).toBe("3:00");
    expect(derive(source({ matchTimeRemaining: 65.9 })).timerText).toBe("1:05");
    expect(derive(source({ matchTimeRemaining: 9 })).timerText).toBe("0:09");
    expect(derive(source({ matchTimeRemaining: 0 })).timerText).toBe("0:00");
  });
});
