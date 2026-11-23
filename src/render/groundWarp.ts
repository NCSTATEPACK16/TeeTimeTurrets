/**
 * The ground's edge warp: a small, smooth offset applied to the surface-mask lookup so the line
 * between fairway and rough wanders by a metre or so, where the 2 m mask grid would otherwise
 * draw it in straight runs.
 *
 * It exists twice, on purpose. The shader warps what it draws (`GROUND_WARP_GLSL`), and anything
 * placed on the CPU that must agree with the drawn edge -- grass tufts, which may not stand on
 * what is drawn as fairway -- asks `groundWarp` the same question. Both are built from the same
 * constants and the same **integer** lattice hash: `Math.imul` here, `uint` arithmetic there,
 * exact in both, where the usual `fract(sin(dot))` hash gives different lattices on different
 * GPUs. What is left to differ is float against double in the interpolation: millimetres.
 *
 * Pure: no three.
 */

/** Metres per lattice cell, and the peak offset in metres, for each octave. */
export const WARP_OCTAVES: readonly { readonly cellM: number; readonly amplitudeM: number }[] = [
  { cellM: 19, amplitudeM: 0.8 },
  { cellM: 7, amplitudeM: 0.4 },
];

/** The largest offset the warp can return on either axis, metres. */
export const WARP_MAX_M = WARP_OCTAVES.reduce((sum, octave) => sum + octave.amplitudeM, 0);

/** Lattice hash to 0..65535. Mirrored exactly by `groundWarpHash` in the GLSL below. */
function hash(ix: number, iz: number, salt: number): number {
  let h = (Math.imul(ix, 0x85ebca6b) ^ Math.imul(iz, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h & 0xffff;
}

/** Smooth value noise in -1..1, one lattice cell per unit. `groundWarpNoise` in the GLSL below. */
export function groundNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, salt);
  const b = hash(ix + 1, iz, salt);
  const c = hash(ix, iz + 1, salt);
  const d = hash(ix + 1, iz + 1, salt);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return ((top + (bottom - top) * uz) / 65535) * 2 - 1;
}

/** The warp offset at a world point, metres, written into `out`. Never allocates. */
export function groundWarp(x: number, z: number, out: { x: number; z: number }): void {
  let ox = 0;
  let oz = 0;
  for (let i = 0; i < WARP_OCTAVES.length; i++) {
    const octave = WARP_OCTAVES[i]!;
    ox += groundNoise(x / octave.cellM, z / octave.cellM, i * 2) * octave.amplitudeM;
    oz += groundNoise(x / octave.cellM, z / octave.cellM, i * 2 + 1) * octave.amplitudeM;
  }
  out.x = ox;
  out.z = oz;
}

const f = (n: number): string => n.toFixed(4);

/** `vec2 groundWarp(vec2 worldXZ)`, the same function for a GLSL ES 3.00 fragment shader. */
export const GROUND_WARP_GLSL = `
  float groundWarpHash(ivec2 c, int salt) {
    uint h = (uint(c.x) * 0x85ebca6bu) ^ (uint(c.y) * 0xc2b2ae35u) ^ (uint(salt) * 0x27d4eb2fu);
    h ^= h >> 15u;
    h *= 0x2c1b3c6du;
    h ^= h >> 12u;
    h *= 0x297a2d39u;
    h ^= h >> 15u;
    return float(h & 0xffffu);
  }
  float groundWarpNoise(vec2 p, int salt) {
    vec2 i = floor(p);
    vec2 fr = p - i;
    vec2 u = fr * fr * (3.0 - 2.0 * fr);
    ivec2 c = ivec2(i);
    float a = groundWarpHash(c, salt);
    float b = groundWarpHash(c + ivec2(1, 0), salt);
    float cc = groundWarpHash(c + ivec2(0, 1), salt);
    float d = groundWarpHash(c + ivec2(1, 1), salt);
    return (mix(mix(a, b, u.x), mix(cc, d, u.x), u.y) / 65535.0) * 2.0 - 1.0;
  }
  vec2 groundWarp(vec2 p) {
    vec2 o = vec2(0.0);
${WARP_OCTAVES.map(
  (octave, i) =>
    `    o += vec2(groundWarpNoise(p / ${f(octave.cellM)}, ${i * 2}), groundWarpNoise(p / ${f(octave.cellM)}, ${i * 2 + 1})) * ${f(octave.amplitudeM)};`,
).join("\n")}
    return o;
  }
`;
