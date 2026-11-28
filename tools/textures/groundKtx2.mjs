/**
 * Converts the packed ground arrays to KTX2 (Stage 4b, spec §4, as amended 16 Nov 2026):
 *
 *   public/textures/ground/normal.bin  -> normal.ktx2   UASTC (normal x, normal y, roughness)
 *   public/textures/ground/detail.bin  -> detail.ktx2   ETC1S (detail, one channel)
 *
 * Both are 2D array textures, one layer per ground layer in `ground.json`, marked linear: they are
 * data, not colour. On iOS, `KTX2Loader` transcodes them to ASTC, which keeps them compressed in
 * GPU memory where the raw arrays are not.
 *
 * Not yet loaded by the game. `loadGroundTextures` (src/render/groundTextures.ts) still reads the
 * `.bin` files; it switches once these files exist and have been looked at on a device. The
 * `.bin` files stay until then.
 *
 * Needs `toktx` (KTX-Software 4.x, https://github.com/KhronosGroup/KTX-Software/releases) and
 * ImageMagick's `convert`, as `packGround.mjs` does. Neither is installed in the cloud session
 * that wrote this, so it has never been run.
 *
 * Usage: node tools/textures/groundKtx2.mjs [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "public/textures/ground");
const dryRun = process.argv.includes("--dry-run");

const manifest = JSON.parse(readFileSync(join(DIR, "ground.json"), "utf8"));
const size = manifest.size;
const layers = manifest.layers.length;

/** The `toktx` arguments for one array, kept apart so they can be read and checked. */
export function toktxArgs(out, inputs, encoding) {
  const common = ["--t2", "--layers", String(inputs.length), "--genmipmap", "--assign_oetf", "linear", "--assign_primaries", "none"];
  const encode =
    encoding === "uastc"
      ? ["--encode", "uastc", "--uastc_quality", "2", "--zcmp", "19"]
      : ["--encode", "etc1s", "--clevel", "4", "--qlevel", "255"];
  return [...common, ...encode, out, ...inputs];
}

function run(cmd, args) {
  console.log([cmd, ...args].join(" "));
  if (!dryRun) execFileSync(cmd, args, { stdio: "inherit" });
}

/** Splits one packed array into a PNG per layer, with `channels` bytes a texel. */
function splitLayers(file, channels, magickFormat, work) {
  const data = readFileSync(join(DIR, file));
  const layerBytes = size * size * channels;
  if (data.length !== layerBytes * layers) throw new Error(`${file}: ${data.length} bytes, expected ${layerBytes * layers}`);
  const pngs = [];
  for (let i = 0; i < layers; i++) {
    const raw = join(work, `${file}.${i}.raw`);
    const png = join(work, `${file}.${i}.png`);
    writeFileSync(raw, data.subarray(i * layerBytes, (i + 1) * layerBytes));
    run("convert", ["-size", `${size}x${size}`, "-depth", "8", `${magickFormat}:${raw}`, png]);
    pngs.push(png);
  }
  return pngs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const work = mkdtempSync(join(tmpdir(), "ground-ktx2-"));
  try {
    // normal.bin is RGBA with A as padding; toktx is given RGB.
    const normals = splitLayers("normal.bin", 4, "rgba", work).map((png) => {
      const rgb = png.replace(/\.png$/, ".rgb.png");
      run("convert", [png, "-alpha", "off", rgb]);
      return rgb;
    });
    run("toktx", toktxArgs(join(DIR, "normal.ktx2"), normals, "uastc"));
    run("toktx", toktxArgs(join(DIR, "detail.ktx2"), splitLayers("detail.bin", 1, "gray", work), "etc1s"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
