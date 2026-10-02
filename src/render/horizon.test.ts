import { describe, expect, it } from "vitest";
import { buildGraph } from "../entities/primitiveGraph";
import { HILL_NAMES, hillGraph } from "../entities/envGraphs";
import { hillWidths, placeHorizon } from "./horizon";

const bounds = { minX: -600, maxX: 500, minZ: -700, maxZ: 400 };
const flat = (): number => 3;

describe("the horizon ring", () => {
  const placement = placeHorizon(bounds, flat, 1234);

  it("has at least 16 cards, every one outside the course bounds", () => {
    expect(placement.cards.length).toBeGreaterThanOrEqual(16);
    for (const card of placement.cards) {
      const inside = card.x > bounds.minX && card.x < bounds.maxX && card.z > bounds.minZ && card.z < bounds.maxZ;
      expect(inside).toBe(false);
    }
  });

  it("leaves no gap in the skyline: neighbours touch or overlap", () => {
    const widths = hillWidths();
    const cards = placement.cards;
    for (let i = 0; i < cards.length; i++) {
      const a = cards[i]!;
      const b = cards[(i + 1) % cards.length]!;
      const gap = Math.hypot(b.x - a.x, b.z - a.z);
      const reach = (widths[a.type] * a.scale + widths[b.type] * b.scale) / 2;
      expect(reach).toBeGreaterThanOrEqual(gap);
    }
  });

  it("sinks every card below the lowest ground on the bounds", () => {
    expect(placement.baseY).toBeLessThan(3);
  });

  it("keeps each card at 60 triangles or fewer", () => {
    for (const name of HILL_NAMES) {
      const built = buildGraph(hillGraph(name));
      let triangles = 0;
      built.root.traverse((o) => {
        const g = (o as { geometry?: { index: { count: number } | null; attributes: { position: { count: number } } } }).geometry;
        if (g) triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      expect(triangles).toBeLessThanOrEqual(60);
      built.dispose();
    }
  });
});
