import { describe, expect, it } from "vitest";
import { compareMetrics, compareSignature, SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "./gateCompare.mjs";

const BASE = { vertices: 1200, triangles: 2100, bbox: { x: 1.4, y: 2.3, z: 2.2 } };

describe("compareMetrics", () => {
  it("passes an identical subject", () => {
    expect(compareMetrics(BASE, { ...BASE, bbox: { ...BASE.bbox } })).toEqual([]);
  });

  it("fails on any triangle count change, however small", () => {
    const failures = compareMetrics(BASE, { ...BASE, triangles: 2101, bbox: { ...BASE.bbox } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("triangles");
  });

  it("fails on any vertex count change, however small", () => {
    const failures = compareMetrics(BASE, { ...BASE, vertices: 1199, bbox: { ...BASE.bbox } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("vertices");
  });

  it("tolerates bbox drift inside the band and rejects it outside", () => {
    const inside = { ...BASE, bbox: { x: 1.4 * 1.004, y: 2.3, z: 2.2 } };
    const outside = { ...BASE, bbox: { x: 1.4 * 1.02, y: 2.3, z: 2.2 } };
    expect(compareMetrics(BASE, inside)).toEqual([]);
    expect(compareMetrics(BASE, outside)).toHaveLength(1);
  });

  it("reports every breached metric, not just the first", () => {
    const actual = { vertices: 1, triangles: 2, bbox: { x: 9, y: 9, z: 9 } };
    expect(compareMetrics(BASE, actual).length).toBeGreaterThan(2);
  });
});

describe("compareSignature", () => {
  const size = SIGNATURE_WIDTH * SIGNATURE_HEIGHT * 3;
  const flat = (v) => new Array(size).fill(v);

  it("passes an identical signature", () => {
    const result = compareSignature(flat(120), flat(120));
    expect(result.ok).toBe(true);
    expect(result.meanDelta).toBe(0);
  });

  it("tolerates uniform low-amplitude noise below threshold", () => {
    const noisy = flat(120).map((v, i) => v + (i % 2 === 0 ? 2 : -2));
    expect(compareSignature(flat(120), noisy).ok).toBe(true);
  });

  it("fails a wholesale change", () => {
    const result = compareSignature(flat(120), flat(40));
    expect(result.ok).toBe(false);
    expect(result.meanDelta).toBeCloseTo(80, 5);
    expect(result.maxDelta).toBe(80);
  });

  it("rejects a length mismatch rather than comparing a prefix", () => {
    expect(() => compareSignature(flat(120), flat(120).slice(0, -3))).toThrow(/length/i);
  });
});
