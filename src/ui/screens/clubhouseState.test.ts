import { describe, expect, it } from "vitest";
import { ClubhouseState, clubStatCards } from "./clubhouseState";
import { CHASSIS_PAINTS, TIRE_OPTIONS, TURRET_SKINS, createLoadout } from "../../sim/loadout";
import { CLUB_STATS, ClubType } from "../../physics/Ballistics";

/**
 * The clubhouse's decisions, with no DOM in sight -- the `hudState.ts` / `hud.ts` split again,
 * and the reason this is testable in vitest's node environment at all.
 *
 * Two behaviours carry real weight. First, **preview is not purchase**: image 11 has a CONFIRM
 * button, so clicking a swatch has to show the paint on the turntable without spending a coin or
 * committing anything, and BACK has to put it all back. Second, the stat cards must be derived
 * from `CLUB_STATS`, never retyped -- `AGENTS.md` forbids a second source of truth for club
 * stats, and RANGE is the dangerous one because it is not a field in that table.
 */

function state(coins = 5000): ClubhouseState {
  return new ClubhouseState(createLoadout(), coins);
}

describe("previewing", () => {
  it("shows a selection immediately without spending anything", () => {
    const s = state();
    s.select("paint", "sunset");
    expect(s.preview.paint).toBe("sunset");
    expect(s.coins).toBe(5000);
    expect(s.equipped.paint).toBe(CHASSIS_PAINTS[0]!.id);
  });

  it("reports the live slot colours so the turntable can repaint per click", () => {
    const s = state();
    s.select("skin", "olive");
    const skin = TURRET_SKINS.find((o) => o.id === "olive")!;
    expect(s.previewColors["turret_housing"]).toBe(skin.slots["turret_housing"]);
  });

  it("is dirty once a preview differs from what is equipped, and clean again if reverted", () => {
    const s = state();
    expect(s.dirty).toBe(false);
    s.select("paint", "sunset");
    expect(s.dirty).toBe(true);
    s.select("paint", CHASSIS_PAINTS[0]!.id);
    expect(s.dirty).toBe(false);
  });

  it("throws the preview away on cancel", () => {
    const s = state();
    s.select("paint", "sunset");
    s.select("tire", "knobby");
    s.cancel();
    expect(s.preview).toEqual(s.equipped);
    expect(s.dirty).toBe(false);
  });

  it("ignores a selection it does not recognise rather than showing a blank cart", () => {
    const s = state();
    s.select("paint", "no-such-paint");
    expect(s.preview.paint).toBe(CHASSIS_PAINTS[0]!.id);
  });
});

describe("affordability", () => {
  it("treats an option as owned once bought and never charges twice", () => {
    const s = state(1000);
    s.select("skin", "olive"); // 700
    s.confirm();
    expect(s.coins).toBe(300);

    s.select("skin", TURRET_SKINS[0]!.id);
    s.confirm();
    s.select("skin", "olive");
    s.confirm();
    // Re-equipping something already owned is free, or a player is taxed for changing their mind.
    expect(s.coins).toBe(300);
  });

  it("marks options the player cannot afford", () => {
    const s = state(100);
    expect(s.affordable("skin", "olive")).toBe(false);
    expect(s.affordable("skin", TURRET_SKINS[0]!.id)).toBe(true);
  });

  it("refuses to confirm a selection the player cannot afford", () => {
    const s = state(100);
    s.select("skin", "chrome"); // 1600
    expect(s.confirm()).toBe(false);
    expect(s.coins).toBe(100);
    expect(s.equipped.skin).toBe(TURRET_SKINS[0]!.id);
  });

  it("charges once for a confirm that changes two categories", () => {
    const s = state(5000);
    s.select("paint", "sunset"); // 900
    s.select("skin", "olive"); // 700
    expect(s.confirm()).toBe(true);
    expect(s.coins).toBe(3400);
  });

  it("equips the preview on a successful confirm and goes clean", () => {
    const s = state();
    s.select("tire", "turf");
    s.confirm();
    expect(s.equipped.tire).toBe("turf");
    expect(s.dirty).toBe(false);
  });

  it("reports the price of the pending purchase", () => {
    const s = state();
    expect(s.pendingCost).toBe(0);
    s.select("paint", "sunset");
    expect(s.pendingCost).toBe(900);
    s.select("skin", "olive");
    expect(s.pendingCost).toBe(1600);
  });
});

describe("club stat cards", () => {
  it("has one card per club, in putter/iron/driver order", () => {
    expect(clubStatCards().map((c) => c.club)).toEqual([
      ClubType.Putter,
      ClubType.Iron,
      ClubType.Driver,
    ]);
  });

  it("labels the three bars image 11 shows", () => {
    expect(clubStatCards()[0]!.bars.map((b) => b.label)).toEqual(["POWER", "RANGE", "RELOAD"]);
  });

  it("normalises every bar into 0..1 so they are drawable", () => {
    for (const card of clubStatCards()) {
      for (const bar of card.bars) {
        expect(bar.value, `${card.club} ${bar.label}`).toBeGreaterThanOrEqual(0);
        expect(bar.value, `${card.club} ${bar.label}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ranks power by the table's own maxSpeed rather than a retyped number", () => {
    const cards = clubStatCards();
    const power = (c: ClubType): number => cards.find((x) => x.club === c)!.bars[0]!.value;
    expect(power(ClubType.Driver)).toBeGreaterThan(power(ClubType.Iron));
    expect(power(ClubType.Iron)).toBeGreaterThan(power(ClubType.Putter));
    // The driver is the maximum, so its bar is full -- which pins the scale to CLUB_STATS.
    expect(power(ClubType.Driver)).toBe(1);
  });

  it("shows a faster reload as a FULLER bar, not a longer wait", () => {
    const cards = clubStatCards();
    const reload = (c: ClubType): number => cards.find((x) => x.club === c)!.bars[2]!.value;
    // The putter reloads in 0.4s and the driver in 2.2s; a bar the player reads as "better"
    // must be longer for the putter, or the card says the opposite of what it means.
    expect(CLUB_STATS[ClubType.Putter].reloadSeconds).toBeLessThan(
      CLUB_STATS[ClubType.Driver].reloadSeconds,
    );
    expect(reload(ClubType.Putter)).toBeGreaterThan(reload(ClubType.Driver));
  });

  it("makes no numeric claim for range -- the model ranks, it does not predict", () => {
    // A vacuum estimate ignores drag and roll-out, and roll is most of a putter's distance:
    // the probe measures 7.5 m where this model says under 1 m. A bar can rank honestly; a
    // printed number would be confidently wrong.
    for (const card of clubStatCards()) {
      expect(card.bars[1]!.detail).toBe("");
    }
    // The two that DO come straight off the table keep their real units.
    expect(clubStatCards()[0]!.bars[0]!.detail).toBe("9 m/s");
    expect(clubStatCards()[0]!.bars[2]!.detail).toBe("0.4 s");
  });

  it("derives range from the ballistics rather than from a range field", () => {
    // There is no `range` in CLUB_STATS and there must not be one: sim/carry.ts is explicit that
    // distance is emergent, not tabulated. The ordering below is a property of loft and speed.
    expect("range" in CLUB_STATS[ClubType.Driver]).toBe(false);
    const cards = clubStatCards();
    const range = (c: ClubType): number => cards.find((x) => x.club === c)!.bars[1]!.value;
    expect(range(ClubType.Driver)).toBeGreaterThan(range(ClubType.Iron));
    expect(range(ClubType.Iron)).toBeGreaterThan(range(ClubType.Putter));
  });

  it("moves the range bar when loft changes, proving it is computed and not hardcoded", () => {
    const before = clubStatCards().find((c) => c.club === ClubType.Iron)!.bars[1]!.value;
    const original = CLUB_STATS[ClubType.Iron].loftDeg;
    try {
      // 45 degrees is the vacuum-optimal launch angle, so this must raise the iron's range.
      CLUB_STATS[ClubType.Iron].loftDeg = 45;
      const after = clubStatCards().find((c) => c.club === ClubType.Iron)!.bars[1]!.value;
      expect(after).toBeGreaterThan(before);
    } finally {
      CLUB_STATS[ClubType.Iron].loftDeg = original;
    }
  });
});

describe("tires are sold as a stat", () => {
  it("carries the handling note for each tire so the trade is legible before buying", () => {
    for (const tire of TIRE_OPTIONS) {
      expect(tire.note.length).toBeGreaterThan(0);
    }
  });
});
