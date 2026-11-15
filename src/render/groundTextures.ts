import * as THREE from "three";
import { GROUND_LAYERS, GROUND_TEXTURE_SIZE } from "./groundLayers";

/**
 * The ground's two detail arrays, loaded from the files `tools/textures/packGround.mjs` writes.
 *
 * This is the only code that knows the file format. Stage 4b swaps the raw arrays for KTX2 inside
 * `loadGroundTextures` without the shader or the ground knowing.
 *
 * - `detail`: one channel per layer. A texel is the layer's luminance over its own mean, stored
 *   so that 0.5 is "no change" (`DETAIL_RANGE` in `groundLayers.ts`).
 * - `normal`: RGBA per layer. RG = tangent-space normal xy, B = roughness. Three has no
 *   three-channel format, so A is padding.
 */
export interface GroundTextures {
  readonly detail: THREE.DataArrayTexture;
  readonly normal: THREE.DataArrayTexture;
  dispose(): void;
}

export interface GroundManifest {
  readonly version: number;
  readonly size: number;
  readonly detailRange: number;
  readonly layers: readonly { readonly name: string; readonly sourceMean: number }[];
  readonly detailBytes: number;
  readonly normalBytes: number;
}

/**
 * Whether a manifest and its two files are what `groundLayers.ts` expects. Pure, so the smoke
 * check can run it against the committed files in node.
 */
export function groundManifestProblem(manifest: GroundManifest, detailBytes: number, normalBytes: number): string | null {
  const pixels = manifest.size * manifest.size;
  if (manifest.version !== 1) return `unknown manifest version ${manifest.version}`;
  if (manifest.size !== GROUND_TEXTURE_SIZE) return `size ${manifest.size}, expected ${GROUND_TEXTURE_SIZE}`;
  if (manifest.layers.length !== GROUND_LAYERS.length) return `${manifest.layers.length} layers, expected ${GROUND_LAYERS.length}`;
  for (let i = 0; i < GROUND_LAYERS.length; i++) {
    if (manifest.layers[i]!.name !== GROUND_LAYERS[i]!.name) {
      return `layer ${i} is "${manifest.layers[i]!.name}", expected "${GROUND_LAYERS[i]!.name}"`;
    }
  }
  if (detailBytes !== pixels * manifest.layers.length) return `detail is ${detailBytes} bytes`;
  if (normalBytes !== pixels * manifest.layers.length * 4) return `normal is ${normalBytes} bytes`;
  return null;
}

function arrayTexture(data: Uint8Array, size: number, layers: number, format: THREE.PixelFormat): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data, size, size, layers);
  texture.format = format;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  // Detail and normals are data, not colour.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Fetches and uploads the arrays. Resolves to null on any failure -- a missing file, a short
 * read, a manifest that does not match `groundLayers.ts` -- and the ground then draws flat,
 * exactly as it did before there were textures.
 */
export async function loadGroundTextures(baseUrl: string): Promise<GroundTextures | null> {
  try {
    const [manifestResponse, detailResponse, normalResponse] = await Promise.all([
      fetch(`${baseUrl}ground.json`),
      fetch(`${baseUrl}detail.bin`),
      fetch(`${baseUrl}normal.bin`),
    ]);
    if (!manifestResponse.ok || !detailResponse.ok || !normalResponse.ok) return null;
    const manifest = (await manifestResponse.json()) as GroundManifest;
    const detailData = new Uint8Array(await detailResponse.arrayBuffer());
    const normalData = new Uint8Array(await normalResponse.arrayBuffer());
    const problem = groundManifestProblem(manifest, detailData.length, normalData.length);
    if (problem !== null) {
      console.warn(`ground textures not used: ${problem}`);
      return null;
    }
    const detail = arrayTexture(detailData, manifest.size, manifest.layers.length, THREE.RedFormat);
    const normal = arrayTexture(normalData, manifest.size, manifest.layers.length, THREE.RGBAFormat);
    return {
      detail,
      normal,
      dispose() {
        detail.dispose();
        normal.dispose();
      },
    };
  } catch {
    return null;
  }
}
