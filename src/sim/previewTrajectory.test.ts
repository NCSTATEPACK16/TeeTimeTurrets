import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "../input/InputSource";
import { fixedHoleSpec } from "./course";
import { BALL_RADIUS } from "./entities/ballShape";
import { POOL_SIZE } from "./entities/BallPool";
import { POOL_TRANSFORM_STRIDE, Sim, createPreviewBuffer } from "./world";

/**
 * `previewTrajectory` is the one place a read can corrupt play: if it advanced the ball or touched
 * the Rapier world, the shot would resolve twice. These tests hold it to its contract -- the sim is
 * byte-identical across a preview call -- and check that the arc it draws actually predicts where a
 * fired ball lands, because a preview that lies is worse than no preview.
 */

const TPS = 60;
const seconds = (n: number): number => Math.round(n * TPS);

function play(sim: Sim, script: readonly ScriptedStep[]): void {
  const src = new ScriptedInputSource(script);
  const total = script.reduce((a, b) => a + b.ticks, 0);
  for (let i = 0; i < total; i++) {
    sim.step(src.sample());
    src.endTick();
  }
}

describe("Sim.previewTrajectory", () => {
  it("leaves the sim byte-identical -- it advances nothing", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    for (let i = 0; i < seconds(0.5); i++) sim.step(neutralIntent());

    const before = {
      cart: { ...sim.cart.position },
      ball: { ...sim.current.position },
      strokes: sim.strokes,
      ammo: sim.cart.ammo,
      turretYaw: sim.cart.turretYaw,
    };

    const buf = createPreviewBuffer();
    for (let i = 0; i < 100; i++) sim.previewTrajectory(0.8, sim.cart.turretYaw, buf);

    // `sim.current.position` is the ball's synced transform from the last step; if a preview had
    // advanced the ball this would move.
    expect(sim.cart.position).toEqual(before.cart);
    expect(sim.current.position).toEqual(before.ball);
    expect(sim.strokes).toBe(before.strokes);
    expect(sim.cart.ammo).toBe(before.ammo);
    expect(sim.cart.turretYaw).toBe(before.turretYaw);
  });

  it("writes an arc that rises from the muzzle and descends to the ground", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    play(sim, [{ ticks: 2, intent: { selectClub: ClubType.Putter } }]);
    for (let i = 0; i < seconds(0.5); i++) sim.step(neutralIntent());

    const buf = createPreviewBuffer();
    const n = sim.previewTrajectory(1.0, sim.cart.turretYaw, buf);

    expect(n).toBeGreaterThan(2);
    // First point is the muzzle, well above ground; the last sits on the surface.
    const first = buf[0]!;
    const last = buf[n - 1]!;
    expect(first.y - sim.terrain.heightAt(first.x, first.z)).toBeGreaterThan(1);
    expect(last.y - sim.terrain.heightAt(last.x, last.z)).toBeLessThan(BALL_RADIUS + 0.05);
    // It went somewhere down-range.
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeGreaterThan(3);
  });

  it("predicts where a fired ball actually lands, within tolerance", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    // Equip the putter and let the cart settle so the muzzle and aim are stable.
    play(sim, [{ ticks: 2, intent: { selectClub: ClubType.Putter } }]);
    for (let i = 0; i < seconds(0.5); i++) sim.step(neutralIntent());

    const yaw = sim.cart.turretYaw;
    const from = { ...sim.cart.position };
    const buf = createPreviewBuffer();
    const n = sim.previewTrajectory(1.0, yaw, buf);
    const predicted = { x: buf[n - 1]!.x, z: buf[n - 1]!.z };

    // Fire the same shot: hold past the putter's 0.5 s charge so it saturates at full, then release.
    play(sim, [
      { ticks: seconds(1), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);

    // Track the fired pooled ball to its first ground contact -- what the preview predicts (carry,
    // not roll).
    let landing: { x: number; z: number } | null = null;
    for (let tick = 0; tick < seconds(6) && landing === null; tick++) {
      sim.step();
      for (let i = 0; i < POOL_SIZE; i++) {
        const flat = i * POOL_TRANSFORM_STRIDE;
        if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
        const x = sim.currentPoolTransforms[flat]!;
        const y = sim.currentPoolTransforms[flat + 1]!;
        const z = sim.currentPoolTransforms[flat + 2]!;
        const travelled = Math.hypot(x - from.x, z - from.z);
        if (travelled > 2 && y - sim.terrain.heightAt(x, z) < BALL_RADIUS * 1.4) {
          landing = { x, z };
        }
        break;
      }
    }

    expect(landing).not.toBeNull();
    const error = Math.hypot(predicted.x - landing!.x, predicted.z - landing!.z);
    expect(error, `preview ${JSON.stringify(predicted)} vs real ${JSON.stringify(landing)}`).toBeLessThan(2);
  });
});
