import { describe, expect, it } from "vitest";
import { ShardPool } from "./shardPool";

const burst = { count: 4, speed: 5, life: 1, gravity: 0, size: 0.2, color: 0xffffff };

describe("ShardPool", () => {
  it("spawns shards at the burst point, moving outward", () => {
    const pool = new ShardPool(16, () => 0.5);
    pool.burst(1, 2, 3, burst);
    expect(pool.liveCount).toBe(4);
    pool.update(0.1);
    for (const s of pool.shards.filter((p) => p.life > 0)) {
      expect(Math.hypot(s.x - 1, s.y - 2, s.z - 3)).toBeGreaterThan(0);
    }
  });

  it("lets a shard die when its life runs out", () => {
    const pool = new ShardPool(16, () => 0.5);
    pool.burst(0, 0, 0, burst);
    pool.update(0.5);
    expect(pool.liveCount).toBe(4);
    pool.update(0.6);
    expect(pool.liveCount).toBe(0);
  });

  it("shrinks a shard toward nothing as it dies", () => {
    const pool = new ShardPool(4, () => 0.5);
    pool.burst(0, 0, 0, { ...burst, count: 1 });
    const s = pool.shards.find((p) => p.life > 0)!;
    const fresh = pool.scaleOf(s);
    pool.update(0.9);
    expect(pool.scaleOf(s)).toBeLessThan(fresh);
    pool.update(0.2);
    expect(pool.scaleOf(s)).toBe(0);
  });

  it("when full, recycles the shards closest to dying rather than growing", () => {
    const pool = new ShardPool(4, () => 0.5);
    pool.burst(0, 0, 0, { ...burst, life: 0.5 });
    pool.update(0.2);
    const before = pool.shards.slice();
    pool.burst(9, 9, 9, { ...burst, count: 2, life: 5 });
    expect(pool.shards).toHaveLength(4);
    expect(pool.shards.every((s, i) => s === before[i])).toBe(true); // same objects, reused
    expect(pool.shards.filter((s) => s.x === 9 && s.life > 1)).toHaveLength(2);
  });

  it("pulls shards down under gravity", () => {
    const pool = new ShardPool(4, () => 0.5);
    pool.burst(0, 10, 0, { ...burst, count: 1, speed: 0, gravity: 9.81 });
    const s = pool.shards.find((p) => p.life > 0)!;
    pool.update(0.5);
    expect(s.y).toBeLessThan(10);
  });
});
