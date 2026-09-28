import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyGroundShader } from "./groundShader";
import { createDetailUniforms } from "./terrainTextures";

function standardShader(): THREE.WebGLProgramParametersWithUniforms {
  const lib = THREE.ShaderLib.standard;
  return {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe("applyGroundShader, course detail", () => {
  it("samples the detail textures twice over, anti-tiled, and fades them with distance", () => {
    const shader = standardShader();
    applyGroundShader(shader, { course: true });
    const f = shader.fragmentShader;
    for (const name of ["uDetailGrass", "uDetailRough", "uDetailSand", "uDetailRock"]) {
      expect(f).toContain(`uniform sampler2D ${name};`);
    }
    expect(f).toContain("detailSample(");
    expect(f).toContain("uDetailOn");
    expect(f).toMatch(/smoothstep\(\s*[\d.]+,\s*[\d.]+,\s*groundDistance\s*\)/);
  });

  it("hands steep ground to rock, from a world-space normal", () => {
    const shader = standardShader();
    applyGroundShader(shader, { course: true });
    expect(shader.vertexShader).toContain("vGroundUp = normalize(mat3(modelMatrix) * objectNormal).y;");
    expect(shader.fragmentShader).toContain("rockAmount");
  });

  it("replaces every chunk it hooks, so a renamed chunk in three fails here and not on screen", () => {
    const shader = standardShader();
    const before = shader.fragmentShader;
    applyGroundShader(shader, { course: true });
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(shader.fragmentShader.length).toBeGreaterThan(before.length);
    expect(shader.vertexShader).toContain("vGroundWorldPos =");
  });
});

describe("createDetailUniforms", () => {
  it("starts neutral and off, so the ground draws before any texture arrives", () => {
    const u = createDetailUniforms();
    expect(u.uDetailOn.value).toBe(0);
    for (const t of [u.uDetailGrass, u.uDetailRough, u.uDetailSand, u.uDetailRock]) {
      expect(t.value).toBeInstanceOf(THREE.Texture);
    }
  });
});
