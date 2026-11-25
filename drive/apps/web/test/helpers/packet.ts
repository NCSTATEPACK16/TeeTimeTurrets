import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadLevel, type Level, type PacketReader } from '../../src/level/loadLevel';

/** Level under test. Set GCS_LEVEL to run the same suite against another packet (M2: the real course). */
export const LEVEL_ID = process.env.GCS_LEVEL ?? 'dummy-01';

/**
 * The synthetic proving level. Its flat 270 m straight is what the cart-calibration tests were
 * tuned on; a real course's qa.driveStart is the best straight it has, which rolls a little.
 */
export const IS_SYNTHETIC = LEVEL_ID === 'dummy-01';

/**
 * Looser limits for real-course packets (John, M2: "loosen the test limits"). On real terrain the
 * drive start is fairway with a few percent of grade, not a flat cart path.
 */
export const realCourse = {
  /** Handbrake drift peak yaw must reach this fraction of the steer-only peak (synthetic: above it). */
  driftOverSteerRatio: 0.9,
  /** Stuck-recovery nudges required; on a slope the unpowered cart rolls, so it is stuck less often. */
  minNudges: 1,
  /** Meters covered in 3 s of throttle from rest at qa.driveStart (synthetic: 8 on the flat; real: a 2% grade). */
  minAlongM: 7,
} as const;

export function levelDir(id = LEVEL_ID): string {
  return fileURLToPath(new URL(`../../public/levels/${id}/`, import.meta.url));
}

export function diskReader(id = LEVEL_ID): PacketReader {
  const dir = levelDir(id);
  return async (file) => {
    const buf = await readFile(dir + file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
}

const cache = new Map<string, Promise<Level>>();

export function loadTestLevel(id = LEVEL_ID): Promise<Level> {
  let p = cache.get(id);
  if (!p) {
    p = loadLevel(diskReader(id));
    cache.set(id, p);
  }
  return p;
}

/** Small deterministic PRNG for reproducible test points. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
