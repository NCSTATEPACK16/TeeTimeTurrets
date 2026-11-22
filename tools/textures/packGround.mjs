/**
 * Packs the CC0 ground texture sets in `art/textures-src/` into the two array files the game
 * loads (`src/render/groundTextures.ts`):
 *
 *   public/textures/ground/detail.bin   layers x size x size bytes: detail (luminance / mean)
 *   public/textures/ground/normal.bin   layers x size x size x 4:   normal x, normal y, roughness, 255
 *   public/textures/ground/ground.json  the manifest
 *
 * Textures are detail, not colour (the Caswell spec, section 3.3): a colour map is reduced to its
 * linear luminance over its own mean, so the shader can multiply the palette colour by it.
 *
 * Each layer is also flattened at low frequency before that. A photo carries a slow light-to-dark
 * drift across its width; tiled every three metres, that drift is the repeat the eye picks out.
 * Dividing by a blurred copy removes it and leaves the grain.
 *
 * Deterministic: the same sources give byte-identical files. Needs ImageMagick's `convert`.
 *
 * Usage: node tools/textures/packGround.mjs   (or: npm run pack:ground)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "art/textures-src");
const OUT = join(ROOT, "public/textures/ground");
const SIZE = 512;
/** Cells per side of the low-frequency grid that is divided out. */
const FLATTEN_GRID = 8;
/** Byte = detail / DETAIL_RANGE * 255. Must match `DETAIL_RANGE` in src/render/groundLayers.ts. */
const DETAIL_RANGE = 2;

/** In array order. Must match `GROUND_LAYERS` in src/render/groundLayers.ts. */
const LAYERS = [
  { name: "mown", colour: "Grass004_1K-JPG_Color.jpg", normal: "Grass004_1K-JPG_NormalGL.jpg", rough: "Grass004_1K-JPG_Roughness.jpg" },
  { name: "coarse", colour: "withered_grass_diff_1k.jpg", normal: "withered_grass_nor_gl_1k.jpg", rough: "withered_grass_rough_1k.jpg" },
  { name: "sand", colour: "Ground093C_1K-JPG_Color.jpg", normal: "Ground093C_1K-JPG_NormalGL.jpg", rough: "Ground093C_1K-JPG_Roughness.jpg" },
  { name: "clay", colour: "Ground071_1K-JPG_Color.jpg", normal: "Ground071_1K-JPG_NormalGL.jpg", rough: "Ground071_1K-JPG_Roughness.jpg" },
  // ambientCG's one pine-tagged forest floor. It reads as fine mulch more than needles; the shader
  // adds the needle streak (groundShader.ts, `needleStreak`).
  { name: "straw", colour: "Ground077_1K-JPG_Color.jpg", normal: "Ground077_1K-JPG_NormalGL.jpg", rough: "Ground077_1K-JPG_Roughness.jpg" },
];

/** Raw 8-bit RGB of a source image, resized to SIZE x SIZE. */
function rgb(file) {
  const out = execFileSync(
    "convert",
    [join(SRC, file), "-resize", `${SIZE}x${SIZE}!`, "-depth", "8", "rgb:-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (out.length !== SIZE * SIZE * 3) throw new Error(`${file}: expected ${SIZE * SIZE * 3} bytes, got ${out.length}`);
  return out;
}

const srgbToLinear = (byte) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * The image's slow variation: block means on a FLATTEN_GRID x FLATTEN_GRID grid, read back
 * bilinearly with wrap-around so the flattened layer still tiles.
 */
function lowFrequency(values) {
  const cell = SIZE / FLATTEN_GRID;
  const means = new Float64Array(FLATTEN_GRID * FLATTEN_GRID);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      means[Math.floor(y / cell) * FLATTEN_GRID + Math.floor(x / cell)] += values[y * SIZE + x];
    }
  }
  for (let i = 0; i < means.length; i++) means[i] /= cell * cell;
  const out = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const gy = (y + 0.5) / cell - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < SIZE; x++) {
      const gx = (x + 0.5) / cell - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const at = (ix, iy) =>
        means[(((iy % FLATTEN_GRID) + FLATTEN_GRID) % FLATTEN_GRID) * FLATTEN_GRID + (((ix % FLATTEN_GRID) + FLATTEN_GRID) % FLATTEN_GRID)];
      out[y * SIZE + x] =
        at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
    }
  }
  return out;
}

const pixels = SIZE * SIZE;
const detail = Buffer.alloc(LAYERS.length * pixels);
const normal = Buffer.alloc(LAYERS.length * pixels * 4);
const manifestLayers = [];

LAYERS.forEach((layer, index) => {
  const colour = rgb(layer.colour);
  const luma = new Float64Array(pixels);
  for (let i = 0; i < pixels; i++) {
    luma[i] =
      0.2126 * srgbToLinear(colour[i * 3]) + 0.7152 * srgbToLinear(colour[i * 3 + 1]) + 0.0722 * srgbToLinear(colour[i * 3 + 2]);
  }
  let sourceMean = 0;
  for (let i = 0; i < pixels; i++) sourceMean += luma[i];
  sourceMean /= pixels;

  // Divide out the slow drift, then normalise to a mean of exactly 1.
  const low = lowFrequency(luma);
  let mean = 0;
  for (let i = 0; i < pixels; i++) {
    luma[i] /= Math.max(low[i], 1e-4);
    mean += luma[i];
  }
  mean /= pixels;
  for (let i = 0; i < pixels; i++) {
    const d = luma[i] / mean;
    detail[index * pixels + i] = Math.max(0, Math.min(255, Math.round((d / DETAIL_RANGE) * 255)));
  }

  const n = rgb(layer.normal);
  const r = rgb(layer.rough);
  for (let i = 0; i < pixels; i++) {
    const o = (index * pixels + i) * 4;
    normal[o] = n[i * 3];
    normal[o + 1] = n[i * 3 + 1];
    normal[o + 2] = r[i * 3];
    normal[o + 3] = 255;
  }
  manifestLayers.push({ name: layer.name, sourceMean: Number(sourceMean.toFixed(5)) });
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "detail.bin"), detail);
writeFileSync(join(OUT, "normal.bin"), normal);
writeFileSync(
  join(OUT, "ground.json"),
  `${JSON.stringify({ version: 1, size: SIZE, detailRange: DETAIL_RANGE, layers: manifestLayers, detailBytes: detail.length, normalBytes: normal.length }, null, 2)}\n`,
);
console.log(`packed ${LAYERS.length} layers at ${SIZE}px: detail ${detail.length} bytes, normal ${normal.length} bytes`);
