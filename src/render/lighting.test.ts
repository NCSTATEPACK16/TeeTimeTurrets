import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { QUALITY } from "./quality";
import { SKY, sunDirection } from "./sky";
import { createLighting, patchMaterial, shadowTexelSize, snapShadowFocus } from "./lighting";

/**
 * The single shadow map follows the camera, and a map that slides by fractions of a texel crawls:
 * every edge in it shimmers as the cart drives. Snapping the map's centre to whole texels in the
 * light's own plane is the fix (`src/vendor/cot/shadowStability.ts`), and these hold the snap to
 * what it has to do: move in whole texels only, never along the light, and never far.
 */

const SUN = sunDirection(SKY);

/** The light's basis: the axis it looks along and two across it. */
function lightBasis(): { right: THREE.Vector3; up: THREE.Vector3; along: THREE.Vector3 } {
  const along = new THREE.Vector3(-SUN.x, -SUN.y, -SUN.z).normalize();
  const right = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, along).normalize();
  return { right, up, along };
}

describe("shadowTexelSize", () => {
  it("is the map's reach over its resolution", () => {
    expect(shadowTexelSize(QUALITY.medium)).toBeCloseTo(QUALITY.medium.shadowFar / QUALITY.medium.shadowMapSize, 12);
  });
});

describe("snapShadowFocus", () => {
  const texel = 0.05;

  it("lands on whole texels across the light, and leaves the distance along it alone", () => {
    const { right, up, along } = lightBasis();
    const out = new THREE.Vector3();
    for (const [x, y, z] of [
      [12.34, 3.2, -8.9],
      [-501.7, 40.01, 233.3],
      [0.001, 0, 0.002],
    ] as const) {
      snapShadowFocus(x, y, z, SUN, texel, out);
      const a = out.dot(right) / texel;
      const b = out.dot(up) / texel;
      expect(Math.abs(a - Math.round(a)), `right at ${x}`).toBeLessThan(1e-6);
      expect(Math.abs(b - Math.round(b)), `up at ${x}`).toBeLessThan(1e-6);
      expect(out.dot(along)).toBeCloseTo(new THREE.Vector3(x, y, z).dot(along), 9);
      expect(out.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(texel * Math.SQRT2);
    }
  });

  it("holds still while the camera moves less than a texel across the light", () => {
    // The whole point: a map that moved with every millimetre of camera motion is the crawl.
    const { right, up } = lightBasis();
    const corner = new THREE.Vector3();
    snapShadowFocus(10.01, 2, 5.01, SUN, texel, corner);
    // A point well inside one texel, then nudged around inside it.
    const inside = corner.clone().addScaledVector(right, texel * 0.5).addScaledVector(up, texel * 0.5);
    const base = snapShadowFocus(inside.x, inside.y, inside.z, SUN, texel, new THREE.Vector3());
    for (const [dr, du] of [
      [0.3, 0.3],
      [-0.4, 0.2],
      [0.1, -0.45],
    ] as const) {
      const p = inside.clone().addScaledVector(right, texel * dr).addScaledVector(up, texel * du);
      const nudged = snapShadowFocus(p.x, p.y, p.z, SUN, texel, new THREE.Vector3());
      expect(nudged.distanceTo(base), `${dr}, ${du}`).toBeLessThan(1e-9);
    }
    // And a whole texel's move moves it by exactly one texel.
    const next = inside.clone().addScaledVector(right, texel);
    const stepped = snapShadowFocus(next.x, next.y, next.z, SUN, texel, new THREE.Vector3());
    expect(stepped.distanceTo(base)).toBeCloseTo(texel, 6);
  });
});

describe("patchMaterial", () => {
  it("runs the material's own shader hook and then the added one, and keys the program apart", () => {
    const material = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    material.onBeforeCompile = () => calls.push("own");
    material.customProgramCacheKey = () => "course-ground";
    const restore = patchMaterial(material, "csm", (m) => {
      m.onBeforeCompile = () => calls.push("added");
    });

    material.onBeforeCompile({} as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(["own", "added"]);
    expect(material.customProgramCacheKey()).toBe("course-ground|csm");

    restore();
    calls.length = 0;
    material.onBeforeCompile({} as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(["own"]);
    expect(material.customProgramCacheKey()).toBe("course-ground");
  });

  it("gives back the defines it found, so a material shared across matches is left as it was", () => {
    const material = new THREE.MeshStandardMaterial();
    material.defines = { KEEP: 1 };
    const restore = patchMaterial(material, "csm", (m) => {
      m.defines = { ...(m.defines ?? {}), USE_CSM: 1 };
    });
    expect(material.defines).toEqual({ KEEP: 1, USE_CSM: 1 });
    restore();
    expect(material.defines).toEqual({ KEEP: 1 });
  });
});

describe("createLighting, cascaded", () => {
  it("takes down cleanly, and leaves a material with no defines as it found it", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const lambert = new THREE.MeshLambertMaterial();
    const standard = new THREE.MeshStandardMaterial();
    const standardDefines = { ...standard.defines };
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), lambert), new THREE.Mesh(new THREE.BoxGeometry(), standard));
    const lighting = createLighting(scene, camera, QUALITY.high);
    lighting.adopt(scene);
    expect(() => lighting.dispose()).not.toThrow();
    expect(lambert.defines).toBeUndefined();
    expect(standard.defines).toEqual(standardDefines);
    expect(lambert.customProgramCacheKey()).not.toContain("csm");
  });
});
