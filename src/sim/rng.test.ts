import { describe, expect, it } from "vitest";
import { hashChannel, mulberry32 } from "./rng";

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("produces a different stream for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays in [0, 1)", () => {
    const next = mulberry32(0xdeadbeef);
    for (let i = 0; i < 10000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("has a mean near 0.5 over a long run", () => {
    const next = mulberry32(7);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += next();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it("treats the seed as uint32, so a negative seed is still a valid stream", () => {
    const a = mulberry32(-1);
    const b = mulberry32(0xffffffff);
    expect(a()).toBe(b());
  });
});

describe("hashChannel", () => {
  it("is deterministic", () => {
    expect(hashChannel(42, 3, 0)).toBe(hashChannel(42, 3, 0));
  });

  it("separates channels that differ only in the last coordinate", () => {
    expect(hashChannel(42, 3, 0)).not.toBe(hashChannel(42, 3, 1));
    expect(hashChannel(42, 3, 1)).not.toBe(hashChannel(42, 3, 2));
  });

  it("is order-sensitive", () => {
    expect(hashChannel(42, 1, 0)).not.toBe(hashChannel(42, 0, 1));
  });

  it("mixes even with no coordinates, so hashChannel(s) is not s", () => {
    expect(hashChannel(42)).not.toBe(42);
  });

  it("returns a uint32", () => {
    for (let i = 0; i < 1000; i++) {
      const h = hashChannel(i, i * 7, i * 13);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("spreads two adjacent seeds into unrelated streams", () => {
    const a = mulberry32(hashChannel(1000, 0, 0))();
    const b = mulberry32(hashChannel(1001, 0, 0))();
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});
