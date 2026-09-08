import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `AGENTS.md` and `ASSET_PIPELINE.md` §1 split the geometry rule by path: playable geometry is
 * procedural primitives with no mesh file ever, while purely decorative geometry may ship as an
 * authored `.glb`. The boundary is mechanical -- *if removing the asset would change a simulation
 * result, it is playable* -- but nothing in the type system enforces it, and the failure mode is
 * quiet: one `GLTFLoader` import inside a sim module and the rule is gone with no test failing.
 *
 * So this asserts the two structural facts that keep the split honest: mesh files live only under
 * `public/models/`, and `GLTFLoader` is imported in exactly one place, which is under
 * `src/render/**`.
 *
 * Lives in `tools/` beside the other repo-shape checks: it reads the tree with `node:fs`, and
 * `src/**` is typechecked as browser code with no node types.
 */

const MESH_EXTENSIONS = [".glb", ".gltf", ".obj", ".fbx", ".dae", ".3ds"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

describe("the decorative/playable geometry boundary", () => {
  it("keeps every mesh file out of src/", () => {
    const offenders = walk("src").filter((f) => MESH_EXTENSIONS.some((e) => f.endsWith(e)));
    expect(offenders).toEqual([]);
  });

  it("keeps mesh files in public/models/ only", () => {
    const meshes = walk(".")
      .filter((f) => MESH_EXTENSIONS.some((e) => f.endsWith(e)))
      .filter((f) => !f.startsWith("dist/") && !f.startsWith("tools/."));
    for (const mesh of meshes) {
      expect(mesh.replace(/\\/g, "/"), `${mesh} is outside public/models/`).toMatch(
        /^public\/models\//,
      );
    }
  });

  it("imports GLTFLoader in exactly one module, under src/render/", () => {
    const importers = walk("src").filter(
      (f) => f.endsWith(".ts") && readFileSync(f, "utf8").includes("GLTFLoader"),
    );
    // One door, easy to audit. If a second appears, the question "can this asset legally and
    // architecturally be a mesh?" has been answered somewhere nobody reviewed.
    expect(importers.map((f) => f.replace(/\\/g, "/"))).toEqual(["src/render/decor.ts"]);
  });

  it("never loads a mesh from the sim or physics layers", () => {
    const leaked = [...walk("src/sim"), ...walk("src/physics")]
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const source = readFileSync(f, "utf8");
        return MESH_EXTENSIONS.some((e) => source.includes(e)) || source.includes("GLTFLoader");
      });
    expect(leaked).toEqual([]);
  });

  it("keeps the decorative set under the 500 KB budget", () => {
    const total = walk("public/models").reduce((sum, f) => sum + statSync(f).size, 0);
    expect(total).toBeLessThan(500 * 1024);
  });
});
