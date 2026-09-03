import { describe, expect, it } from "vitest";
import { applyDamage, createHealth, heal, setMaxHealth } from "./health";

describe("health", () => {
  it("starts full", () => {
    const h = createHealth(100);
    expect(h.hp).toBe(100);
    expect(h.max).toBe(100);
  });

  it("clamps hp at zero rather than going negative", () => {
    const h = createHealth(100);
    applyDamage(h, 250);
    expect(h.hp).toBe(0);
  });

  it("returns true only on the tick that crosses to zero", () => {
    const h = createHealth(100);
    expect(applyDamage(h, 40)).toBe(false);
    expect(applyDamage(h, 60)).toBe(true);
    expect(applyDamage(h, 10)).toBe(false);
  });

  it("ignores non-positive damage", () => {
    const h = createHealth(100);
    expect(applyDamage(h, 0)).toBe(false);
    expect(applyDamage(h, -10)).toBe(false);
    expect(h.hp).toBe(100);
  });

  it("heals up to max and no further", () => {
    const h = createHealth(100);
    applyDamage(h, 70);
    heal(h, 20);
    expect(h.hp).toBe(50);
    heal(h, 999);
    expect(h.hp).toBe(100);
  });
});

describe("setMaxHealth", () => {
  it("resizes the bar and refills it", () => {
    const h = createHealth(100);
    applyDamage(h, 40);
    setMaxHealth(h, 8);
    expect(h.max).toBe(8);
    expect(h.hp).toBe(8);
  });
});
