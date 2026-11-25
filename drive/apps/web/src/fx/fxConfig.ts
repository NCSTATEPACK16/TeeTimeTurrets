import type { MaterialName } from '@gcs/level-schema';

/** When a wheel lays a skid mark (PRD "Effects"). */
export const skidEmit = {
  /** Contact-patch ground speed must exceed this, m/s (PRD: 2 m/s). */
  minSpeed: 2,
  /** Sideways slide that counts as a skid, m/s. */
  sideSlip: 1.2,
  /** A braking (locked) wheel skids once its rolling speed exceeds this, m/s. */
  lockSpeed: 2.5,
};

/** Skid ribbon look. */
export const skidLook = {
  width: 0.18,
  /** Lift above the contact point, m; polygon offset handles the rest of the z-fighting. */
  lift: 0.02,
  /** Shortest segment before a new one is laid, m. */
  minSegment: 0.25,
  /** A gap longer than this starts a new strip instead of joining, m. */
  maxJoin: 1.5,
  opacity: 0.75,
};

/** Skid tint per surface: black rubber on path, torn turf on grass, ruts in sand, none in water. */
export const skidTint: Record<MaterialName, string | null> = {
  cartpath: '#1a1a1a',
  fairway: '#4b3b22',
  fringe: '#4b3b22',
  tee: '#4b3b22',
  green: '#4b3b22',
  rough: '#3f3420',
  woods: '#3a2c1c',
  embankment: '#3f3420',
  bunker: '#b49a62',
  water: null,
};

/** Particles: spray in water, roost in sand, dust and needle puffs off rough. */
export const particleConfig = {
  /** Pool size shared by all emitters. */
  maxParticles: 1200,
  /** Particles per second per wheel at full intensity. */
  rate: { spray: 120, roost: 50, dust: 14 },
  /** Wheel speed for full intensity, m/s. */
  fullAt: 8,
  minSpeed: 1.5,
  life: { spray: 0.9, roost: 0.7, dust: 1.2 },
  size: { spray: 0.12, roost: 0.07, dust: 0.1 },
  /** Launch speed scale, m/s per m/s of wheel speed. */
  kick: { spray: 0.45, roost: 0.35, dust: 0.2 },
  color: { spray: '#dfeef5', roost: '#cdb684', dust: '#b3a383' },
  /** Downward acceleration, m/s²; dust drifts up a little. */
  gravity: { spray: 9.81, roost: 9.81, dust: -0.3 },
  /** Which surfaces kick up which particles. */
  dustSurfaces: ['rough', 'woods', 'embankment'] as readonly MaterialName[],
};

/** Per-mode skid persistence. */
export interface SkidSettings {
  /** Ring-buffer segments per wheel; the oldest are overwritten when full. */
  segmentsPerWheel: number;
  /** Marks fade out over this long, s; null keeps them until the buffer wraps. */
  fadeSeconds: number | null;
}
