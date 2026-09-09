import { describe, expect, it } from "vitest";
import { boundsOf, fitProjection, padBounds, toCourseFrame } from "./mapCamera";
import type { PlacedField } from "./mapCamera";

function field(overrides: Partial<PlacedField> = {}): PlacedField {
  return { fieldSize: 200, offsetX: 0, offsetZ: 0, rotation: 0, ...overrides };
}

function courseFrame(f: PlacedField, x: number, z: number): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(f, x, z, out);
  return out;
}

describe("toCourseFrame", () => {
  it("is the identity for a hole at the origin with no rotation", () => {
    expect(courseFrame(field(), 12, -30)).toEqual({ x: 12, z: -30 });
  });

  it("translates by the hole's offset", () => {
    // Paired with the un-offset case so this cannot pass on an implementation that ignores the
    // local point and returns the offset.
    expect(courseFrame(field({ offsetX: 500, offsetZ: -200 }), 0, 0)).toEqual({ x: 500, z: -200 });
    expect(courseFrame(field({ offsetX: 500, offsetZ: -200 }), 10, 5)).toEqual({ x: 510, z: -195 });
  });

  it("rotates the local frame before translating it", () => {
    // A quarter turn sends local +X to course +Z.
    const rotated = courseFrame(field({ rotation: Math.PI / 2 }), 10, 0);
    expect(rotated.x).toBeCloseTo(0, 9);
    expect(rotated.z).toBeCloseTo(10, 9);
    // And the same point unrotated stays on +X, so the rotation is doing the work.
    expect(courseFrame(field(), 10, 0).x).toBeCloseTo(10, 9);
  });

  it("rotates about the hole's own centre, not the course origin", () => {
    const f = field({ rotation: Math.PI / 2, offsetX: 100, offsetZ: 0 });
    const centre = courseFrame(f, 0, 0);
    expect(centre.x).toBeCloseTo(100, 9);
    expect(centre.z).toBeCloseTo(0, 9);
  });
});

describe("boundsOf", () => {
  it("boxes a single unrotated field around its own centre", () => {
    expect(boundsOf([field()])).toEqual({ minX: -100, minZ: -100, maxX: 100, maxZ: 100 });
  });

  it("spans every field in the set", () => {
    const spread = [field(), field({ offsetX: 400 }), field({ offsetZ: -300 })];
    expect(boundsOf(spread)).toEqual({ minX: -100, minZ: -400, maxX: 500, maxZ: 100 });
  });

  it("includes the sweep of a rotated field rather than its unrotated box", () => {
    // A square turned 45 degrees needs sqrt(2) times its side to contain it.
    const square = boundsOf([field()]);
    const turned = boundsOf([field({ rotation: Math.PI / 4 })]);
    expect(turned.maxX).toBeGreaterThan(square.maxX);
    expect(turned.maxX).toBeCloseTo(100 * Math.SQRT2, 6);
  });

  it("is empty for no fields rather than infinite", () => {
    // A min/max reduce with no seed returns +/-Infinity here, which then poisons the projection.
    const empty = boundsOf([]);
    expect(Number.isFinite(empty.minX)).toBe(true);
    expect(Number.isFinite(empty.maxX)).toBe(true);
    // Paired with a populated set, so a stub returning a fixed zero box fails this too.
    expect(boundsOf([field()])).not.toEqual(empty);
  });
});

describe("padBounds", () => {
  it("grows the box on all four sides", () => {
    const padded = padBounds({ minX: 0, minZ: 0, maxX: 10, maxZ: 20 }, 5);
    expect(padded).toEqual({ minX: -5, minZ: -5, maxX: 15, maxZ: 25 });
  });
});

describe("fitProjection", () => {
  const box = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };

  it("fits the box inside the canvas", () => {
    const p = fitProjection(box, 400, 400, 0);
    expect(p.x(0)).toBeCloseTo(0, 6);
    expect(p.x(100)).toBeCloseTo(400, 6);
    expect(p.y(0)).toBeCloseTo(0, 6);
    expect(p.y(100)).toBeCloseTo(400, 6);
  });

  it("uses one scale for both axes and centres the leftover", () => {
    // A square box in a 800x400 canvas is limited by height; the 400 px of slack in X is split.
    const p = fitProjection(box, 800, 400, 0);
    expect(p.scale).toBeCloseTo(4, 6);
    expect(p.x(0)).toBeCloseTo(200, 6);
    expect(p.x(100)).toBeCloseTo(600, 6);
    expect(p.y(0)).toBeCloseTo(0, 6);
  });

  it("keeps world +Z running down the page, the handedness the heightfield uses", () => {
    // Flipping this would mirror every dog-leg against the committed plans.
    const p = fitProjection(box, 400, 400, 0);
    expect(p.y(100)).toBeGreaterThan(p.y(0));
  });

  it("insets by the padding on every side", () => {
    const p = fitProjection(box, 400, 400, 20);
    expect(p.x(0)).toBeCloseTo(20, 6);
    expect(p.x(100)).toBeCloseTo(380, 6);
    // Paired with the unpadded case so a hardcoded inset cannot pass.
    expect(fitProjection(box, 400, 400, 0).x(0)).toBeCloseTo(0, 6);
  });

  it("survives a degenerate box without producing NaN", () => {
    // A zero-extent box divides by zero when computing scale.
    const p = fitProjection({ minX: 5, minZ: 5, maxX: 5, maxZ: 5 }, 400, 400, 0);
    expect(Number.isFinite(p.x(5))).toBe(true);
    expect(Number.isFinite(p.y(5))).toBe(true);
    expect(Number.isFinite(p.scale)).toBe(true);
    // Paired with a real box, so a stub returning zeros for everything fails this too.
    expect(fitProjection(box, 400, 400, 0).scale).toBeCloseTo(4, 6);
  });
});
