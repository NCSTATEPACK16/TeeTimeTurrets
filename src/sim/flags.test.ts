import { describe, expect, it } from "vitest";
import { CAPTURE_HOLE_INDICES, captureSites, courseArenaZone } from "./arena";
import { authoredCourse } from "./authoredCourse";
import { buildCourseWorld } from "./courseWorld";
import { SimEventLog } from "./events";
import type { SimEventKind } from "./events";
import { BLEED_TICKS, CAPTURE_TICKS, CaptureField, NO_TEAM } from "./flags";
import type { CaptureCart } from "./flags";
import { Match, TEAM_DRAW } from "./match";
import { SurfaceId } from "./surfaceId";

/**
 * Stage 3.5c's capture flags, against the rules in
 * `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md` §2. Pure: no Rapier, no
 * course, except the last case, which reads the sites off the course as it ships.
 *
 * Carts are plain points; a cart's index is its rig index, so even indices are team 0 and odd ones
 * team 1, as `teamOf` deals them.
 */

const SITES = [
  { x: 0, y: 0, z: 0 },
  { x: 200, y: 0, z: 0 },
  { x: 400, y: 0, z: 0 },
];
const AWAY = { x: -1000, z: -1000 };

function cart(at: { x: number; z: number } = AWAY): CaptureCart & { position: { x: number; z: number } } {
  return { position: { x: at.x, z: at.z }, dead: false };
}

function moveTo(c: { position: { x: number; z: number } }, at: { x: number; z: number }): void {
  c.position.x = at.x;
  c.position.z = at.z;
}

function setup(carts: number) {
  const field = new CaptureField(SITES);
  const match = new Match({ playerCount: carts, durationS: 600 });
  const events = new SimEventLog();
  const list = Array.from({ length: carts }, () => cart());
  let tick = 0;
  const kinds: { kind: SimEventKind; tick: number; target: number; amount: number }[] = [];
  const cursor = events.cursor();
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      tick++;
      field.tick(list, match, events, tick);
      for (let s = cursor.begin(); s < events.total; s++) {
        const e = events.at(s)!;
        kinds.push({ kind: e.kind, tick: e.tick, target: e.target, amount: e.amount });
      }
      cursor.end();
    }
  };
  return { field, match, list, step, kinds, now: () => tick };
}

describe("taking a flag", () => {
  it("takes one cart exactly CAPTURE_TICKS (6 s) on a neutral flag", () => {
    const { field, list, step, kinds } = setup(1);
    moveTo(list[0]!, SITES[0]!);
    step(CAPTURE_TICKS - 1);
    expect(field.owner[0]).toBe(NO_TEAM);
    step();
    expect(field.owner[0]).toBe(0);
    expect(kinds).toEqual([{ kind: "flagCaptured", tick: 360, target: 0, amount: 0 }]);
  });

  it("takes three carts a third of the time, and a fourth adds nothing", () => {
    const three = setup(6);
    for (const i of [0, 2, 4]) moveTo(three.list[i]!, SITES[0]!);
    three.step(119);
    expect(three.field.owner[0]).toBe(NO_TEAM);
    three.step();
    expect(three.field.owner[0]).toBe(0);

    const four = setup(8);
    for (const i of [0, 2, 4, 6]) moveTo(four.list[i]!, SITES[0]!);
    four.step(119);
    expect(four.field.owner[0], "four carts captured faster than three").toBe(NO_TEAM);
  });

  it("does not move a contested flag, and flags it as contested", () => {
    const { field, list, step } = setup(2);
    moveTo(list[0]!, SITES[0]!);
    step(100);
    const before = field.points[0];
    moveTo(list[1]!, SITES[0]!);
    step(300);
    expect(field.contested[0]).toBe(1);
    expect(field.points[0]).toBe(before);
    expect(field.owner[0]).toBe(NO_TEAM);
  });

  it("does not count a dead cart", () => {
    const { field, list, step } = setup(2);
    moveTo(list[0]!, SITES[0]!);
    moveTo(list[1]!, SITES[0]!);
    (list[1] as { dead: boolean }).dead = true;
    step(CAPTURE_TICKS);
    expect(field.contested[0]).toBe(0);
    expect(field.owner[0]).toBe(0);
  });

  it("takes an enemy flag through neutral, in twice the time", () => {
    const { field, list, step, kinds } = setup(2);
    moveTo(list[0]!, SITES[0]!);
    step(CAPTURE_TICKS);
    moveTo(list[0]!, AWAY);
    moveTo(list[1]!, SITES[0]!);
    step(2 * CAPTURE_TICKS);
    expect(field.owner[0]).toBe(1);
    expect(kinds).toEqual([
      { kind: "flagCaptured", tick: 360, target: 0, amount: 0 },
      { kind: "flagNeutral", tick: 720, target: 0, amount: 0 },
      { kind: "flagCaptured", tick: 1080, target: 0, amount: 1 },
    ]);
  });
});

describe("the bleed", () => {
  it("costs the other side a stroke BLEED_TICKS (20 s) after the second flag is taken", () => {
    const { match, list, step, now } = setup(4);
    moveTo(list[0]!, SITES[0]!);
    moveTo(list[2]!, SITES[1]!);
    step(CAPTURE_TICKS);
    step(BLEED_TICKS - 1);
    expect(match.bleedFor(1)).toBe(0);
    step();
    expect(now()).toBe(CAPTURE_TICKS + BLEED_TICKS);
    expect(match.bleedFor(1)).toBe(1);
    expect(match.bleedFor(0)).toBe(0);
  });

  it("restarts the 20 s when the holding drops to one, rather than banking it", () => {
    const { match, list, step, kinds } = setup(4);
    moveTo(list[0]!, SITES[0]!);
    moveTo(list[2]!, SITES[1]!);
    step(CAPTURE_TICKS); // Both taken on tick 360.
    // Team 1 knocks flag B to neutral, on tick 720.
    moveTo(list[2]!, AWAY);
    moveTo(list[1]!, SITES[1]!);
    step(CAPTURE_TICKS);
    // Team 0 takes it back, on tick 1080.
    moveTo(list[1]!, AWAY);
    moveTo(list[2]!, SITES[1]!);
    step(CAPTURE_TICKS);
    expect(kinds.map((k) => `${k.kind}@${k.tick}`)).toEqual([
      "flagCaptured@360",
      "flagCaptured@360",
      "flagNeutral@720",
      "flagCaptured@1080",
    ]);
    // Banked, it would have landed at 360 + 1200 = 1560.
    step(BLEED_TICKS - 1);
    expect(match.bleedFor(1)).toBe(0);
    step();
    expect(match.bleedFor(1)).toBe(1);
    expect(kinds.at(-1)).toEqual({ kind: "flagBleed", tick: 1080 + BLEED_TICKS, target: 1, amount: 1 });
  });

  it("joins the score: a side's strokes are its deaths plus its bleed, and bleed alone decides", () => {
    const match = new Match({ playerCount: 4, durationS: 600 });
    match.scoreKill(0, 1); // Team 1 dies once...
    match.scoreKill(1, 0); // ...and so does team 0.
    match.scoreKill(3, 2);
    match.addBleed(1);
    match.addBleed(1);
    expect(match.teamStrokes(0)).toBe(match.strokesFor(0) + match.strokesFor(2));
    expect(match.teamStrokes(1)).toBe(match.strokesFor(1) + match.strokesFor(3) + 2);
    expect(match.teamStrokes(1)).toBe(3);

    // Level on deaths (1 each), so the bleed is the only difference: team 1 bled, team 0 wins.
    const level = new Match({ playerCount: 2, durationS: 600 });
    level.scoreKill(0, 1);
    level.scoreKill(1, 0);
    level.finish();
    expect(level.winningTeam()).toBe(TEAM_DRAW);
    level.addBleed(1);
    expect(level.winningTeam()).toBe(0);

    level.reset();
    expect(level.bleedFor(1)).toBe(0);
  });
});

describe("the sites on the course as it ships", () => {
  it("stands A, B and C on holes 14, 10 and 9's greens, inside the arena zone", () => {
    const world = buildCourseWorld(authoredCourse(2026), 2026);
    const zone = courseArenaZone(world);
    const sites = captureSites(world);
    expect(CAPTURE_HOLE_INDICES).toEqual([13, 9, 8]);
    expect(sites).toHaveLength(3);
    for (const site of sites) {
      expect(zone.contains(site.x, site.z)).toBe(true);
      expect(world.surfaces.surfaceAt(site.x, site.z)).toBe(SurfaceId.Green);
    }
  });
});
