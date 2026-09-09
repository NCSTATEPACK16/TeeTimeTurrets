import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Flagstick } from "../entities/Flagstick";
import { fixedHoleSpec } from "../sim/course";
import type { HoleSpec } from "../sim/course";
import { createSurfaces } from "../sim/surfaces";
import { createTerrain } from "../sim/terrain";
import { derivePlacements } from "./props";
import { createBackdrop } from "./backdrop";

/**
 * The title screen is the **second consumer of every static prop factory**, and the one nobody
 * remembers. `createBackdrop` builds a live hole with no `Sim` behind it, and its own `dispose()`
 * warns that anything missed there "accumulates once per visit to the title screen" -- so a prop
 * wired only into `scene.ts` is invisible on the title screen, leaks nothing, breaks nothing, and
 * is caught by nothing. This file is the only thing in the repo that catches it.
 *
 * Buildable in the node environment because `createBackdrop` needs no renderer: it composes a
 * `THREE.Scene` from `createTerrain` and `createSurfaces`, both pure functions of a `HoleSpec`.
 */

function findByType<T extends THREE.Object3D>(
  root: THREE.Object3D,
  ctor: new (...args: never[]) => T,
): T[] {
  const found: T[] = [];
  root.traverse((child) => {
    if (child instanceof ctor) found.push(child);
  });
  return found;
}

describe("the title-screen backdrop", () => {
  it("puts the flagstick on the title screen too, not only in a round", () => {
    // Spec criterion 6. Written to fail against a flagstick wired into `scene.ts` alone, which is
    // exactly how it was first run.
    const backdrop = createBackdrop(fixedHoleSpec());
    expect(findByType(backdrop.scene, Flagstick)).toHaveLength(1);
    backdrop.dispose();
  });

  it("stands the backdrop's pin on its own hole's cup", () => {
    // The backdrop builds its own terrain from the spec, so this is the same agreement spec
    // criterion 1 asks for, checked on the path that has no `Sim` to read a cup position from.
    const spec = fixedHoleSpec();
    const cup = createTerrain(spec).cupPosition;
    const backdrop = createBackdrop(spec);
    const pin = findByType(backdrop.scene, Flagstick)[0]!;

    expect(pin.position.x).toBeCloseTo(cup.x, 2);
    expect(pin.position.y).toBeCloseTo(cup.y, 2);
    expect(pin.position.z).toBeCloseTo(cup.z, 2);
    backdrop.dispose();
  });

  it("puts the derived props on the title screen too", () => {
    // Spec criterion 6, for the second factory. `props.ts` is wired into `scene.ts` as well, and
    // nothing but this file would notice if only that one had been done.
    const spec = fixedHoleSpec();
    const terrain = createTerrain(spec);
    const expected = derivePlacements(terrain, createSurfaces(spec, terrain));
    expect(expected.length).toBeGreaterThan(0); // or the assertion below proves nothing

    const backdrop = createBackdrop(spec);
    const placed = new Set<string>();
    backdrop.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name !== "") placed.add(child.name);
    });
    for (const placement of expected) {
      expect(placed, placement.prop).toContain(placement.prop);
    }
    backdrop.dispose();
  });

  it("puts the causeway's decking on the title screen too, on a hole that has one", () => {
    // The test above uses `fixedHoleSpec()`, which has no water -- so it derives no crossing, and
    // criterion 6 was **not** actually covering the boardwalk. It is the one prop whose build path
    // differs (`mergeGraphInstances` rather than `mergeGraph`), which makes it the one most worth
    // covering here. Confirmed red by making `createProps` skip boardwalk placements.
    const spec: HoleSpec = {
      ...fixedHoleSpec(),
      water: [
        {
          points: [
            { x: -34, z: -40 },
            { x: -18, z: -40 },
            { x: -18, z: 40 },
            { x: -34, z: 40 },
          ],
        },
      ],
    };
    const terrain = createTerrain(spec);
    const expected = derivePlacements(terrain, createSurfaces(spec, terrain));
    expect(expected.some((p) => p.prop === "boardwalk_section")).toBe(true);

    const backdrop = createBackdrop(spec);
    const placed = new Set<string>();
    backdrop.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name !== "") placed.add(child.name);
    });
    expect(placed).toContain("boardwalk_section");
    backdrop.dispose();
  });

  it("frees every geometry and material it added when the title screen is left", () => {
    // The leak this file's docstring warns about, asserted rather than trusted: the smoke gate
    // counts geometries across twenty screen entries, and this is the unit-level version that
    // says which factory was responsible.
    const backdrop = createBackdrop(fixedHoleSpec());
    const resources: { dispose: () => void }[] = [];
    const disposed = new Set<unknown>();
    backdrop.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const resource of [mesh.geometry, ...materials]) resources.push(resource);
    });
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        disposed.add(resource);
        original();
      };
    }

    backdrop.dispose();
    const leaked = resources.filter((r) => !disposed.has(r));
    expect(leaked).toHaveLength(0);
  });
});
