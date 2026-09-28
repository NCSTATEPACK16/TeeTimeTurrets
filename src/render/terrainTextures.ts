import * as THREE from "three";

/**
 * The CC0 photo textures the course ground is detailed with (`LICENSES.md`, "Terrain textures"),
 * as uniforms every ground tile shares.
 *
 * Detail, not colour: the ground's colour is still the biome palette, and a texture only says how
 * a patch differs from the texture's own average (see `detailSample` in `groundShader.ts`). So a
 * photo of someone else's grass cannot re-tint the course, and until the textures arrive -- or if
 * they never do -- the neutral stand-ins below leave the ground exactly as the palette draws it.
 *
 * The files are 512 px copies of the 1K sets, colour only.
 */

export interface DetailUniforms {
  readonly uDetailGrass: { value: THREE.Texture };
  readonly uDetailRough: { value: THREE.Texture };
  readonly uDetailSand: { value: THREE.Texture };
  readonly uDetailRock: { value: THREE.Texture };
  /** 0 until every texture has loaded, then 1. */
  readonly uDetailOn: { value: number };
}

const FILES = {
  uDetailGrass: "grass.jpg",
  uDetailRough: "rough.jpg",
  uDetailSand: "sand.jpg",
  uDetailRock: "rock.jpg",
} as const;

/** One mid-grey texel: its own average, so it details nothing. */
function neutral(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export function createDetailUniforms(): DetailUniforms {
  return {
    uDetailGrass: { value: neutral() },
    uDetailRough: { value: neutral() },
    uDetailSand: { value: neutral() },
    uDetailRock: { value: neutral() },
    uDetailOn: { value: 0 },
  };
}

/** The uniforms the course ground's tiles share, for the page's life like the ground itself. */
export const GROUND_DETAIL: DetailUniforms = createDetailUniforms();

let loading: Promise<void> | null = null;

/**
 * Loads the textures into `GROUND_DETAIL` once. Browser-only; a failure leaves the ground plain
 * rather than breaking the match, and is reported once to the console.
 */
export function loadGroundDetail(baseUrl: string, anisotropy: number): Promise<void> {
  if (loading) return loading;
  const loader = new THREE.TextureLoader();
  loading = Promise.all(
    (Object.keys(FILES) as (keyof typeof FILES)[]).map(async (key) => {
      const texture = await loader.loadAsync(baseUrl + FILES[key]);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      const old = GROUND_DETAIL[key].value;
      GROUND_DETAIL[key].value = texture;
      old.dispose();
    }),
  ).then(
    () => {
      GROUND_DETAIL.uDetailOn.value = 1;
    },
    (error: unknown) => {
      console.warn("ground detail textures did not load; the ground is drawn plain", error);
    },
  );
  return loading;
}
