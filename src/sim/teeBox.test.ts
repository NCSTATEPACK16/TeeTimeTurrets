import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaceWeights, createSurfaces } from "./surfaces";
import { createTerrain } from "./terrain";
import { TEE_BOX_BEVEL_M, TEE_BOX_HALF_LENGTH_M, TEE_BOX_HALF_WIDTH_M, teeBoxOf } from "./teeBox";

/** Raised tee boxes (Stage 5 spec, §2). */
describe("the tee box", () => {
  const spec = fixedHoleSpec();
  const built = createTerrain(spec);
  // The same hole with no built structures: the ground `validateHole` sees.
  const bare = createTerrain(spec, { crossings: false });
  const surfaces = createSurfaces(spec, built);
  const box = teeBoxOf(spec);
  // A point in the box's corner, and one a little past its bevel, behind the tee.
  const corner = {
    x: box.x + box.ax * (TEE_BOX_HALF_LENGTH_M - 0.5) - box.az * (TEE_BOX_HALF_WIDTH_M - 0.5),
    z: box.z + box.az * (TEE_BOX_HALF_LENGTH_M - 0.5) + box.ax * (TEE_BOX_HALF_WIDTH_M - 0.5),
  };
  const past = TEE_BOX_HALF_LENGTH_M + TEE_BOX_BEVEL_M + 1;
  const beyond = { x: box.x - box.ax * past, z: box.z - box.az * past };

  it("stands 0.25 m above the pad, and leaves the ground past its bevel alone", () => {
    expect(built.heightAt(box.x, box.z) - bare.heightAt(box.x, box.z)).toBeCloseTo(0.25, 6);
    expect(built.heightAt(corner.x, corner.z) - bare.heightAt(corner.x, corner.z)).toBeCloseTo(0.25, 6);
    expect(built.heightAt(beyond.x, beyond.z)).toBe(bare.heightAt(beyond.x, beyond.z));
  });

  it("is its own surface, with the table's tuning, drawn as mown turf", () => {
    expect(surfaces.surfaceAt(corner.x, corner.z)).toBe(SurfaceId.Tee);
    expect(surfaces.surfaceAt(beyond.x, beyond.z)).not.toBe(SurfaceId.Tee);
    const tuning = createSurfaceTuning();
    surfaces.tuningAt(box.x, box.z, tuning);
    expect(tuning.rolling).toBe(SURFACES[SurfaceId.Tee].rolling);
    const weights = createSurfaceWeights();
    surfaces.weightsAt(box.x, box.z, weights);
    expect(weights.green).toBe(0);
  });
});
