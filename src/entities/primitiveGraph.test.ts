import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph, mergeGraph, mergeGraphBySlot, mergeGraphInstances } from "./primitiveGraph";
import type { BuiltGraph, PrimitiveGraph, PrimitiveNode } from "./primitiveGraph";

/**
 * The assembler is the one piece of the ASSET_PIPELINE.md section 4 pipeline that runs in the
 * game, so every defect it can have is a defect the player sees. The three that matter and are
 * invisible without a test: a dropped child (the cart loses its wheels and still renders), a
 * transform applied in the wrong space (subtly mirrored, per section 4.3's warning), and a slot
 * material built per-node instead of shared (a paint swap then updates one mesh out of nine).
 *
 * Runs in vitest's node environment: BufferGeometry needs no WebGL context. Nothing here touches
 * a renderer.
 */

function node(overrides: Partial<PrimitiveNode> = {}): PrimitiveNode {
  return {
    name: "part",
    kind: "box",
    params: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    slot: "chassis",
    ...overrides,
  };
}

function graph(root: PrimitiveNode, slots: PrimitiveGraph["slots"] = SLOTS): PrimitiveGraph {
  return { name: "test", version: 1, units: "m", slots, root };
}

const SLOTS: PrimitiveGraph["slots"] = {
  chassis: { color: 0xf0ece0, roughness: 0.6, metalness: 0.1 },
  tires: { color: 0x1a1a1a, roughness: 0.9, metalness: 0 },
};

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) out.push(child);
  });
  return out;
}

describe("tree assembly", () => {
  it("builds one mesh per node, including nested descendants", () => {
    const built = buildGraph(
      graph(
        node({
          name: "body",
          children: [
            node({ name: "wheel_fl", slot: "tires" }),
            node({ name: "wheel_fr", slot: "tires" }),
            node({ name: "roof", children: [node({ name: "post" })] }),
          ],
        }),
      ),
    );

    // 1 root + 2 wheels + 1 roof + 1 post. A depth-limited walk passes at 4 and fails here.
    expect(meshes(built.root)).toHaveLength(5);
  });

  it("parents children to their own node, not to the root", () => {
    const built = buildGraph(
      graph(node({ name: "body", children: [node({ name: "roof", children: [node({ name: "post" })] })] })),
    );

    const post = built.named.get("post");
    expect(post?.parent?.name).toBe("roof");
  });

  it("exposes every node by name so callers can find pivots without walking the tree", () => {
    const built = buildGraph(
      graph(node({ name: "body", children: [node({ name: "turret_pivot" }), node({ name: "wheel_fl" })] })),
    );

    expect([...built.named.keys()].sort()).toEqual(["body", "turret_pivot", "wheel_fl"]);
  });
});

describe("transforms", () => {
  it("applies position, rotation and scale from the node", () => {
    const built = buildGraph(
      graph(node({ name: "body", position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 3, 4] })),
    );
    const body = built.named.get("body")!;

    expect(body.position.toArray()).toEqual([1, 2, 3]);
    expect(body.rotation.z).toBeCloseTo(0.3, 6);
    expect(body.scale.toArray()).toEqual([2, 3, 4]);
  });

  it("composes a child's transform through its parent rather than against the root", () => {
    const built = buildGraph(
      graph(
        node({
          name: "body",
          position: [0, 2, 0],
          children: [node({ name: "post", position: [0, 1, 0] })],
        }),
      ),
    );

    built.root.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    built.named.get("post")!.getWorldPosition(world);

    // 2 + 1. A child placed on the root instead of its parent lands at y=1 and looks plausible.
    expect(world.y).toBeCloseTo(3, 6);
  });
});

describe("geometry kinds", () => {
  it("passes params straight to the matching THREE constructor, in section 4.2's order", () => {
    const built = buildGraph(
      graph(
        node({
          name: "root",
          kind: "cylinder",
          params: [0.3, 0.4, 1.2, 16],
          children: [
            node({ name: "s", kind: "sphere", params: [0.5, 16, 12] }),
            node({ name: "c", kind: "cone", params: [0.25, 0.8, 12] }),
            node({ name: "t", kind: "torus", params: [0.4, 0.08, 8, 20] }),
            node({ name: "p", kind: "capsule", params: [0.2, 0.6, 4, 12] }),
          ],
        }),
      ),
    );

    const cylinder = built.named.get("root") as THREE.Mesh;
    const params = (cylinder.geometry as THREE.CylinderGeometry).parameters;
    expect(params.radiusTop).toBe(0.3);
    expect(params.radiusBottom).toBe(0.4);
    expect(params.height).toBe(1.2);
    expect(params.radialSegments).toBe(16);

    const sphere = built.named.get("s") as THREE.Mesh;
    expect((sphere.geometry as THREE.SphereGeometry).parameters.radius).toBe(0.5);
  });

  it("rejects an unknown kind rather than silently rendering nothing", () => {
    const bad = node({ kind: "wedge" as PrimitiveNode["kind"] });
    expect(() => buildGraph(graph(bad))).toThrow(/wedge/);
  });

  it("rejects a node whose slot is not declared on the graph", () => {
    const orphan = node({ name: "body", slot: "no_such_slot" });
    expect(() => buildGraph(graph(orphan))).toThrow(/no_such_slot/);
  });
});

describe("material slots", () => {
  it("shares one material across every node in a slot, so a paint swap is a single write", () => {
    const built = buildGraph(
      graph(
        node({
          name: "body",
          children: [node({ name: "wheel_fl", slot: "tires" }), node({ name: "wheel_fr", slot: "tires" })],
        }),
      ),
    );

    const fl = built.named.get("wheel_fl") as THREE.Mesh;
    const fr = built.named.get("wheel_fr") as THREE.Mesh;
    const body = built.named.get("body") as THREE.Mesh;

    expect(fl.material).toBe(fr.material);
    expect(body.material).not.toBe(fl.material);
  });

  it("takes colour, roughness and metalness from the slot declaration", () => {
    const built = buildGraph(graph(node({ name: "body", slot: "tires" })));
    const material = (built.named.get("body") as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(0x1a1a1a);
    expect(material.roughness).toBe(0.9);
    expect(material.metalness).toBe(0);
  });

  it("applies slot overrides at build time -- the loadout's whole mechanism", () => {
    const built = buildGraph(graph(node({ name: "body", slot: "chassis" })), { chassis: 0xc4382f });
    const material = (built.named.get("body") as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(material.color.getHex()).toBe(0xc4382f);
  });

  it("setSlotColor repaints every node in that slot at once and leaves others alone", () => {
    const built = buildGraph(
      graph(
        node({
          name: "body",
          children: [node({ name: "wheel_fl", slot: "tires" }), node({ name: "wheel_fr", slot: "tires" })],
        }),
      ),
    );

    built.setSlotColor("tires", 0x336699);

    const fl = (built.named.get("wheel_fl") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const fr = (built.named.get("wheel_fr") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const body = (built.named.get("body") as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(fl.color.getHex()).toBe(0x336699);
    expect(fr.color.getHex()).toBe(0x336699);
    expect(body.color.getHex()).toBe(0xf0ece0);
  });

  it("ignores a repaint of a slot the graph does not declare", () => {
    const built = buildGraph(graph(node({ name: "body" })));
    expect(() => built.setSlotColor("no_such_slot", 0x000000)).not.toThrow();
  });
});

describe("disposal", () => {
  it("disposes every geometry and every slot material exactly once", () => {
    const built = buildGraph(
      graph(
        node({
          name: "body",
          children: [node({ name: "wheel_fl", slot: "tires" }), node({ name: "wheel_fr", slot: "tires" })],
        }),
      ),
    );

    const geometries = meshes(built.root).map((m) => m.geometry);
    const materials = [...new Set(meshes(built.root).map((m) => m.material as THREE.Material))];

    let geometryDisposals = 0;
    let materialDisposals = 0;
    for (const g of geometries) g.addEventListener("dispose", () => geometryDisposals++);
    for (const m of materials) m.addEventListener("dispose", () => materialDisposals++);

    built.dispose();

    expect(geometryDisposals).toBe(3);
    // Two slots in use, shared across three meshes: disposing per-mesh would report 3.
    expect(materialDisposals).toBe(2);
  });
});

/**
 * `mergeGraph` is the draw-call half of `ASSET_PIPELINE.md` §9, which is explicit that draw calls
 * and material count matter far more than triangle count. A cart is 78 `Object3D`s and a round
 * draws five of them; seven graph-authored props at ~5 nodes each, a dozen instances to a hole,
 * would be another ~60 draws. Merged it is ~12.
 *
 * The colour assertions are the ones that will actually catch a bug. Triangle counts and object
 * counts are easy to get right by accident; per-node slot colours surviving a merge into one
 * `color` attribute is the part that silently comes out uniformly grey.
 */
describe("mergeGraph", () => {
  const multiSlot = (): PrimitiveGraph =>
    graph(
      node({
        name: "body",
        children: [
          node({ name: "wheel_fl", slot: "tires", position: [1, 0, 1] }),
          node({ name: "wheel_fr", slot: "tires", position: [-1, 0, 1] }),
          node({ name: "roof", kind: "cylinder", params: [0.5, 0.5, 1, 8], position: [0, 2, 0] }),
        ],
      }),
    );

  it("draws the whole graph as one object where buildGraph gives many", () => {
    const built = buildGraph(multiSlot());
    const merged = mergeGraph(multiSlot());

    expect(meshes(built.root).length).toBe(4);
    expect(meshes(merged.mesh).length).toBe(1);
    expect(merged.mesh).toBeInstanceOf(THREE.Mesh);
    built.dispose();
    merged.dispose();
  });

  it("keeps every triangle buildGraph would have drawn", () => {
    const built = buildGraph(multiSlot());
    const merged = mergeGraph(multiSlot());

    let triangles = 0;
    for (const mesh of meshes(built.root)) {
      const index = mesh.geometry.getIndex();
      const position = mesh.geometry.getAttribute("position");
      triangles += (index ? index.count : position.count) / 3;
    }
    const mergedIndex = merged.mesh.geometry.getIndex();
    const mergedPosition = merged.mesh.geometry.getAttribute("position");
    expect((mergedIndex ? mergedIndex.count : mergedPosition.count) / 3).toBe(triangles);

    built.dispose();
    merged.dispose();
  });

  it("bakes each node's slot colour into the vertices, not a uniform average", () => {
    const merged = mergeGraph(multiSlot());
    const colour = merged.mesh.geometry.getAttribute("color");
    expect(colour).toBeDefined();
    expect(colour.count).toBe(merged.mesh.geometry.getAttribute("position").count);

    const seen = new Set<string>();
    for (let i = 0; i < colour.count; i++) {
      seen.add(`${colour.getX(i).toFixed(4)},${colour.getY(i).toFixed(4)},${colour.getZ(i).toFixed(4)}`);
    }
    // Two slots in, two distinct colours out. One means the merge flattened them.
    expect(seen.size).toBe(2);

    const chassis = new THREE.Color(SLOTS.chassis!.color);
    const tires = new THREE.Color(SLOTS.tires!.color);
    expect(seen).toContain(`${chassis.r.toFixed(4)},${chassis.g.toFixed(4)},${chassis.b.toFixed(4)}`);
    expect(seen).toContain(`${tires.r.toFixed(4)},${tires.g.toFixed(4)},${tires.b.toFixed(4)}`);
    expect((merged.mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    merged.dispose();
  });

  it("bakes the colour a node's own slot carries, not the one next to it", () => {
    // The check that separates "two colours came out" from "the right two went to the right
    // vertices". A merge that concatenated the colour arrays in a different order than the
    // geometries would still produce two distinct colours and the wrong cart.
    const merged = mergeGraph(
      graph(node({ name: "body", children: [node({ name: "wheel", slot: "tires", position: [0, -5, 0] })] })),
    );
    const geometry = merged.mesh.geometry;
    const position = geometry.getAttribute("position");
    const colour = geometry.getAttribute("color");
    const tires = new THREE.Color(SLOTS.tires!.color);

    let checked = 0;
    for (let i = 0; i < position.count; i++) {
      // The wheel is the only thing five metres down, so its vertices are identifiable by position
      // alone -- and every one of them must carry the tire colour.
      if (position.getY(i) > -4) continue;
      expect(colour.getX(i)).toBeCloseTo(tires.r, 4);
      expect(colour.getY(i)).toBeCloseTo(tires.g, 4);
      expect(colour.getZ(i)).toBeCloseTo(tires.b, 4);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    merged.dispose();
  });

  it("applies each node's own world transform, so the merged shape is the assembled one", () => {
    const built = buildGraph(multiSlot());
    const merged = mergeGraph(multiSlot());
    built.root.updateMatrixWorld(true);

    const fromTree = new THREE.Box3().setFromObject(built.root);
    const fromMerge = new THREE.Box3().setFromObject(merged.mesh);
    expect(fromMerge.min.toArray()).toEqual(fromTree.min.toArray().map((v) => expect.closeTo(v, 5)));
    expect(fromMerge.max.toArray()).toEqual(fromTree.max.toArray().map((v) => expect.closeTo(v, 5)));

    built.dispose();
    merged.dispose();
  });

  it("takes slot overrides at build time, the same as buildGraph", () => {
    const merged = mergeGraph(multiSlot(), { tires: 0x00ff00 });
    const colour = merged.mesh.geometry.getAttribute("color");
    const seen = new Set<string>();
    for (let i = 0; i < colour.count; i++) {
      seen.add(`${colour.getX(i).toFixed(4)},${colour.getY(i).toFixed(4)},${colour.getZ(i).toFixed(4)}`);
    }
    const green = new THREE.Color(0x00ff00);
    expect(seen).toContain(`${green.r.toFixed(4)},${green.g.toFixed(4)},${green.b.toFixed(4)}`);
    merged.dispose();
  });

  it("frees the merged geometry and its material, and leaves no source geometry behind", () => {
    const merged = mergeGraph(multiSlot());
    const geometry = merged.mesh.geometry;
    const material = merged.mesh.material as THREE.Material;
    let freed = 0;
    for (const resource of [geometry, material]) {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        freed++;
        original();
      };
    }
    merged.dispose();
    expect(freed).toBe(2);
  });
});

/**
 * `mergeGraphInstances` is `mergeGraph` for a thing with *length*.
 *
 * The causeway is the case that needed it. A crossing is a segment whose length is a property of the
 * pond, not of the asset, so the boardwalk is one authored section tiled along it -- and a
 * thirty-metre crossing tiled with `mergeGraph` would be fifteen draw calls, which is most of
 * `MAX_PROPS_PER_HOLE` spent on one object. Merged across instances it is one, and that is the whole
 * reason this exists rather than a loop at the call site.
 *
 * Each instance carries its **own** matrix rather than a shared stride, because the sections of a
 * causeway do not sit at one height: the deck runs onto dry bank at both ends and the abutments are
 * wherever the bank happens to be.
 */
describe("mergeGraphInstances", () => {
  const section = (): PrimitiveGraph =>
    graph(node({ name: "body", children: [node({ name: "post", slot: "tires", position: [0, 1, 0] })] }));

  const at = (x: number, y: number, z: number): THREE.Matrix4 =>
    new THREE.Matrix4().makeTranslation(x, y, z);

  it("draws n instances as one object", () => {
    const merged = mergeGraphInstances(section(), [at(0, 0, 0), at(0, 0, 2), at(0, 0, 4)]);
    expect(meshes(merged.mesh).length).toBe(1);
    expect(merged.mesh).toBeInstanceOf(THREE.Mesh);
    merged.dispose();
  });

  it("keeps n times the triangles of one, so nothing was silently dropped", () => {
    const one = mergeGraph(section());
    const three = mergeGraphInstances(section(), [at(0, 0, 0), at(0, 0, 2), at(0, 0, 4)]);

    const tris = (mesh: THREE.Mesh): number => {
      const index = mesh.geometry.getIndex();
      return (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
    };
    expect(tris(three.mesh)).toBe(tris(one.mesh) * 3);

    one.dispose();
    three.dispose();
  });

  it("puts each instance where its own matrix says, not all of them at the first", () => {
    // The failure this catches is a merge that applies one matrix to every copy: the triangle count
    // is right, the colours are right, and the whole causeway is stacked on its first section.
    const merged = mergeGraphInstances(section(), [at(0, 0, 0), at(0, 0, 10)]);
    const box = new THREE.Box3().setFromObject(merged.mesh);
    const single = new THREE.Box3().setFromObject(mergeGraph(section()).mesh);

    // Ten metres of separation has to show up as ten metres of extra extent along z.
    expect(box.max.z - box.min.z).toBeCloseTo(single.max.z - single.min.z + 10, 5);
    merged.dispose();
  });

  it("carries each instance's rotation, not just its translation", () => {
    // A section rotated a quarter turn about +Y puts its length along x. A merge that kept only the
    // translation column would leave every deck section square to the world and the causeway a
    // staircase of squares beside its own centreline.
    const wide = (): PrimitiveGraph => graph(node({ name: "body", params: [1, 1, 6] }));
    const turned = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const merged = mergeGraphInstances(wide(), [turned]);
    const box = new THREE.Box3().setFromObject(merged.mesh);

    expect(box.max.x - box.min.x).toBeCloseTo(6, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(1, 5);
    merged.dispose();
  });

  it("bakes slot colours per instance, the same as mergeGraph does per node", () => {
    const merged = mergeGraphInstances(section(), [at(0, 0, 0), at(0, 0, 2)]);
    const colour = merged.mesh.geometry.getAttribute("color");
    expect(colour.count).toBe(merged.mesh.geometry.getAttribute("position").count);

    const seen = new Set<string>();
    for (let i = 0; i < colour.count; i++) {
      seen.add(`${colour.getX(i).toFixed(4)},${colour.getY(i).toFixed(4)},${colour.getZ(i).toFixed(4)}`);
    }
    expect(seen.size).toBe(2);
    merged.dispose();
  });

  it("refuses an empty instance list rather than returning an empty mesh", () => {
    // A causeway with no sections is a derivation bug upstream, and a zero-triangle mesh added to
    // the scene is the least debuggable way for it to surface.
    //
    // The message is matched tightly on purpose. Written as `/instance/i` this assertion went
    // **green against a function that did not exist yet** -- `TypeError: mergeGraphInstances is not
    // a function` contains the word. That is this repo's recurring defect in miniature, caught here
    // by running it red first and reading what the red actually said.
    expect(() => mergeGraphInstances(section(), [])).toThrow(/at least one instance/);
  });

  it("frees the merged geometry and its material", () => {
    const merged = mergeGraphInstances(section(), [at(0, 0, 0), at(0, 0, 2)]);
    let freed = 0;
    for (const resource of [merged.mesh.geometry, merged.mesh.material as THREE.Material]) {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        freed++;
        original();
      };
    }
    merged.dispose();
    expect(freed).toBe(2);
  });
});

/**
 * The cart's own draw-call fix. A cart is 52 nodes and its rider 26, and a round draws eight of
 * them: over six hundred draws for the carts alone, where `REVAMP-PLAN.md` Stage 3 budgets about
 * 150. `mergeGraph` would get there and take the clubhouse loadout with it, so this merges per
 * **slot** instead, and only within a rigid part: whatever hangs rigidly off one posed node is one
 * mesh per slot, and a posed node keeps its own.
 *
 * The test that matters is "the shape buildGraph draws, in any pose". A merge that bakes a node
 * into the wrong part draws correctly at rest and comes apart the moment the turret turns.
 */
describe("mergeGraphBySlot", () => {
  const PARTS: PrimitiveGraph["slots"] = {
    ...SLOTS,
    barrel: { color: 0x303840, roughness: 0.4, metalness: 0.8 },
  };

  // The cart's shape in miniature: a body with wheels and a roof, and a turret whose swing arm hangs
  // off a tilted, scaled yoke -- the yoke is the part a merge is most likely to get wrong, because
  // nothing poses it and everything below it depends on it.
  const turretGraph = (): PrimitiveGraph =>
    graph(
      node({
        name: "body",
        params: [2, 0.5, 3],
        children: [
          node({ name: "wheel_fl", kind: "cylinder", params: [0.3, 0.3, 0.2, 10], slot: "tires", position: [1, 0, 1], rotation: [0, 0, Math.PI / 2] }),
          node({ name: "wheel_fr", kind: "cylinder", params: [0.3, 0.3, 0.2, 10], slot: "tires", position: [-1, 0, 1], rotation: [0, 0, Math.PI / 2] }),
          node({
            name: "roof",
            kind: "cylinder",
            params: [0.5, 0.5, 1, 8],
            position: [0, 2, 0],
            children: [node({ name: "post", params: [0.1, 1, 0.1], position: [0.4, -0.5, 0] })],
          }),
          node({
            name: "turret",
            kind: "cylinder",
            params: [0.3, 0.3, 0.2, 8],
            position: [0, 1, -0.5],
            rotation: [0, 0.3, 0],
            children: [
              node({
                name: "yoke",
                params: [0.2, 0.2, 0.2],
                position: [0, 0.2, 0.1],
                rotation: [0.25, 0, 0.1],
                scale: [1, 1.2, 1],
                children: [
                  node({
                    name: "arm",
                    slot: "barrel",
                    params: [0.1, 0.1, 1],
                    position: [0, 0, 0.5],
                    children: [
                      node({
                        name: "tip",
                        kind: "sphere",
                        slot: "barrel",
                        params: [0.1, 8, 6],
                        position: [0, 0, 0.5],
                        children: [
                          node({ name: "head_a", slot: "tires", params: [0.2, 0.1, 0.1], position: [0, 0, 0.2] }),
                          node({ name: "head_b", slot: "tires", params: [0.1, 0.2, 0.3], position: [0, 0.1, 0.3] }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              node({ name: "mantlet", params: [0.4, 0.3, 0.1], position: [0, 0, -0.3] }),
            ],
          }),
        ],
      }),
      PARTS,
    );

  const FRAMES = { moving: ["turret", "arm", "head_a", "head_b"], anchors: ["tip"] } as const;

  /** What is drawn, per slot: vertex count, the sum of world positions and their bounds. */
  function drawn(root: THREE.Object3D): Map<string, { count: number; sum: THREE.Vector3; box: THREE.Box3 }> {
    root.updateMatrixWorld(true);
    const out = new Map<string, { count: number; sum: THREE.Vector3; box: THREE.Box3 }>();
    const v = new THREE.Vector3();
    root.traverseVisible((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const slot = (child.material as THREE.Material).name;
      const entry = out.get(slot) ?? { count: 0, sum: new THREE.Vector3(), box: new THREE.Box3() };
      const position = child.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        entry.sum.add(v);
        entry.box.expandByPoint(v);
      }
      entry.count += position.count;
      out.set(slot, entry);
    });
    return out;
  }

  function expectSameDrawing(merged: THREE.Object3D, reference: THREE.Object3D): void {
    const a = drawn(merged);
    const b = drawn(reference);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [slot, want] of b) {
      const got = a.get(slot)!;
      expect(got.count, `${slot} vertices`).toBe(want.count);
      for (const axis of ["x", "y", "z"] as const) {
        expect(got.sum[axis], `${slot} sum ${axis}`).toBeCloseTo(want.sum[axis], 4);
        expect(got.box.min[axis], `${slot} min ${axis}`).toBeCloseTo(want.box.min[axis], 5);
        expect(got.box.max[axis], `${slot} max ${axis}`).toBeCloseTo(want.box.max[axis], 5);
      }
    }
  }

  /** The pose a renderer would set: yaw the turret, swing the arm, show one head. */
  function pose(built: BuiltGraph, yaw: number, swing: number, head: "head_a" | "head_b"): void {
    built.named.get("turret")!.rotation.y = yaw;
    built.named.get("arm")!.rotation.x = swing;
    built.named.get("head_a")!.visible = head === "head_a";
    built.named.get("head_b")!.visible = head === "head_b";
  }

  it("draws one mesh per slot in each rigid part, where buildGraph draws one per node", () => {
    const g = turretGraph();
    const built = buildGraph(g);
    const merged = mergeGraphBySlot(g, FRAMES);

    expect(meshes(built.root).length).toBe(12);
    // body: chassis (body, roof, post) and tires (two wheels). turret: chassis (turret, yoke,
    // mantlet). arm: barrel (arm, tip). One each for the two heads.
    expect(meshes(merged.root).length).toBe(6);
    built.dispose();
    merged.dispose();
  });

  it("keeps every vertex and triangle buildGraph would have drawn", () => {
    const g = turretGraph();
    const count = (root: THREE.Object3D): [number, number] => {
      let vertices = 0;
      let triangles = 0;
      for (const mesh of meshes(root)) {
        vertices += mesh.geometry.getAttribute("position").count;
        triangles += mesh.geometry.getIndex()!.count / 3;
      }
      return [vertices, triangles];
    };
    const built = buildGraph(g);
    const merged = mergeGraphBySlot(g, FRAMES);
    expect(count(merged.root)).toEqual(count(built.root));
    built.dispose();
    merged.dispose();
  });

  it("draws the shape buildGraph draws, at rest and in any pose", () => {
    const g = turretGraph();
    const built = buildGraph(g);
    const merged = mergeGraphBySlot(g, FRAMES);

    expectSameDrawing(merged.root, built.root);
    for (const [yaw, swing, head] of [
      [1.1, -0.7, "head_a"],
      [-2.4, 0.5, "head_b"],
      [0, -1.75, "head_b"],
    ] as const) {
      pose(built, yaw, swing, head);
      pose(merged, yaw, swing, head);
      expectSameDrawing(merged.root, built.root);
    }
    built.dispose();
    merged.dispose();
  });

  it("keeps the moving nodes, the anchors and the chain between them, posed as authored", () => {
    // The yoke is kept though nothing names it: collapsing it into the arm would fold its tilt into
    // the arm's own rotation, and a swing written to `rotation.x` would then overwrite the tilt.
    const merged = mergeGraphBySlot(turretGraph(), FRAMES);
    expect([...merged.named.keys()].sort()).toEqual(["arm", "body", "head_a", "head_b", "tip", "turret", "yoke"]);
    const yoke = merged.named.get("yoke")!;
    expect(yoke.rotation.x).toBeCloseTo(0.25, 9);
    expect(yoke.rotation.z).toBeCloseTo(0.1, 9);
    expect(yoke.scale.y).toBeCloseTo(1.2, 9);
    expect(yoke.parent).toBe(merged.named.get("turret"));
    expect(merged.named.get("tip")!.parent).toBe(merged.named.get("arm"));
    merged.dispose();
  });

  it("hides a moving node's geometry with it", () => {
    const merged = mergeGraphBySlot(turretGraph(), FRAMES);
    const before = drawn(merged.root).get("tires")!.count;
    merged.named.get("head_b")!.visible = false;
    const after = drawn(merged.root).get("tires")!.count;
    expect(after).toBe(before - 24); // a box is 24 vertices
    merged.dispose();
  });

  it("repaints a slot in every part with one write, and leaves the others alone", () => {
    const merged = mergeGraphBySlot(turretGraph(), FRAMES);
    const chassis = new Set<THREE.Material>();
    for (const mesh of meshes(merged.root)) {
      if ((mesh.material as THREE.Material).name === "chassis") chassis.add(mesh.material as THREE.Material);
    }
    // body and turret both draw chassis, from the one material.
    expect(chassis.size).toBe(1);

    merged.setSlotColor("chassis", 0xff0000);
    for (const mesh of meshes(merged.root)) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.name === "chassis") expect(material.color.getHex()).toBe(0xff0000);
      else expect(material.color.getHex()).not.toBe(0xff0000);
    }
    merged.setSlotColor("no_such_slot", 0x00ff00);
    merged.dispose();
  });

  it("takes slot overrides at build time, and keeps each build's paint its own", () => {
    const g = turretGraph();
    const red = mergeGraphBySlot(g, FRAMES, { chassis: 0xff0000 });
    const plain = mergeGraphBySlot(g, FRAMES);
    const colourOf = (built: BuiltGraph, slot: string): number =>
      (meshes(built.root).find((m) => (m.material as THREE.Material).name === slot)!.material as THREE.MeshStandardMaterial).color.getHex();

    expect(colourOf(red, "chassis")).toBe(0xff0000);
    expect(colourOf(plain, "chassis")).toBe(PARTS.chassis!.color);
    plain.setSlotColor("tires", 0x0000ff);
    expect(colourOf(red, "tires")).toBe(PARTS.tires!.color);
    red.dispose();
    plain.dispose();
  });

  it("shares its geometry with every build of the same graph, and frees it with the last", () => {
    const g = turretGraph();
    const a = mergeGraphBySlot(g, FRAMES);
    const b = mergeGraphBySlot(g, FRAMES);
    const geometries = meshes(a.root).map((m) => m.geometry);
    expect(meshes(b.root).map((m) => m.geometry)).toEqual(geometries);
    geometries.forEach((geometry, i) => expect(geometry, `mesh ${i}`).toBe(meshes(b.root)[i]!.geometry));

    let freed = 0;
    for (const geometry of geometries) geometry.addEventListener("dispose", () => freed++);
    a.dispose();
    expect(freed, "while b still draws it").toBe(0);
    b.dispose();
    expect(freed).toBe(geometries.length);

    // And a build after the last is freed makes its own, rather than drawing freed buffers.
    const c = mergeGraphBySlot(g, FRAMES);
    for (const mesh of meshes(c.root)) expect(geometries).not.toContain(mesh.geometry);
    c.dispose();
  });

  it("frees each build's slot materials", () => {
    const merged = mergeGraphBySlot(turretGraph(), FRAMES);
    const materials = new Set(meshes(merged.root).map((m) => m.material as THREE.Material));
    let freed = 0;
    for (const material of materials) material.addEventListener("dispose", () => freed++);
    merged.dispose();
    expect(freed).toBe(3);
  });

  it("refuses a frame the graph does not have, so a rename in Blender is loud", () => {
    expect(() => mergeGraphBySlot(turretGraph(), { moving: ["turret_pivot"] })).toThrow(
      /frame "turret_pivot".*not in the graph/,
    );
  });
});
