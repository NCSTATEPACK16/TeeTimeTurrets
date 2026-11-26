/** Chase camera settings; one preset per driving mode. */
export interface ChaseSettings {
  fovDeg: number;
  near: number;
  far: number;
  /** Distance behind the cart, m. */
  distance: number;
  /** Height above the cart origin, m. */
  height: number;
  /** Look-at point ahead of the cart, m. */
  lookAhead: number;
  lookHeight: number;
  /** Exponential follow rates, 1/s: higher is tighter. */
  positionRate: number;
  lookRate: number;
  /** Keep the camera at least this far above the terrain, m. */
  minGroundClearance: number;
  /** FOV widens by up to fovKickDeg as speed goes from fovKickFrom to fovKickTo (m/s). */
  fovKickDeg: number;
  fovKickFrom: number;
  fovKickTo: number;
  /** FOV follow rate, 1/s. */
  fovRate: number;
  /** Landing shake: amplitude (m) per m/s of touchdown speed, capped; decays at shakeDecay 1/s. */
  shakePerMps: number;
  shakeMax: number;
  shakeDecay: number;
  /** Shake wobble frequency, Hz. */
  shakeHz: number;
  /** Scenic idle orbit starts after this many idle seconds; null disables it. */
  idleOrbitAfter: number | null;
  /** Orbit rate, deg/s. */
  idleOrbitDegPerS: number;
}

/** Chill: soft follow from behind and above, plus a slow scenic orbit when parked. */
export const chillChase: ChaseSettings = {
  fovDeg: 60,
  near: 0.1,
  far: 3000,
  distance: 6.5,
  height: 2.4,
  lookAhead: 4,
  lookHeight: 0.8,
  positionRate: 4,
  lookRate: 9,
  minGroundClearance: 0.9,
  fovKickDeg: 0,
  fovKickFrom: 0,
  fovKickTo: 1,
  fovRate: 3,
  shakePerMps: 0.01,
  shakeMax: 0.05,
  shakeDecay: 6,
  shakeHz: 9,
  idleOrbitAfter: 8,
  idleOrbitDegPerS: 6,
};

/** Joyride: tighter chase, FOV kick with speed, landing shake. */
export const joyrideChase: ChaseSettings = {
  ...chillChase,
  distance: 5.6,
  height: 2.0,
  lookAhead: 5,
  positionRate: 6.5,
  lookRate: 12,
  // Scaled with Joyride's top speed (13.4 to 20 m/s): the kick starts at the same share of the
  // top speed and is full at boost's 24 m/s, as it was at the old boost's 15.
  fovKickDeg: 14,
  fovKickFrom: 9,
  fovKickTo: 24,
  shakePerMps: 0.06,
  shakeMax: 0.35,
  idleOrbitAfter: null,
};
