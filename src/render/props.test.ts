import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../entities/primitiveGraph";
import { PROP_NAMES, graphFor } from "../entities/propGraphs";
import type { PropName } from "../entities/propGraphs";
import { fixedHoleSpec, generateCourse } from "../sim/course";
import type { HoleSpec } from "../sim/course";
import { createSpline } from "../sim/spline";
import { createSurfaceWeights, createSurfaces } from "../sim/surfaces";
import { createTerrain } from "../sim/terrain";
import { DECK_HALF_WIDTH, deriveCrossings } from "../sim/crossing";
import {
  BOARDWALK_SECTION_M,
  MAX_PROPS_PER_HOLE,
  MAX_RAKES,
  boardwalkSections,
  createProps,
  derivePlacements,
} from "./props";
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

/**
 * A pond straight across the corridor: the forced carry D5 builds a causeway over.
 *
 * Set out towards the tee rather than at mid-hole, which is not cosmetic. Mid-hole it swallows the
 * 46 m distance post, `put` correctly drops the post for standing in water, and the "can draw every
 * prop" fixture then fails for a reason that has nothing to do with the boardwalk.
 */
const CROSSED_WATER: HoleSpec["water"] = [
  {
    points: [
      { x: -34, z: -40 },
      { x: -18, z: -40 },
      { x: -18, z: 40 },
      { x: -34, z: 40 },
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
    //
    // The fixture needs **two** ponds and they are not interchangeable: an off-corridor one, which
    // is the only kind D6 will footbridge, and one straddling the line, which is the only kind D5
    // will causeway. A single pond cannot be both, and with only the first this test went green
    // while the boardwalk was placed nowhere at all.
    const { placements } = build({ bunkers: BUNKER, water: [...OFFSIDE_WATER, ...CROSSED_WATER] });
    const used = new Set(placements.map((p) => p.prop));
    expect([...used].sort()).toEqual([...PROP_NAMES].sort());
  });
});

/**
 * The causeway's decking (spec D5, Phase C's render half).
 *
 * The sim raises the deck and classifies it `SurfaceId.Bridge`; without this it is turf-coloured
 * ground standing over a pond, which reads as a bug rather than as a crossing. The boardwalk is the
 * one prop in the set with **length**: a crossing spans whatever its pond is wide, so one 2 m
 * section is tiled along it and `mergeGraphInstances` collapses the run to a single draw call.
 *
 * Every assertion here ties the decking to `deriveCrossings` — the same function the sim's surface
 * and height field read — rather than to a remembered position. A boardwalk that agreed with a
 * constant instead of with the crossing would be a plank deck beside the drivable one.
 */
describe("the boardwalk", () => {
  const crossings = (spec: HoleSpec) => deriveCrossings(spec);

  function deckOf(built: ReturnType<typeof build>) {
    const crossing = crossings(built.spec)[0]!;
    const dx = crossing.bx - crossing.ax;
    const dz = crossing.bz - crossing.az;
    return { crossing, dx, dz, length: Math.hypot(dx, dz) };
  }

  it("is authored at exactly the length the tiling assumes", () => {
    // The drift this stops is silent and total: `BOARDWALK_SECTION_M` decides where section n goes
    // and the .blend decides how long section n is. Re-author the deck at 2.5 m and every crossing
    // in the game gets 0.5 m gaps between its planks, with nothing else failing. Measured on the
    // shipped graph's own geometry, which is the only copy that can disagree.
    const built = buildGraph(graphFor("boardwalk_section"));
    const box = new THREE.Box3().setFromObject(built.root);
    expect(box.max.z - box.min.z).toBeCloseTo(BOARDWALK_SECTION_M, 3);
    // And the deck is as wide as the causeway the sim raised, or the planks are narrower than the
    // ground they sit on and the crossing has turf shoulders down its middle.
    expect(box.max.x - box.min.x).toBeCloseTo(2 * DECK_HALF_WIDTH, 3);
    built.dispose();
  });

  it("lays decking along every crossing, and none on a hole with no water", () => {
    const crossed = build({ water: CROSSED_WATER });
    expect(of(crossed.placements, "boardwalk_section")).toHaveLength(crossings(crossed.spec).length);
    expect(crossings(crossed.spec).length).toBeGreaterThan(0);

    expect(of(build().placements, "boardwalk_section")).toHaveLength(0);
  });

  it("lays none along a pond the centreline misses, where there is no crossing to deck", () => {
    // The other half of "derived from the crossing": an off-corridor pond gets D6's footbridge and
    // no causeway, because the sim raised no deck there for planks to sit on.
    const offside = build({ water: OFFSIDE_WATER });
    expect(crossings(offside.spec)).toHaveLength(0);
    expect(of(offside.placements, "boardwalk_section")).toHaveLength(0);
  });

  it("carries enough sections to cover the deck end to end", () => {
    const built = build({ water: CROSSED_WATER });
    const { length } = deckOf(built);
    const placement = of(built.placements, "boardwalk_section")[0]!;

    expect(placement.sections).toBeGreaterThan(1);
    // Within one section of the real deck length: shorter leaves bare ground at the abutments,
    // longer runs planks out over the bank.
    expect(placement.sections! * BOARDWALK_SECTION_M).toBeGreaterThanOrEqual(length - BOARDWALK_SECTION_M);
    expect(placement.sections! * BOARDWALK_SECTION_M).toBeLessThanOrEqual(length + BOARDWALK_SECTION_M);
  });

  it("centres the run on the crossing and turns it along the crossing, not across it", () => {
    // The yaw formula here is `atan2(dx, dz)` and every other prop's is `atan2(dz, dx)`, because
    // the section's length runs along its own local +Z where a marker's facing runs along +X.
    // Swapped, the decking is a row of 6 m planks laid broadside down the causeway -- so this is
    // asserted against the crossing's own direction rather than restated as a constant.
    const built = build({ water: CROSSED_WATER });
    const { crossing, dx, dz, length } = deckOf(built);
    const placement = of(built.placements, "boardwalk_section")[0]!;

    expect(placement.x).toBeCloseTo((crossing.ax + crossing.bx) / 2, 6);
    expect(placement.z).toBeCloseTo((crossing.az + crossing.bz) / 2, 6);
    expect(Math.sin(placement.yaw)).toBeCloseTo(dx / length, 6);
    expect(Math.cos(placement.yaw)).toBeCloseTo(dz / length, 6);
  });

  it("sits every section on the deck line, at the terrain height under it", () => {
    const built = build({ water: CROSSED_WATER });
    const { crossing, dx, dz, length } = deckOf(built);
    const placement = of(built.placements, "boardwalk_section")[0]!;
    const sections = boardwalkSections(built.terrain, placement);

    expect(sections).toHaveLength(placement.sections!);
    for (const section of sections) {
      // Perpendicular distance from the deck's own line: planks are laid on the deck, not beside it.
      const offset = Math.abs((section.x - crossing.ax) * dz - (section.z - crossing.az) * dx) / length;
      expect(offset).toBeLessThan(0.01);
      expect(section.y).toBeCloseTo(built.terrain.heightAt(section.x, section.z), 6);
    }
  });

  it("follows the bank at the abutments instead of running level off the end", () => {
    // The reason each section carries its own matrix rather than a shared stride. The deck runs on
    // to dry land at both ends (`DECK_ABUTMENT_M`), and `terrain.ts` keeps the higher of bank and
    // deck, so a level run would bury its last sections in the bank or float them over it.
    //
    // Asserted as a *spread*, because "every section is at terrain height" is also true of a deck
    // that is level because the ground under it happens to be.
    const built = build({ water: CROSSED_WATER });
    const placement = of(built.placements, "boardwalk_section")[0]!;
    const heights = boardwalkSections(built.terrain, placement).map((s) => s.y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.1);
  });

  it("draws the whole causeway as one object and one draw call", () => {
    // D7's arithmetic is why this is not one merged prop per section: a thirty-metre crossing would
    // otherwise be fifteen draws, most of MAX_PROPS_PER_HOLE spent on a single object.
    const built = build({ water: CROSSED_WATER });
    const props = createProps(built.terrain, built.surfaces);
    const index = built.placements.findIndex((p) => p.prop === "boardwalk_section");
    expect(index).toBeGreaterThanOrEqual(0);

    const object = props.objects[index]!;
    let meshes = 0;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBe(1);
    props.dispose();
  });

  it("puts the built planks over the real deck, in world space", () => {
    // The end-to-end check, and the only one that would catch a sign error in the local-space
    // matrices `createProps` builds: the geometry that actually reaches the scene is measured
    // against the crossing, after the mesh's own position and rotation have been applied.
    const built = build({ water: CROSSED_WATER });
    const { crossing, dx, dz, length } = deckOf(built);
    const props = createProps(built.terrain, built.surfaces);
    const index = built.placements.findIndex((p) => p.prop === "boardwalk_section");
    const mesh = props.objects[index]!;
    mesh.updateMatrixWorld(true);

    const geometry = (mesh as THREE.Mesh).geometry;
    const position = geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    let along = { min: Infinity, max: -Infinity };
    let widest = 0;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const t = ((vertex.x - crossing.ax) * dx + (vertex.z - crossing.az) * dz) / length;
      along = { min: Math.min(along.min, t), max: Math.max(along.max, t) };
      widest = Math.max(widest, Math.abs((vertex.x - crossing.ax) * dz - (vertex.z - crossing.az) * dx) / length);
    }

    // Spans the crossing from one abutment to the other, within a section.
    expect(along.min).toBeLessThan(BOARDWALK_SECTION_M);
    expect(along.max).toBeGreaterThan(length - BOARDWALK_SECTION_M);
    // And is deck-width across it, not 6 m of plank laid broadside down the line.
    expect(widest).toBeCloseTo(DECK_HALF_WIDTH, 1);
    props.dispose();
  });

  it("keeps a causeway hole inside the per-hole draw-call budget", () => {
    const { placements } = build({ bunkers: BUNKER, water: [...OFFSIDE_WATER, ...CROSSED_WATER] });
    expect(placements.length).toBeLessThan(MAX_PROPS_PER_HOLE);
  });
});

describe("the real eighteen", () => {
  it("keeps every generated hole inside the draw-call budget, crossings and all", () => {
    // Criterion 11 against the course that ships rather than against a fixture. The fixtures above
    // are hand-built to exercise one prop each; this is the only check that sees a hole with two
    // crossings and a full set of bunkers at the same time.
    const { holes } = generateCourse(0x7ee7c0, 18);
    let withCrossings = 0;
    for (let i = 0; i < holes.length; i++) {
      const spec = holes[i]!;
      const terrain = createTerrain(spec);
      const placements = derivePlacements(terrain, createSurfaces(spec, terrain));
      expect(placements.length, `hole ${i + 1}`).toBeLessThan(MAX_PROPS_PER_HOLE);
      if (placements.some((p) => p.prop === "boardwalk_section")) withCrossings++;
    }
    // Or the loop above proves nothing about crossings: it would pass on eighteen dry holes.
    expect(withCrossings).toBeGreaterThan(0);
  });
});
