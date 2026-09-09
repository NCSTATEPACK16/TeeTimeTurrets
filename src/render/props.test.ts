import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PROP_NAMES } from "../entities/propGraphs";
import type { PropName } from "../entities/propGraphs";
import { fixedHoleSpec } from "../sim/course";
import type { HoleSpec } from "../sim/course";
import { createSpline } from "../sim/spline";
import { createSurfaceWeights, createSurfaces } from "../sim/surfaces";
import { createTerrain } from "../sim/terrain";
import { MAX_PROPS_PER_HOLE, MAX_RAKES, createProps, derivePlacements } from "./props";
import type { PropPlacement } from "./props";

/**
 * Placement is **derived from the hole, not seeded and not authored** (spec D8). That is the claim
 * this file exists to hold, and it is worth more than it looks: a seeded scatter would put bunker
 * rakes forty metres from any bunker, which is worse than no rake at all.
 *
 * Every assertion below ties a prop to the `HoleSpec` field it derives from, and each was confirmed
 * to fail when that field is moved. Nothing here touches `Sim`, Rapier or the seed.
 */

function build(overrides: Partial<HoleSpec> = {}) {
  const spec: HoleSpec = { ...fixedHoleSpec(), ...overrides };
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  return { spec, terrain, surfaces, placements: derivePlacements(terrain, surfaces) };
}

function surfacesOf(built: ReturnType<typeof build>) {
  return built.surfaces;
}

function of(placements: readonly PropPlacement[], prop: PropName): PropPlacement[] {
  return placements.filter((p) => p.prop === prop);
}

const BUNKER: HoleSpec["bunkers"] = [
  { x: 10, z: -6, radiusX: 6, radiusZ: 4, rotation: 0.3 },
  { x: 28, z: 9, radiusX: 5, radiusZ: 5, rotation: 0 },
];

/** A pond well off to one side of the corridor, which is where D6 puts the footbridge. */
const OFFSIDE_WATER: HoleSpec["water"] = [
  {
    points: [
      { x: -10, z: 42 },
      { x: 14, z: 42 },
      { x: 14, z: 62 },
      { x: -10, z: 62 },
    ],
  },
];

describe("derived placement", () => {
  it("flanks the tee with a marker on each side", () => {
    const { spec, placements } = build();
    const markers = of(placements, "tee_marker");
    expect(markers).toHaveLength(2);

    for (const marker of markers) {
      expect(Math.hypot(marker.x - spec.tee.x, marker.z - spec.tee.z)).toBeLessThan(4);
    }
    // Straddling, not stacked: the cross product of the two offsets against the hole's direction
    // must have opposite signs, or both markers are on the same side of the tee.
    const dx = spec.control[1]!.x - spec.tee.x;
    const dz = spec.control[1]!.z - spec.tee.z;
    const side = (p: PropPlacement): number => (p.x - spec.tee.x) * dz - (p.z - spec.tee.z) * dx;
    expect(Math.sign(side(markers[0]!))).toBe(-Math.sign(side(markers[1]!)));
  });

  it("stands the ball washer and the cart-path sign at the tee", () => {
    const { spec, placements } = build();
    for (const prop of ["ball_washer", "cart_path_sign"] as const) {
      const found = of(placements, prop);
      expect(found, prop).toHaveLength(1);
      expect(Math.hypot(found[0]!.x - spec.tee.x, found[0]!.z - spec.tee.z), prop).toBeLessThan(8);
    }
  });

  it("puts a rake at the rim of every bunker, within a metre of it", () => {
    const { placements } = build({ bunkers: BUNKER });
    const rakes = of(placements, "bunker_rake");
    expect(rakes).toHaveLength(BUNKER.length);

    for (const rake of rakes) {
      // Nearest bunker, by normalised radius: 1.0 is exactly on the rim.
      let best = Infinity;
      for (const bunker of BUNKER) {
        const cos = Math.cos(-bunker.rotation);
        const sin = Math.sin(-bunker.rotation);
        const ex = rake.x - bunker.x;
        const ez = rake.z - bunker.z;
        const lx = (ex * cos - ez * sin) / bunker.radiusX;
        const lz = (ex * sin + ez * cos) / bunker.radiusZ;
        // Metres from the rim along the ray through the rake, which is what "within a metre" means
        // on an ellipse -- normalised radius alone is unitless and means different things per axis.
        const normalised = Math.hypot(lx, lz);
        const scale = Math.hypot(ex, ez) / Math.max(normalised, 1e-6);
        best = Math.min(best, Math.abs(normalised - 1) * scale);
      }
      expect(best).toBeLessThan(1);
    }
  });

  it("places no rake on a hole with no bunkers", () => {
    // Ten of the eighteen briefs have no water and several no sand. The common case must be a
    // no-op rather than a rake at the origin.
    expect(of(build().placements, "bunker_rake")).toHaveLength(0);
  });

  it("sets distance posts by their yardage back from the cup along the centreline", () => {
    // The tie to `spec.control`: a post's own nearest point on the spline has to sit the marker's
    // distance back from the cup. Measured against the spline rather than against the tee-cup line,
    // because a dog-leg makes those two different numbers.
    const { spec, placements } = build();
    const posts = of(placements, "distance_post");
    expect(posts.length).toBeGreaterThan(0);

    const spline = createSpline(spec.control);
    for (const post of posts) {
      const nearest = spline.nearest(post.x, post.z);
      const back = spline.length * (1 - nearest.t);
      const closest = Math.min(...[137, 91, 46].map((d) => Math.abs(back - d)));
      expect(closest, `post at ${back.toFixed(1)} m back`).toBeLessThan(4);
    }
  });

  it("moves the posts when the centreline moves", () => {
    // The dog-leg apex is what makes this a real derivation rather than a distance down a straight
    // line: swing the apex and the arc length changes, so every post slides.
    const base = build();
    const swung = build({
      control: [base.spec.tee, { x: 0, z: 30 }, base.spec.cup],
    });
    const before = of(base.placements, "distance_post");
    const after = of(swung.placements, "distance_post");
    expect(after.length).toBeGreaterThan(0);
    const moved = after.some((p, i) => {
      const was = before[i];
      return was === undefined || Math.hypot(p.x - was.x, p.z - was.z) > 2;
    });
    expect(moved).toBe(true);
  });

  it("spans an off-corridor pond with the footbridge, and a dry hole with none", () => {
    // Spec D6: the arched footbridge is decoration over water nothing drives across. It is the one
    // prop that is allowed to be on water, and the one that must never be on the driving line.
    expect(of(build().placements, "footbridge")).toHaveLength(0);

    const { spec, placements } = build({ water: OFFSIDE_WATER });
    const bridges = of(placements, "footbridge");
    expect(bridges).toHaveLength(1);

    const spline = createSpline(spec.control);
    const nearest = spline.nearest(bridges[0]!.x, bridges[0]!.z);
    expect(nearest.distance).toBeGreaterThan(Math.max(...spec.corridor));
  });

  it("leaves a pond straddling the corridor unbridged rather than putting a bridge on the line", () => {
    const onLine: HoleSpec["water"] = [
      {
        points: [
          { x: -6, z: -12 },
          { x: 10, z: -12 },
          { x: 10, z: 4 },
          { x: -6, z: 4 },
        ],
      },
    ];
    expect(of(build({ water: onLine }).placements, "footbridge")).toHaveLength(0);
  });

  it("stands every prop on the ground, and none in a hazard except the bridge", () => {
    const { terrain, surfaces, placements } = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    const weights = createSurfaceWeights();
    for (const placement of placements) {
      expect(placement.y, placement.prop).toBeCloseTo(terrain.heightAt(placement.x, placement.z), 6);
      if (placement.prop === "footbridge") continue;
      surfaces.weightsAt(placement.x, placement.z, weights);
      expect(weights.sand, `${placement.prop} in sand`).toBe(0);
      expect(weights.water, `${placement.prop} in water`).toBe(0);
    }
  });

  it("derives from the hole's shape and never from its seed", () => {
    // Spec D8's falsifiable half. Trees draw from seed channel 3 and move with the seed; props take
    // no RNG at all, so changing only the seed must leave every *position on the plan* identical.
    // A seeded scatter would put a bunker rake forty metres from any bunker.
    //
    // `y` is exempt and must not be: it is `terrain.heightAt`, and terrain height is seeded from
    // channel 0. So the second half of this test asserts the ground really did move underneath --
    // otherwise "the placements are identical" would be true for the boring reason that nothing
    // changed at all.
    const base = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    const reseeded = build({
      bunkers: BUNKER,
      water: OFFSIDE_WATER,
      seed: fixedHoleSpec().seed ^ 0x9e3779b9,
    });

    const plan = (ps: readonly PropPlacement[]) =>
      ps.map(({ prop, x, z, yaw }) => ({ prop, x, z, yaw }));
    expect(plan(reseeded.placements)).toEqual(plan(base.placements));
    expect(reseeded.placements.some((p, i) => p.y !== base.placements[i]!.y)).toBe(true);
  });

  it("stays under the per-hole draw-call budget", () => {
    // Spec criterion 11, asserted by counting rather than by eye. §2.3 predicts ~12 merged.
    const { placements } = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    expect(placements.length).toBeLessThan(MAX_PROPS_PER_HOLE);
  });

  it("caps the rakes on a hole covered in bunkers", () => {
    // The cap is asserted on the rakes themselves, not on the total. Twelve bunkers plus the tee
    // furniture still fits under MAX_PROPS_PER_HOLE, so a total-only check passes with the cap
    // deleted -- verified, not assumed.
    const many = Array.from({ length: 12 }, (_, i) => ({
      x: -30 + i * 6,
      z: 18,
      radiusX: 3,
      radiusZ: 3,
      rotation: 0,
    }));
    const { placements } = build({ bunkers: many });
    expect(of(placements, "bunker_rake")).toHaveLength(MAX_RAKES);
    expect(placements.length).toBeLessThan(MAX_PROPS_PER_HOLE);
  });

  it("drops a prop rather than standing it in a hazard", () => {
    // `Trees.ts:132-146`'s rule, applied to props: a bunker swallowing the tee must leave the tee
    // furniture out, not sitting in the sand. Nothing here would fail if the rejection were deleted
    // unless a prop actually lands in a hazard, which is why the fixture puts one there.
    const overTee = build({
      bunkers: [{ x: -45, z: 0, radiusX: 9, radiusZ: 9, rotation: 0 }],
    });
    const weights = createSurfaceWeights();
    for (const placement of overTee.placements) {
      surfacesOf(overTee).weightsAt(placement.x, placement.z, weights);
      expect(weights.sand, placement.prop).toBe(0);
    }
    // And the props that would have been there are genuinely gone, so this is a rejection rather
    // than a bunker that happened to miss everything.
    expect(of(overTee.placements, "tee_marker").length).toBeLessThan(
      of(build().placements, "tee_marker").length,
    );
  });
});

describe("createProps", () => {
  it("draws one object per placement, one draw call each", () => {
    const { terrain, surfaces, placements } = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    const props = createProps(terrain, surfaces);
    expect(props.objects).toHaveLength(placements.length);

    for (const object of props.objects) {
      let meshes = 0;
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes++;
      });
      expect(meshes).toBe(1);
    }
    props.dispose();
  });

  it("puts each object where its placement says, at the terrain height", () => {
    const { terrain, surfaces, placements } = build({ bunkers: BUNKER });
    const props = createProps(terrain, surfaces);
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i]!;
      const object = props.objects[i]!;
      expect(object.position.x).toBeCloseTo(placement.x, 6);
      expect(object.position.y).toBeCloseTo(terrain.heightAt(placement.x, placement.z), 6);
      expect(object.position.z).toBeCloseTo(placement.z, 6);
    }
    props.dispose();
  });

  it("frees every geometry and material it built", () => {
    const { terrain, surfaces } = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    const props = createProps(terrain, surfaces);
    const resources: { dispose: () => void }[] = [];
    const disposed = new Set<unknown>();
    for (const object of props.objects) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        resources.push(mesh.geometry, mesh.material as THREE.Material);
      });
    }
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        disposed.add(resource);
        original();
      };
    }

    props.dispose();
    expect(resources.filter((r) => !disposed.has(r))).toHaveLength(0);
  });

  it("can draw every prop the set carries", () => {
    // A prop authored in Blender but never placed is a prop nobody will notice is broken.
    const { placements } = build({ bunkers: BUNKER, water: OFFSIDE_WATER });
    const used = new Set(placements.map((p) => p.prop));
    expect([...used].sort()).toEqual([...PROP_NAMES].sort());
  });
});
