import { describe, expect, it } from "vitest";
import {
  CHASSIS_PAINTS,
  TIRE_OPTIONS,
  TURRET_SKINS,
  botLoadout,
  createLoadout,
  slotColorsFor,
} from "./loadout";
import { TireType } from "./entities/Cart";
import { CART_GRAPH } from "../entities/cartGraph";
import { TEAM_CANOPY } from "../render/teamColors";

/**
 * The cosmetics taxonomy. DOM-free and Rapier-free like everything under src/sim/**.
 *
 * The rule this file exists to keep honest is `ROADMAP.md`'s: **tire type is a stat, not a skin.**
 * Paint and skin are pure appearance; the tire changes how the cart handles. So `TIRE_OPTIONS`
 * must name the real `TireType` the sim already tunes rather than inventing a parallel list --
 * a second source of truth here would let the clubhouse sell a tire the physics has never heard
 * of.
 */

describe("cosmetics are appearance only", () => {
  it("resolves a paint to colours for slots the cart graph actually declares", () => {
    for (const paint of CHASSIS_PAINTS) {
      for (const slot of Object.keys(paint.slots)) {
        expect(Object.keys(CART_GRAPH.slots), `${paint.id} paints "${slot}"`).toContain(slot);
      }
    }
  });

  it("resolves every turret skin to declared slots too", () => {
    for (const skin of TURRET_SKINS) {
      for (const slot of Object.keys(skin.slots)) {
        expect(Object.keys(CART_GRAPH.slots), `${skin.id} paints "${slot}"`).toContain(slot);
      }
    }
  });

  it("gives every option a distinct id", () => {
    const ids = [...CHASSIS_PAINTS, ...TURRET_SKINS, ...TIRE_OPTIONS].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with the first option of each category owned and equipped", () => {
    const loadout = createLoadout();
    expect(loadout.paint).toBe(CHASSIS_PAINTS[0]!.id);
    expect(loadout.skin).toBe(TURRET_SKINS[0]!.id);
    expect(loadout.tire).toBe(TIRE_OPTIONS[0]!.id);
  });

  it("prices the default option of each category at zero -- a player owns their starting cart", () => {
    expect(CHASSIS_PAINTS[0]!.price).toBe(0);
    expect(TURRET_SKINS[0]!.price).toBe(0);
    expect(TIRE_OPTIONS[0]!.price).toBe(0);
  });
});

describe("tire type is a stat, not a skin", () => {
  it("offers exactly the tires the sim tunes, by the sim's own enum", () => {
    // Not a parallel list of names: these ARE `TireType`, so a tire cannot be sold that
    // `TIRE_TUNING` has no entry for.
    expect(TIRE_OPTIONS.map((t) => t.tire).sort()).toEqual(
      [TireType.Street, TireType.Knobby, TireType.Turf].sort(),
    );
  });

  it("carries no slot colours -- buying a tire changes handling, not paint", () => {
    for (const tire of TIRE_OPTIONS) {
      expect(tire).not.toHaveProperty("slots");
    }
  });
});

describe("slotColorsFor", () => {
  it("merges the equipped paint and skin into one override map", () => {
    const loadout = createLoadout();
    const colors = slotColorsFor({ ...loadout, paint: "sunset", skin: "olive" });
    expect(colors).toHaveProperty("chassis");
    expect(colors).toHaveProperty("turret_housing");
  });

  it("lets the turret skin win where the two categories touch the same slot", () => {
    // Both categories could name `turret_housing`; the skin is the one the player chose FOR the
    // turret, so it must not be silently overwritten by the body paint.
    const colors = slotColorsFor({ paint: "sunset", skin: "olive", tire: TIRE_OPTIONS[0]!.id });
    const skin = TURRET_SKINS.find((s) => s.id === "olive")!;
    expect(colors["turret_housing"]).toBe(skin.slots["turret_housing"]);
  });

  it("falls back to the defaults when an id is not recognised", () => {
    const colors = slotColorsFor({ paint: "no-such-paint", skin: "no-such-skin", tire: "nope" });
    expect(colors["chassis"]).toBe(CHASSIS_PAINTS[0]!.slots["chassis"]);
  });
});

/** Stage 8 slice 4's smoke check: bot looks, and no paint in a team's hue (BACKLOG #49). */
describe("every rig's loadout", () => {
  it("gives a bot the same real look for the same index and seed, and varies across bots", () => {
    const looks = [1, 2, 3, 4, 5, 6, 7].map((i) => botLoadout(i, 2026));
    expect(looks).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => botLoadout(i, 2026)));
    for (const look of looks) {
      expect(CHASSIS_PAINTS.some((p) => p.id === look.paint)).toBe(true);
      expect(TURRET_SKINS.some((s) => s.id === look.skin)).toBe(true);
      expect(look.tire).toBe(TIRE_OPTIONS[0]!.id);
    }
    expect(new Set(looks.map((l) => `${l.paint}/${l.skin}`)).size).toBeGreaterThan(2);
  });

  it("keeps every chassis paint well away from both team canopies", () => {
    const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const distance = (a: number, b: number): number => {
      const [ar, ag, ab] = rgb(a);
      const [br, bg, bb] = rgb(b);
      return Math.hypot(ar - br, ag - bg, ab - bb);
    };
    // The control: the old orange paint sat 23 from the orange canopy and the old blue 63 from the blue one.
    expect(distance(0xef8a2b, TEAM_CANOPY[1])).toBeLessThan(MIN_TEAM_DISTANCE);
    expect(distance(0x2d5fa8, TEAM_CANOPY[0])).toBeLessThan(MIN_TEAM_DISTANCE);
    for (const paint of CHASSIS_PAINTS) {
      for (const canopy of TEAM_CANOPY) {
        expect(distance(paint.slots.chassis!, canopy), `${paint.id} vs ${canopy.toString(16)}`).toBeGreaterThanOrEqual(
          MIN_TEAM_DISTANCE,
        );
      }
    }
  });
});

/** RGB distance below which a paint reads as a team's colour at a glance. */
const MIN_TEAM_DISTANCE = 120;
