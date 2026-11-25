import {
  PACKET_FILES,
  SCATTER_RECORD_BYTES,
  type CourseJson,
  type GridInfo,
  type HolesJson,
  type HorizonInfo,
  type PathsJson,
} from '@gcs/level-schema';
import { validateCourse, validateHoles, validatePaths } from '@gcs/level-schema/validate';

/** A decoded level packet. Grids are row-major, row 0 = north. */
export interface Level {
  course: CourseJson;
  holes: HolesJson;
  paths: PathsJson;
  grid: GridInfo;
  /** Heights in meters, one per node. */
  heights: Float64Array;
  material: Uint8Array;
  stripe: Uint8Array;
  /** Float32 records [x, z, scale, rotationRad], species in course.scatter order. */
  scatter: Float32Array;
  minHeight: number;
  maxHeight: number;
  /** Optional visual-only skirt around the course (course.horizon). */
  horizon?: { info: HorizonInfo; heights: Float32Array };
}

/** Returns the raw bytes of one packet file by name. */
export type PacketReader = (file: string) => Promise<ArrayBuffer>;

export class LevelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelLoadError';
  }
}

/** Reads packet files over HTTP from `baseUrl` (same origin; no third-party hosts). */
export function httpReader(baseUrl: string): PacketReader {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return async (file) => {
    const res = await fetch(`${base}${file}`);
    if (!res.ok) throw new LevelLoadError(`${file}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
}

async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // not a secure context (e.g. plain http on a LAN IP)
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseJson(file: string, data: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch (err) {
    throw new LevelLoadError(`${file}: invalid JSON (${(err as Error).message})`);
  }
}

/** Loads, validates (schema, sizes, SHA-256) and decodes a level packet. */
export async function loadLevel(read: PacketReader): Promise<Level> {
  const course = validateCourse(parseJson(PACKET_FILES.course, await read(PACKET_FILES.course)));
  const names: string[] = [
    PACKET_FILES.height,
    PACKET_FILES.material,
    PACKET_FILES.stripe,
    PACKET_FILES.scatter,
    PACKET_FILES.holes,
    PACKET_FILES.paths,
  ];
  if (course.horizon) names.push(course.horizon.file);
  const raw = new Map<string, ArrayBuffer>();
  await Promise.all(names.map(async (name) => raw.set(name, await read(name))));

  for (const name of names) {
    const expected = course.files[name];
    if (!expected) throw new LevelLoadError(`course.json has no hash for ${name}`);
    const actual = await sha256Hex(raw.get(name)!);
    if (actual !== null && actual !== expected) {
      throw new LevelLoadError(`${name}: SHA-256 mismatch (expected ${expected}, got ${actual})`);
    }
  }

  const { width, height } = course.grid;
  const nodes = width * height;
  const expectBytes = (name: string, bytes: number) => {
    const got = raw.get(name)!.byteLength;
    if (got !== bytes) throw new LevelLoadError(`${name}: expected ${bytes} bytes, got ${got}`);
  };
  expectBytes(PACKET_FILES.height, nodes * 2);
  expectBytes(PACKET_FILES.material, nodes);
  expectBytes(PACKET_FILES.stripe, nodes);
  const trees = course.scatter.species.reduce((n, s) => n + s.count, 0);
  expectBytes(PACKET_FILES.scatter, trees * SCATTER_RECORD_BYTES);

  const view = new DataView(raw.get(PACKET_FILES.height)!);
  const heights = new Float64Array(nodes);
  const { scale, offset } = course.height;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < nodes; i++) {
    const h = offset + view.getUint16(i * 2, true) * scale;
    heights[i] = h;
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }

  const scatterView = new DataView(raw.get(PACKET_FILES.scatter)!);
  const scatter = new Float32Array(trees * 4);
  for (let i = 0; i < scatter.length; i++) scatter[i] = scatterView.getFloat32(i * 4, true);

  const material = new Uint8Array(raw.get(PACKET_FILES.material)!);
  const maxId = course.materials.length - 1;
  for (let i = 0; i < nodes; i++) {
    if (material[i]! > maxId) throw new LevelLoadError(`material.u8.bin: unknown material ID ${material[i]}`);
  }

  let horizon: Level['horizon'];
  if (course.horizon) {
    const info = course.horizon;
    expectBytes(info.file, info.width * info.height * 2);
    const hv = new DataView(raw.get(info.file)!);
    const hh = new Float32Array(info.width * info.height);
    for (let i = 0; i < hh.length; i++) hh[i] = info.offset + hv.getUint16(i * 2, true) * info.scale;
    horizon = { info, heights: hh };
  }

  return {
    horizon,
    course,
    holes: validateHoles(parseJson(PACKET_FILES.holes, raw.get(PACKET_FILES.holes)!)),
    paths: validatePaths(parseJson(PACKET_FILES.paths, raw.get(PACKET_FILES.paths)!)),
    grid: course.grid,
    heights,
    material,
    stripe: new Uint8Array(raw.get(PACKET_FILES.stripe)!),
    scatter,
    minHeight,
    maxHeight,
  };
}
