import { describe, expect, it } from "vitest";
import { relaxNine } from "./courseRelaxation";
import type { HolePlacement, LayoutHole } from "./courseLayout";

function hole(index: number, length: number): LayoutHole {
  return {
    index,
    tee: { x: -length / 2, z: 0 },
    cup: { x: length / 2, z: 0 },
    control: [
      { x: -length / 2, z: 0 },
      { x: length / 2, z: 0 },
    ],
  };
}

function place(
  layout: readonly HolePlacement[],
  holes: readonly LayoutHole[],
  index: number,
  local: { x: number; z: number },
): { x: number; z: number } {
  const p = layout.find((q) => q.index === index)!;
  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);
  return { x: p.offsetX + local.x * cos - local.z * sin, z: p.offsetZ + local.x * sin + local.z * cos };
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Three holes laid out in a straight line, 960 m from the clubhouse and pointing further away --
// a deliberately bad initial guess (real callers pass placeNineAsLobes's output, which already
// points roughly homeward). Nothing about relaxNine should assume a good starting guess; the
// attractor is what has to do the work here.
function straightLine(): {
  holes: LayoutHole[];
  initial: HolePlacement[];
  hub: { x: number; z: number };
  clubhouse: { x: number; z: number };
} {
  const holes = [hole(0, 300), hole(1, 300), hole(2, 300)];
  const initial: HolePlacement[] = [
    { index: 0, offsetX: 150, offsetZ: 0, rotation: 0 },
    { index: 1, offsetX: 480, offsetZ: 0, rotation: 0 },
    { index: 2, offsetX: 810, offsetZ: 0, rotation: 0 },
  ];
  return { holes, initial, hub: { x: 0, z: 0 }, clubhouse: { x: 0, z: 0 } };
}

describe("relaxNine", () => {
  it("never changes a hole's own length", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    for (const h of holes) {
      const local = dist(h.tee, h.cup);
      const placed = dist(place(relaxed, holes, h.index, h.tee), place(relaxed, holes, h.index, h.cup));
      expect(placed).toBeCloseTo(local, 6);
    }
  });

  it("pulls the last cup closer to the clubhouse than the bad initial guess left it", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const before = dist(place(initial, holes, 2, holes[2]!.cup), clubhouse);
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    const after = dist(place(relaxed, holes, 2, holes[2]!.cup), clubhouse);
    expect(after).toBeLessThan(before);
  });

  it("keeps every transition within the slack bounds", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    for (let i = 0; i + 1 < holes.length; i++) {
      const green = place(relaxed, holes, i, holes[i]!.cup);
      const tee = place(relaxed, holes, i + 1, holes[i + 1]!.tee);
      const walk = dist(green, tee);
      expect(walk).toBeGreaterThanOrEqual(15 - 0.5);
      expect(walk).toBeLessThanOrEqual(100 + 0.5);
    }
  });

  it("pins the first hole's tee on the hub", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    expect(dist(place(relaxed, holes, 0, holes[0]!.tee), hub)).toBeLessThan(0.01);
  });
});
