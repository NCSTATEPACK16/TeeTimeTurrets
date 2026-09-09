import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph, mergeGraph } from "./primitiveGraph";
import type { PrimitiveGraph, PrimitiveNode } from "./primitiveGraph";

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
