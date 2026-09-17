import { describe, expect, it } from "vitest";
import { YARD_M, toMetres, toYards } from "./units";

describe("yards and metres", () => {
  it("uses the exact international yard", () => {
    expect(YARD_M).toBe(0.9144);
  });

  it("converts the card's own numbers", () => {
    expect(toMetres(508)).toBeCloseTo(464.52, 2);
    expect(toMetres(147)).toBeCloseTo(134.42, 2);
    expect(toMetres(6215)).toBeCloseTo(5683.0, 1);
  });

  it("round-trips in both directions", () => {
    // A conversion applied twice, or applied backwards, leaves numbers that still look plausible.
    // This is the only assertion that catches either.
    for (const yards of [147, 180, 320, 405, 458, 508, 6215]) {
      expect(toYards(toMetres(yards))).toBeCloseTo(yards, 6);
    }
    for (const metres of [100, 312.7, 464.5]) {
      expect(toMetres(toYards(metres))).toBeCloseTo(metres, 6);
    }
  });

  it("is not the same number in both directions", () => {
    // Guards the copy-paste where toYards is written as a second toMetres.
    expect(toYards(100)).not.toBeCloseTo(toMetres(100), 1);
    expect(toYards(100)).toBeGreaterThan(100);
    expect(toMetres(100)).toBeLessThan(100);
  });
});
