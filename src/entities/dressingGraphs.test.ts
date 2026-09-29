import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph, type BuiltGraph } from "./primitiveGraph";
import { dressingGraph } from "./envGraphs";
import { DRESSING_KINDS, DRESSING_PLACEMENTS, placedAt, type DressingKind } from "../sim/clubhouseLayout";
import { PILLAR_RADIUS_M } from "../render/pickups";
import { authoredCourse } from "../sim/authoredCourse";
import { AUTHORED_CLUBHOUSE } from "../sim/authoredLayout";
import { buildCourseWorld } from "../sim/courseWorld";
import { courseSiteGround, placePickupSites } from "../sim/pickupSites";

/** Stage 5a smoke check for `dressing.json` and its placements (`clubhouse-dressing.md`). */

const BUDGET: Record<DressingKind, number> = {
  bench: 120,
  flagpole: 80,
  planter: 100,
  bag_rack: 200,
  welcome_sign: 60,
};

function build(kind: DressingKind): BuiltGraph {
  const built = buildGraph(dressingGraph(kind));
  built.root.updateMatrixWorld(true);
  return built;
}

function triangles(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    count += (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3;
  });
  return count;
}

describe("clubhouse dressing", () => {
  it.each(DRESSING_KINDS)("%s builds within its triangle budget", (kind) => {
    const built = build(kind);
    expect(triangles(built.root)).toBeLessThanOrEqual(BUDGET[kind]);
    built.dispose();
  });

  it("seats the bench at 0.45 m", () => {
    // The top of the seat slats, not the bench's bounding box: the backrest is what is tallest.
    const built = build("bench");
    // Each slat's own geometry: `Box3.expandByObject` would take in the children too, and the root
    // slat parents the whole bench.
    const seat = new THREE.Box3();
    const slat = new THREE.Box3();
    let slats = 0;
    for (const [name, node] of built.named) {
      if (!name.startsWith("dr_bench_seat")) continue;
      const geometry = (node as THREE.Mesh).geometry;
      geometry.computeBoundingBox();
      seat.union(slat.copy(geometry.boundingBox!).applyMatrix4(node.matrixWorld));
      slats++;
    }
    expect(slats).toBe(3);
    expect(Math.abs(seat.max.y - 0.45)).toBeLessThanOrEqual(0.05);
    built.dispose();
  });

  it("stands the flagpole 8.0 m tall", () => {
    const built = build("flagpole");
    const box = new THREE.Box3().setFromObject(built.root);
    expect(Math.abs(box.max.y - 8.0)).toBeLessThanOrEqual(0.2);
    built.dispose();
  });

  it("keeps every piece 1.5 m clear of every depot pillar's edge", () => {
    // The pillars the shipped course actually stands, not the ring's nominal angles: a depot site on
    // undrivable ground is nudged round the ring, and a nudged pillar is the one that would land on
    // a planter.
    const world = buildCourseWorld(authoredCourse(2026), 2026);
    const pillars = placePickupSites(courseSiteGround(world), AUTHORED_CLUBHOUSE, 2026).filter((s) => s.depot);
    expect(pillars).toHaveLength(6);
    expect(DRESSING_PLACEMENTS).toHaveLength(7);
    for (const p of DRESSING_PLACEMENTS) {
      const at = placedAt(AUTHORED_CLUBHOUSE, p);
      for (const pillar of pillars) {
        const edge = Math.hypot(at.x - pillar.x, at.z - pillar.z) - PILLAR_RADIUS_M;
        expect(edge, `${p.kind} at (${p.dx}, ${p.dz})`).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});
