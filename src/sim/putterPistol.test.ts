import { describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "./intent";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import type { PooledBall } from "./entities/BallPool";
import { POOL_SIZE } from "./entities/BallPool";
import { POOL_TRANSFORM_STRIDE, FIXED_DT, PREVIEW_SAMPLE_STRIDE, Sim, createPreviewBuffer } from "./world";

/**
 * The putter is the arena's pistol: fast, flat and accurate at close range. "Flat" is measured
 * against the hull -- a shot that has dropped below the ground, or climbed over a cart, by 40 m
 * cannot hit anything there.
 */

const TPS = 60;
const seconds = (n: number): number => Math.round(n * TPS);
const RANGE = 40;
const MAX_TIME_S = 1.3;
const HULL_HEIGHT = 2.8;

function run(sim: Sim, script: ScriptedStep[]): void {
  const src = new ScriptedInputSource(script);
  const total = script.reduce((a, b) => a + b.ticks, 0);
  for (let i = 0; i < total; i++) {
    sim.step(src.sample());
    src.endTick();
  }
}

async function settledSim(): Promise<Sim> {
  const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0 });
  for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());
  return sim;
}

describe("the putter pistol", () => {
  it("a real full-charge putter ball reaches 40 m inside 1.3 s, still at hull height", async () => {
    const sim = await settledSim();
    run(sim, [
      { ticks: 2, intent: { selectClub: ClubType.Putter } },
      { ticks: seconds(0.5), intent: { fire: true } },
      { ticks: 1, intent: {} },
    ]);
    const from = { ...sim.cart.position };

    let reached: { t: number; h: number } | null = null;
    for (let tick = 1; tick <= seconds(3) && reached === null; tick++) {
      sim.step();
      for (let i = 0; i < POOL_SIZE; i++) {
        const flat = i * POOL_TRANSFORM_STRIDE;
        if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
        const x = sim.currentPoolTransforms[flat]!;
        const y = sim.currentPoolTransforms[flat + 1]!;
        const z = sim.currentPoolTransforms[flat + 2]!;
        if (Math.hypot(x - from.x, z - from.z) >= RANGE) reached = { t: tick * FIXED_DT, h: y - sim.heightAt(x, z) };
      }
    }

    expect(reached, "the ball never got 40 m out").not.toBeNull();
    expect(reached!.t).toBeLessThan(MAX_TIME_S);
    expect(reached!.h).toBeGreaterThan(0.2);
    expect(reached!.h).toBeLessThan(HULL_HEIGHT);
  });

  it("the aim preview agrees: 40 m inside 1.3 s, still at hull height", async () => {
    const sim = await settledSim();
    run(sim, [{ ticks: 2, intent: { selectClub: ClubType.Putter } }]);
    const out = createPreviewBuffer();
    const n = sim.previewTrajectory(1, sim.cart.turretYaw, out);
    const from = sim.cart.position;

    // Point 0 is the muzzle; point k is k strides of flight after it.
    let hit = -1;
    for (let k = 0; k < n; k++) {
      if (Math.hypot(out[k]!.x - from.x, out[k]!.z - from.z) >= RANGE) {
        hit = k;
        break;
      }
    }
    expect(hit, "the preview never got 40 m out").toBeGreaterThan(0);
    expect(hit * PREVIEW_SAMPLE_STRIDE * FIXED_DT).toBeLessThan(MAX_TIME_S);
    const p = out[hit]!;
    const h = p.y - sim.heightAt(p.x, p.z);
    expect(h).toBeGreaterThan(0.2);
    expect(h).toBeLessThan(HULL_HEIGHT);
  });

  it("a fired ball carries its club's damage", async () => {
    const sim = await settledSim();
    run(sim, [
      { ticks: 2, intent: { selectClub: ClubType.Driver } },
      { ticks: seconds(2), intent: { fire: true } },
      { ticks: 1, intent: {} },
    ]);
    const balls = (sim as unknown as { ballPool: { all: readonly PooledBall[] } }).ballPool.all;
    const flying = balls.filter((b) => b.state === "flying");
    expect(flying).toHaveLength(1);
    expect(flying[0]!.damage).toBe(CLUB_STATS[ClubType.Driver].damage);
    expect(CLUB_STATS[ClubType.Driver].damage).toBe(2);
  });
});
