// Level packet v0.2 types and grid conventions. The JSON Schemas in ../schema
// are the source of truth; these types mirror them and tests keep both in sync.

export const SCHEMA_VERSION = '0.2';

/** Material IDs are the index in this list. Append only; never reorder. */
export const MATERIAL_NAMES = [
  'rough',
  'fairway',
  'fringe',
  'green',
  'tee',
  'bunker',
  'water',
  'cartpath',
  'woods',
  'embankment',
] as const;

export type MaterialName = (typeof MATERIAL_NAMES)[number];

export const MaterialId = Object.freeze(
  Object.fromEntries(MATERIAL_NAMES.map((name, id) => [name, id])) as Record<MaterialName, number>,
);

export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;
export type WheelName = (typeof WHEEL_NAMES)[number];

export const PACKET_FILES = {
  course: 'course.json',
  height: 'height.u16.bin',
  material: 'material.u8.bin',
  stripe: 'stripe.u8.bin',
  scatter: 'scatter.bin',
  holes: 'holes.json',
  paths: 'paths.json',
  horizon: 'horizon.u16.bin',
} as const;

/** Bytes per scatter record: Float32 x, z, scale, rotationRad. */
export const SCATTER_RECORD_BYTES = 16;

export interface Pose {
  x: number;
  z: number;
  /** Degrees clockwise from north: 0 = -Z, 90 = +X. */
  headingDeg: number;
}

export interface PointXZ {
  x: number;
  z: number;
}

export interface GridInfo {
  width: number;
  height: number;
  cellSize: number;
}

export interface HorizonInfo {
  file: 'horizon.u16.bin';
  cellSize: number;
  width: number;
  height: number;
  originX: number;
  originZ: number;
  scale: number;
  offset: number;
}

export interface CourseJson {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  generator: { name: string; version: string; seed?: number };
  crs: null | { epsg: number; originEasting: number; originNorthing: number };
  grid: GridInfo;
  height: { file: 'height.u16.bin'; scale: number; offset: number };
  material: { file: 'material.u8.bin' };
  stripe: { file: 'stripe.u8.bin' };
  materials: { id: number; name: MaterialName; color: string }[];
  spawn: Pose;
  water: { id: string; level: number; polygon: [number, number][] }[];
  scatter: { file: 'scatter.bin'; species: { name: string; count: number; byteOffset: number }[] };
  /** Optional visual-only skirt. Node (row, col) sits at x = originX + col * cellSize, z = originZ + row * cellSize. */
  horizon?: HorizonInfo;
  /** Optional course logo beside the packet. */
  logo?: { file: string };
  holes: 'holes.json';
  paths: 'paths.json';
  attribution: { name: string; license: string; url?: string }[];
  files: Record<string, string>;
  qa: {
    driveStart: Pose;
    /** A few meters before flat water about 0.5 m deep, heading straight in. */
    waterEntry?: Pose;
    /** A point in water deep enough to float the cart. */
    deepWater?: Pose;
    wheelPad?: Pose & { expected: Record<WheelName, MaterialName> };
    probes: (PointXZ & { material: MaterialName })[];
  };
}

export interface HolesJson {
  holes: { number: number; par: number; tee: PointXZ; green: PointXZ; pin: PointXZ }[];
}

export interface PathsJson {
  paths: {
    id: string;
    width: number;
    closed: boolean;
    source: 'osm' | 'astar' | 'authored';
    /** [x, y, z] centerline samples. */
    points: [number, number, number][];
  }[];
  bridges: { pathId: string; fromIndex: number; toIndex: number }[];
}

/** World x of grid column `col` (fractional allowed). */
export function colToX(grid: GridInfo, col: number): number {
  return (col - (grid.width - 1) / 2) * grid.cellSize;
}

/** World z of grid row `row` (fractional allowed). Row 0 is north (most negative z). */
export function rowToZ(grid: GridInfo, row: number): number {
  return (row - (grid.height - 1) / 2) * grid.cellSize;
}

/** Fractional grid column at world x. */
export function xToCol(grid: GridInfo, x: number): number {
  return x / grid.cellSize + (grid.width - 1) / 2;
}

/** Fractional grid row at world z. */
export function zToRow(grid: GridInfo, z: number): number {
  return z / grid.cellSize + (grid.height - 1) / 2;
}

/** Horizontal unit vector for a compass heading (0 = north = -Z, 90 = east = +X). */
export function headingToForward(headingDeg: number): PointXZ {
  const r = (headingDeg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** three.js / Rapier yaw (rotation about +Y) that points local -Z along a compass heading. */
export function headingToYaw(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180;
}

/** Stripe bearing in degrees for a stripe.u8 value. */
export function decodeStripeDeg(value: number): number {
  return (value * 180) / 256;
}
