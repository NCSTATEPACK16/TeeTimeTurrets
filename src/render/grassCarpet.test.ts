import { describe, expect, it } from "vitest";
import { SurfaceId } from "../sim/surfaceId";
import { createGrassCarpet } from "./grassCarpet";
import { CELL_M, RING_SIZE, TUFT_STRIDE, fillCell, ringCells, tuftsPerCell } from "./grassCells";
import type { TuftQuery } from "./grassCells";

/**
 * The tuft ring's bookkeeping, on flat open rough: filled a slice at a time over frames, it ends up
 * holding exactly what filling each ring cell in one go would, and follows the camera.
 */
const roughEverywhere: TuftQuery = {
  seed: 7,
  surface(_x, _z, out) {
    out.surface = SurfaceId.Rough;
    out.green = 1;
    out.corridor = 1;
    out.sand = 0;
    out.water = 0;
    out.woods = 0;
    return true;
  },
  finish(_x, _z, out) {
    out.y = 0;
    out.up = 1;
    out.biome[0] = 1;
    out.biome[1] = 0;
    out.biome[2] = 0;
  },
};

function expectedAround(x: number, z: number, density: number): number {
  const cells = new Int32Array(RING_SIZE * 2);
  const out = new Float32Array(tuftsPerCell(density) * TUFT_STRIDE);
  const n = ringCells(x, z, cells);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += fillCell(cells[i * 2]!, cells[i * 2 + 1]!, density, roughEverywhere, out);
  return sum;
}

/** Update until nothing changes for a few frames; returns frames taken. */
function settle(carpet: ReturnType<typeof createGrassCarpet>, x: number, z: number): number {
  let frames = 0;
  let still = 0;
  let last = -1;
  while (still < 3 && frames < 5000) {
    carpet.update(x, z);
    frames++;
    still = carpet.standing === last ? still + 1 : 0;
    last = carpet.standing;
  }
  return frames;
}

describe("grass carpet", () => {
  const density = 1.5;
  const cap = 22000;

  it("fills the whole ring over several frames, not in one", () => {
    const carpet = createGrassCarpet(roughEverywhere, density, cap);
    carpet.update(5, 5);
    const afterOne = carpet.standing;
    const frames = settle(carpet, 5, 5);
    expect(afterOne).toBeLessThan(expectedAround(5, 5, density));
    expect(frames).toBeGreaterThan(3);
    expect(carpet.standing).toBe(expectedAround(5, 5, density));
    expect(carpet.mesh.count).toBeLessThanOrEqual(cap);
    carpet.dispose();
  });

  it("follows the camera, keeping cells it still wants", () => {
    const carpet = createGrassCarpet(roughEverywhere, density, cap);
    settle(carpet, 5, 5);
    // Three cells east, then back: the ring is the new camera's, exactly.
    settle(carpet, 5 + 3 * CELL_M, 5);
    expect(carpet.standing).toBe(expectedAround(5 + 3 * CELL_M, 5, density));
    settle(carpet, 5, 5);
    expect(carpet.standing).toBe(expectedAround(5, 5, density));
    carpet.dispose();
  });

  it("moving mid-fill still ends with the right ring", () => {
    const carpet = createGrassCarpet(roughEverywhere, density, cap);
    for (let i = 0; i < 4; i++) carpet.update(5 + i * CELL_M, 5);
    settle(carpet, 5 + 3 * CELL_M, 5);
    expect(carpet.standing).toBe(expectedAround(5 + 3 * CELL_M, 5, density));
    carpet.dispose();
  });
});
