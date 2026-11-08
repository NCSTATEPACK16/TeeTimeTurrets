import { describe, expect, it } from "vitest";
import { mulberry32 } from "../sim/rng";
import { SpriteFrame, SpritePool } from "./spritePool";
import type { SpriteSpec } from "./spritePool";

const SMOKE: SpriteSpec = {
  count: 4, speed: 2, lift: 1, life: 1, sizeStart: 0.5, sizeEnd: 2, gravity: -1, drag: 1,
  color: [0x111111, 0x222222], alpha: 0.6, frame: SpriteFrame.Smoke,
};

describe("SpritePool", () => {
  it("emits, rises, grows, fades out and dies; recycles the oldest when full", () => {
    const pool = new SpritePool(6, mulberry32(7));
    pool.emit(0, 0, 0, SMOKE);
    expect(pool.liveCount).toBe(4);
    const s = pool.sprites.find((p) => p.life > 0)!;
    const size0 = pool.sizeOf(s);
    for (let i = 0; i < 30; i++) pool.update(1 / 60);
    const live = pool.sprites.filter((p) => p.life > 0);
    const meanY = live.reduce((sum, p) => sum + p.y, 0) / live.length;
    expect(meanY).toBeGreaterThan(0.3); // lift and negative gravity: the puff rises as a whole
    expect(pool.sizeOf(s)).toBeGreaterThan(size0);
    expect([0x111111, 0x222222]).toContain(s.color);

    pool.emit(0, 0, 0, SMOKE); // 4 more into 2 free slots: 2 must be stolen
    expect(pool.liveCount).toBe(6);

    for (let i = 0; i < 90; i++) pool.update(1 / 60);
    expect(pool.liveCount).toBe(0);
    expect(pool.alphaOf(s)).toBe(0);
  });

  it("focuses a directed emission along its direction", () => {
    const pool = new SpritePool(50, mulberry32(3));
    pool.emit(0, 0, 0, { ...SMOKE, count: 50, lift: 0, gravity: 0, focus: 1 }, 1, 0, 0);
    for (const s of pool.sprites) expect(s.vx).toBeGreaterThan(0);
  });
});
